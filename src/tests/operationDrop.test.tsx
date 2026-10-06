import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import * as profileMesh from "../cad/kernel/profileMesh";
import { installOperationDropPicking } from "../viewer/operationDropPicking";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertParameter,
  upsertSketch,
} from "../cad/document/CadDocument";
import { createXySketch } from "../cad/sketch/SketchModel";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import {
  profileOperationGeometry,
  capOperationGeometry,
} from "../cad/features/operationTargetGeometry";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";
import { useFileJobs } from "../persistence/fileJobs";
import { useGuidedHole } from "../ui/commands/guidedHoleCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useHoleDraft } from "../ui/commands/holeCommand";
import { useProjectWorkflow } from "../ui/commands/projectWorkflowCommand";
import { useExtrudeDraft, commitExtrude } from "../ui/commands/extrudeCommand";
import {
  useModelingDraft,
  commitModelingDraft,
} from "../ui/commands/modelingDraftCommand";
import {
  runCommand,
  selectCommandEnablement,
  isCommandEnabledForSnapshot,
} from "../ui/commands/commandRegistry";
import {
  beginSaveOrExport,
  canBeginSaveOrExport,
  useGuidedExport,
} from "../ui/commands/guidedExportCommand";
import {
  repairAvailable,
  focusRepairIssue,
} from "../ui/commands/repairCommand";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import { OperationDropPanel } from "../ui/panels/OperationDropPanel";
import {
  beginOperationDrop,
  canBeginOperationDrop,
  cancelOperationDrop,
  chooseOperationDropTarget,
  operationDropCurrent,
  operationDropTargets,
  operationTransferValue,
  OPERATION_DRAG_TYPE,
  useOperationDrop,
} from "../ui/commands/operationDropCommand";
import { useGeometryHighlight } from "../state/useGeometryHighlight";
import {
  prepareProjectDrop,
  useProjectDrop,
} from "../ui/commands/projectDropCommand";

vi.mock("opencascade.js/dist/opencascade.wasm.js", async () => {
  const { readFileSync } = await import("node:fs"),
    { createRequire } = await import("node:module");
  const root = `${process.cwd()}/node_modules/opencascade.js/dist`,
    filename = `${root}/opencascade.wasm.js`;
  const factory = new Function(
    "require",
    "__dirname",
    "__filename",
    readFileSync(filename, "utf8").replace(
      "export default opencascade;",
      "return opencascade;",
    ),
  )(createRequire(filename), root, filename);
  return {
    default: () =>
      factory({ wasmBinary: readFileSync(`${root}/opencascade.wasm.wasm`) }),
  };
});
vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });
beforeAll(async () => OpenCascadeKernel.initialize());
function reset() {
  useFileJobs.getState().cancel();
  useFileJobs.setState({ exportOpen: false });
  useCadStore.setState(useCadStore.getInitialState(), true);
  useOperationDrop.setState({
    frame: undefined,
    hoverId: undefined,
    error: undefined,
  });
  useExtrudeDraft.setState({ draft: undefined });
  useModelingDraft.setState({ draft: undefined });
  useHoleDraft.setState({ draft: undefined });
  useGuidedHole.setState({ draft: undefined });
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useProjectWorkflow.setState({ active: undefined });
  useGeometryHighlight.setState({ highlight: undefined });
  useViewerState.setState({
    session: -1,
    hiddenBodyIds: [],
    hiddenComponentIds: [],
    hiddenSketchIds: [],
  });
  useProjectDrop.setState({ pending: undefined, saving: false });
}
beforeEach(reset);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  reset();
});
async function fixture() {
  const base = createXySketch("Base section");
  const outline = addCanvasGeometry(base, solveSketch(base, {}), "rectangle", [
    { x: -10, y: -6 },
    { x: 10, y: 6 },
  ]).sketch;
  const loose = createXySketch("Loose shape");
  const second = addCanvasGeometry(loose, solveSketch(loose, {}), "rectangle", [
    { x: 35, y: -4 },
    { x: 47, y: 4 },
  ]).sketch;
  const profileId = detectProfiles(solveSketch(outline, {})).profiles[0].id;
  const feature = createExtrudeFeature({
    name: "Base",
    sketchId: outline.id,
    profileId,
    operation: "newBody",
    distance: { expression: "height", unit: "mm" },
    direction: "positive",
  });
  const document = upsertFeature(
    upsertSketch(
      upsertSketch(
        upsertParameter(createEmptyDocument(), {
          id: "height",
          name: "height",
          expression: "10mm",
          value: 10,
          unit: "mm",
        }),
        outline,
      ),
      second,
    ),
    feature,
  );
  useCadStore.getState().setDocument(document);
  await waitFor(() =>
    expect(useCadStore.getState().rebuild.status).toBe("succeeded"),
  );
  const current = useCadStore.getState().history.present,
    result = rebuildDocument(current);
  expect(result.meshes[0].geometrySource).toBe("opencascade");
  expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(2400, 6);
  useCadStore.setState({
    rebuild: { result, kernelReady: true, status: "succeeded" },
  });
  return { document: current, result, feature, outline, second };
}
it("offers only explicit visible active-component profiles and untouched native cap groups", async () => {
  const { feature, second } = await fixture();
  expect(operationDropTargets("extrude")).toHaveLength(2);
  expect(
    operationDropTargets("fillet").map((t) => t.kind === "edge" && t.role),
  ).toEqual(["endCapPerimeter", "startCapPerimeter"]);
  const state = useCadStore.getState();
  useViewerState
    .getState()
    .toggleSketch(state.documentSession, second.id, [second.id]);
  expect(operationDropTargets("extrude")).toHaveLength(1);
  useViewerState
    .getState()
    .toggleBody(state.documentSession, `body:${feature.id}`, [
      `body:${feature.id}`,
    ]);
  expect(operationDropTargets("chamfer")).toEqual([]);
  const fallback = {
    ...state.rebuild.result!,
    meshes: state.rebuild.result!.meshes.map((mesh) => ({
      ...mesh,
      geometrySource: "fallback" as const,
    })),
  };
  useCadStore.setState({ rebuild: { ...state.rebuild, result: fallback } });
  expect(canBeginOperationDrop()).toBe(false);
});
it("routes keyboard/card clicks and real operation drag data through the same dispatcher without changing history before Apply", async () => {
  const { second } = await fixture();
  render(<OperationDropPanel />);
  const before = useCadStore.getState().history;
  fireEvent.click(
    screen.getByRole("button", { name: "Use Extrude on geometry" }),
  );
  const frame = useOperationDrop.getState().frame!;
  expect(
    screen.getByRole("button", { name: "Use Extrude on geometry" }),
  ).toBeEnabled();
  const target = screen.getByRole("button", {
    name: "Preview on Loose shape — region 1",
  });
  const transfer = {
    types: [OPERATION_DRAG_TYPE],
    getData: () => operationTransferValue(frame),
    dropEffect: "none",
  };
  fireEvent.dragOver(target, { dataTransfer: transfer });
  expect(transfer.dropEffect).toBe("copy");
  fireEvent.drop(target, { dataTransfer: transfer });
  const draft = useExtrudeDraft.getState().draft!;
  expect(draft.feature.sketchId).toBe(second.id);
  expect(draft.targetSnapshot).toBe(frame.result);
  expect(useCadStore.getState().history).toBe(before);
  expect(useOperationDrop.getState().frame).toBeUndefined();
  const staged = upsertFeature(before.present, draft.feature),
    preview = rebuildDocument(staged);
  const volumes = preview.meshes
    .map((m) => m.geometryAssertions!.volume)
    .sort((a, b) => a - b);
  expect(volumes).toHaveLength(2);
  expect(volumes[0]).toBeCloseTo(960, 6);
  expect(volumes[1]).toBeCloseTo(2400, 6);
  act(() => commitExtrude(draft, staged, preview));
  expect(useCadStore.getState().history.past).toHaveLength(
    before.past.length + 1,
  );
  act(() => useCadStore.getState().undo());
  expect(useCadStore.getState().history.present).toBe(before.present);
});
it.each(["fillet", "chamfer"] as const)(
  "starts %s on the exact cap role and validates changed native geometry before one Undo edit",
  async (operation) => {
    const { result } = await fixture();
    beginOperationDrop(operation);
    const frame = useOperationDrop.getState().frame!,
      target = operationDropTargets(operation)[0];
    runCommand("feature.operationTarget", {
      operationFrame: frame,
      operationTargetId: target.id,
    });
    const draft = useModelingDraft.getState().draft!;
    expect(draft.feature.type).toBe(operation);
    if (draft.feature.type === "revolve") throw new Error("Unexpected revolve");
    expect(draft.feature.targetEdgeRefs[0].role).toBe("endCapPerimeter");
    const before = useCadStore.getState().history,
      staged = upsertFeature(before.present, draft.feature),
      preview = rebuildDocument(staged);
    expect(preview.success).toBe(true);
    expect(preview.meshes[0].kernelOperation).toBe(operation);
    expect(preview.meshes[0].geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(preview.meshes[0].geometryAssertions!.volume).toBeGreaterThan(2300);
    expect(preview.meshes[0].geometryAssertions!.volume).toBeLessThan(
      result.meshes[0].geometryAssertions!.volume - 1,
    );
    commitModelingDraft(draft, staged, preview);
    expect(useCadStore.getState().history.past).toHaveLength(
      before.past.length + 1,
    );
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(before.present);
  },
);
it("rejects stale identity/session/component/result targets and refuses competing draft/file-dialog starts", async () => {
  await fixture();
  const before = useCadStore.getState();
  beginOperationDrop("extrude");
  const frame = useOperationDrop.getState().frame!,
    target = operationDropTargets("extrude")[0];
  for (const stale of [
    {
      ...before,
      history: { ...before.history, present: { ...before.history.present } },
    },
    { ...before, documentSession: before.documentSession + 1 },
    { ...before, activeComponentId: "other" },
    {
      ...before,
      rebuild: { ...before.rebuild, result: { ...before.rebuild.result! } },
    },
    { ...before, fileBusy: true },
  ])
    expect(operationDropCurrent(frame, stale)).toBe(false);
  useCadStore.setState({
    rebuild: { ...before.rebuild, result: { ...before.rebuild.result! } },
  });
  expect(() => chooseOperationDropTarget(frame, target.id)).toThrow(/changed/);
  expect(useCadStore.getState().history).toBe(before.history);
  cancelOperationDrop();
  useFileJobs.setState({ exportOpen: true });
  expect(canBeginOperationDrop()).toBe(false);
  expect(() => beginOperationDrop("extrude")).toThrow(/Finish or cancel/);
  useFileJobs.setState({ exportOpen: false });
  useSketchCanvas.setState({
    active: {
      documentId: before.history.present.id,
      session: before.documentSession,
      sketchId: target.kind === "profile" ? target.sketchId : "none",
    },
  });
  expect(canBeginOperationDrop()).toBe(false);
});
it("blocks shared modeling/file commands during target picking and rejects old transfer data without a preview", async () => {
  await fixture();
  render(<OperationDropPanel />);
  act(() => beginOperationDrop("extrude"));
  const before = useCadStore.getState().history;
  const enablement = selectCommandEnablement(useCadStore.getState());
  for (const command of [
    "feature.fillet",
    "feature.guidedHole",
    "file.dropProject",
    "file.new",
    "sketch.draw",
    "ai.toggle",
    "edit.undo",
  ])
    expect(isCommandEnabledForSnapshot(command, enablement)).toBe(false);
  fireEvent.drop(
    screen.getByRole("button", { name: "Preview on Loose shape — region 1" }),
    {
      dataTransfer: {
        types: [OPERATION_DRAG_TYPE],
        getData: () => "extrude:old",
      },
    },
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/old operation/);
  expect(useExtrudeDraft.getState().draft).toBeUndefined();
  const file = new File(["{}"], "incoming.pcaddoc", {
    type: "application/json",
  });
  await act(() => prepareProjectDrop(file));
  expect(useCadStore.getState().fileError).toMatch(/Finish or cancel/);
  expect(useProjectDrop.getState().pending).toBeUndefined();
  expect(useCadStore.getState().history).toBe(before);
});
it("places cap group overlays on actual symmetric/negative extrusion starts", async () => {
  const { document, result, feature, second } = await fixture();
  const profile = result.profiles![second.id][0];
  const placement = profileOperationGeometry(second.id, profile.id, result);
  expect(placement.filled).toBe(true);
  expect(placement.indices).toHaveLength(6);
  for (const [direction, start, end] of [
    ["negative", -10, 0],
    ["symmetric", -5, 5],
    ["positive", 0, 10],
  ] as const) {
    const staged = {
      ...document,
      features: document.features.map((f) =>
        f.id === feature.id ? { ...feature, direction } : f,
      ),
    };
    expect(
      capOperationGeometry(feature.id, false, staged, result)
        .loops.flat()
        .every((p) => Math.abs(p.z - start) < 1e-9),
    ).toBe(true);
    expect(
      capOperationGeometry(feature.id, true, staged, result)
        .loops.flat()
        .every((p) => Math.abs(p.z - end) < 1e-9),
    ).toBe(true);
  }
});
it("triangulates profile holes with matching vertex offsets and never fills their empty centers", () => {
  let sketch = createXySketch("Perforated profile");
  sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle", [
    { x: -10, y: -6 },
    { x: 10, y: 6 },
  ]).sketch;
  sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "circle", [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ]).sketch;
  const result = rebuildDocument(upsertSketch(createEmptyDocument(), sketch));
  const profile = result.profiles![sketch.id].find(
    (p) => p.innerLoops.length === 1,
  )!;
  const placement = profileOperationGeometry(sketch.id, profile.id, result);
  const flat = placement.loops.flat();
  expect(placement.loops.map((loop) => loop.length)).toEqual([4, 128]);
  let area = 0;
  for (let i = 0; i < placement.indices!.length; i += 3) {
    const [a, b, c] = placement
      .indices!.slice(i, i + 3)
      .map((index) => flat[index]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    area += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    // No triangle contains the center of the circle hole.
    const cross = (p: typeof a, q: typeof a) => p.x * q.y - p.y * q.x;
    const sides = [cross(a, b), cross(b, c), cross(c, a)];
    expect(
      sides.some((value) => value > 1e-9) &&
        sides.some((value) => value < -1e-9),
    ).toBe(true);
  }
  expect(area).toBeCloseTo(240 - 128 * 2 * Math.sin((2 * Math.PI) / 128), 6);
});
it("refuses Apply when a targeted native preview loses its exact retained source result", async () => {
  await fixture();
  beginOperationDrop("fillet");
  const frame = useOperationDrop.getState().frame!;
  chooseOperationDropTarget(frame, operationDropTargets("fillet")[0].id);
  const draft = useModelingDraft.getState().draft!;
  const state = useCadStore.getState(),
    staged = upsertFeature(state.history.present, draft.feature),
    preview = rebuildDocument(staged);
  useCadStore.setState({
    rebuild: { ...state.rebuild, result: { ...state.rebuild.result! } },
  });
  expect(() => commitModelingDraft(draft, staged, preview)).toThrow(/changed/);
  expect(useCadStore.getState().history).toBe(state.history);
});

it("bounds overlay allocation before triangulation and disposes its transient scene on cancel and unmount", async () => {
  const { result, second } = await fixture();
  const sampling = vi.spyOn(profileMesh, "loopPoints");
  expect(() =>
    profileOperationGeometry(
      second.id,
      result.profiles![second.id][0].id,
      result,
      3,
    ),
  ).toThrow(/overlay budget/);
  expect(sampling).not.toHaveBeenCalled();
  profileOperationGeometry(
    second.id,
    result.profiles![second.id][0].id,
    result,
    4,
  );
  expect(sampling).toHaveBeenCalledTimes(1);
  sampling.mockRestore();
  const scene = new THREE.Scene(),
    canvas = document.createElement("canvas"),
    camera = new THREE.PerspectiveCamera();
  const disposed = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
  let clipConstant = 0;
  const picker = installOperationDropPicking(
    scene,
    canvas,
    camera,
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), clipConstant),
  );
  try {
    expect(scene.children[0].children).toHaveLength(0);
    beginOperationDrop("extrude");
    expect(scene.children[0].children).toHaveLength(2);
    useCadStore.setState({ paletteOpen: true });
    expect(disposed).not.toHaveBeenCalled();
    // Simulate the host replacing its clipping ref after a section update.
    // No store/pointer event should be needed to update displayed materials.
    clipConstant = 1;
    picker.refresh();
    expect(picker.inspect()).toHaveLength(2);
    expect(picker.inspect().every((target) => target.clippingPlanes.length === 1 && target.clippingPlanes[0].constant === 1)).toBe(true);
    useCadStore.setState({ paletteOpen: false });
    expect(disposed).toHaveBeenCalledTimes(2);
    cancelOperationDrop();
    expect(scene.children[0].children).toHaveLength(0);
    expect(disposed).toHaveBeenCalledTimes(4);
    beginOperationDrop("fillet");
    expect(scene.children[0].children).toHaveLength(2);
    picker.dispose();
    expect(scene.children).toHaveLength(0);
    expect(disposed).toHaveBeenCalledTimes(6);
    picker.refresh();
    picker.dispose();
    expect(picker.inspect()).toEqual([]);
    expect(disposed).toHaveBeenCalledTimes(6);
  } finally {
    picker.dispose();
    disposed.mockRestore();
  }
});

it.each(["picker", "profile preview", "edge preview"] as const)(
  "blocks and restores repair/save-export commands during %s",
  async (phase) => {
    const fixtureData = await fixture();
    const issue = {
      id: "integration:inspect-owner",
      source: "feature" as const,
      sourceId: fixtureData.feature.id,
      message: "Inspect native owner dimensions.",
    };
    const result = {
      ...fixtureData.result,
      warnings: [...fixtureData.result.warnings, issue],
    };
    useCadStore.setState({
      rebuild: { ...useCadStore.getState().rebuild, result },
    });
    const state = useCadStore.getState(),
      before = state.history;
    const repair = {
      document: before.present,
      result,
      session: state.documentSession,
      issueId: issue.id,
    };
    state.select({
      kind: "body",
      id: result.meshes[0].bodyId,
      documentId: before.present.id,
    });
    const enablement = renderHook(useCommandEnablement);
    expect(enablement.result.current.saveOrExport).toBe(true);
    expect(enablement.result.current.repairModel).toBe(true);
    expect(enablement.result.current.exportStl).toBe(true);
    expect(enablement.result.current.exportSelectedBody).toBe(true);
    act(() => {
      beginOperationDrop(phase === "edge preview" ? "fillet" : "extrude");
      if (phase !== "picker")
        chooseOperationDropTarget(
          useOperationDrop.getState().frame,
          operationDropTargets(
            phase === "edge preview" ? "fillet" : "extrude",
          )[0].id,
        );
    });
    expect(enablement.result.current.saveOrExport).toBe(false);
    expect(enablement.result.current.repairModel).toBe(false);
    expect(enablement.result.current.exportStl).toBe(false);
    expect(enablement.result.current.exportSelectedBody).toBe(false);
    expect(canBeginSaveOrExport()).toBe(false);
    expect(repairAvailable()).toBe(false);
    act(() => {
      beginSaveOrExport();
      runCommand("file.saveOrExport");
      runCommand("file.exportStl");
      runCommand("file.exportSelectedBody");
      runCommand("repair.focus", { repair });
    });
    expect(useFileJobs.getState().exportOpen).toBe(false);
    expect(useFileJobs.getState().busy).toBe(false);
    expect(useGuidedExport.getState().task).toBeUndefined();
    expect(() => focusRepairIssue(repair)).toThrow(/Finish or cancel/);
    expect(useCadStore.getState().history).toBe(before);
    act(() => {
      cancelOperationDrop();
      useExtrudeDraft.setState({ draft: undefined });
      useModelingDraft.setState({ draft: undefined });
    });
    expect(enablement.result.current.saveOrExport).toBe(true);
    expect(enablement.result.current.repairModel).toBe(true);
    expect(enablement.result.current.exportStl).toBe(true);
    expect(enablement.result.current.exportSelectedBody).toBe(true);
    expect(canBeginSaveOrExport()).toBe(true);
    expect(repairAvailable()).toBe(true);
    act(() => runCommand("repair.focus", { repair }));
    expect(useCadStore.getState().selection.selectedIds[0]).toMatchObject({
      kind: "feature",
      id: fixtureData.feature.id,
    });
    act(() => runCommand("file.saveOrExport"));
    expect(useFileJobs.getState().exportOpen).toBe(true);
    expect(useGuidedExport.getState().task?.document).toBe(before.present);
    expect(useCadStore.getState().history).toBe(before);
  },
);
