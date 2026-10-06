import { useTargetScopeCapture } from "../ui/commands/targetScopeCaptureCommand";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import { runCommand } from "../ui/commands/commandRegistry";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FabricationPanel } from "../ui/panels/FabricationPanel";
import {
  beginSaveOrExport,
  canBeginSaveOrExport,
  useGuidedExport,
} from "../ui/commands/guidedExportCommand";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";
import { useFileJobs, openFabrication } from "../persistence/fileJobs";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import { createXySketch, addCenterRectangle } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { buildStlExport } from "../fabrication/exportPlan";
import { exportFabrication } from "../fabrication/exportClient";
import {
  downloadProject,
  downloadArrayBuffer,
} from "../persistence/exportProject";
import { exportDiagnostic } from "../fabrication/exportDiagnostic";
import { useExtrudeDraft } from "../ui/commands/extrudeCommand";
import { useHoleDraft } from "../ui/commands/holeCommand";
import { useModelingDraft } from "../ui/commands/modelingDraftCommand";
import { useGuidedHole } from "../ui/commands/guidedHoleCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useProjectWorkflow } from "../ui/commands/projectWorkflowCommand";

vi.mock("../fabrication/exportClient", () => ({ exportFabrication: vi.fn() }));
vi.mock("../persistence/exportProject", async (original) => ({
  ...(await original<typeof import("../persistence/exportProject")>()),
  downloadProject: vi.fn(),
  downloadArrayBuffer: vi.fn(),
}));
vi.mock("../persistence/autosave", () => ({
  saveRecovery: vi.fn(async () => {}),
}));
function twoParts() {
  let document = createEmptyDocument("Export example");
  for (const name of ["First", "Second"]) {
    const sketch = addCenterRectangle(createXySketch(name), "10mm", "6mm"),
      profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
    document = upsertFeature(
      upsertSketch(document, sketch),
      createExtrudeFeature({
        name,
        sketchId: sketch.id,
        profileId: profile.id,
        operation: "newBody",
        direction: "positive",
        distance: { expression: "10mm", unit: "mm" },
      }),
    );
  }
  return document;
}
beforeEach(() => {
  vi.clearAllMocks();
  useTargetScopeCapture.setState({ busy: false });
  useExtrudeDraft.setState({ draft: undefined });
  useHoleDraft.setState({ draft: undefined });
  useModelingDraft.setState({ draft: undefined });
  useGuidedHole.setState({ draft: undefined });
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useProjectWorkflow.setState({ active: undefined });
  useFileJobs.getState().cancel();
  useFileJobs.setState({
    exportOpen: false,
    exportSession: undefined,
    exportBodyIds: undefined,
  });
  useGuidedExport.setState({ task: undefined });
  const document = twoParts(),
    result = rebuildDocument(document);
  useCadStore.setState(
    {
      ...useCadStore.getInitialState(),
      history: { past: [], present: document, future: [] },
      documentSession: 3,
      activeComponentId: document.rootComponentId,
      rebuild: { status: "succeeded", kernelReady: true, result },
    },
    true,
  );
  useViewerState.setState({
    session: 3,
    hiddenBodyIds: [],
    hiddenComponentIds: [],
  });
  vi.mocked(exportFabrication).mockImplementation(async (request) =>
    buildStlExport(
      request.meshes,
      request.bodies,
      request.document.name,
      request.mode,
      request.fullChecks,
    ),
  );
});
afterEach(() => {
  cleanup();
  useFileJobs.getState().cancel();
  useFileJobs.setState({ exportOpen: false });
});
it("explains editable saving separately, saves the captured current project, and leaves geometry/history unchanged", async () => {
  const before = useCadStore.getState();
  beginSaveOrExport();
  render(<FabricationPanel />);
  expect(screen.getByRole("dialog", { name: "Save or export" })).toBeVisible();
  expect(
    screen.getByRole("radio", { name: /Save editable project/ }),
  ).toBeChecked();
  expect(screen.queryByLabelText("STL mode")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Save editable project" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(downloadProject).toHaveBeenCalledExactlyOnceWith(
    before.history.present,
  );
  expect(useCadStore.getState().history).toBe(before.history);
  expect(useCadStore.getState().rebuild).toBe(before.rebuild);
  expect(useGuidedExport.getState().task).toBeUndefined();
});
it("exports only explicitly marked bodies with full validation and keeps hidden bodies included until visibility is chosen", async () => {
  const state = useCadStore.getState(),
    bodies = state.rebuild.result!.bodies;
  useViewerState.setState({ hiddenBodyIds: [bodies[1].id] });
  beginSaveOrExport();
  render(<FabricationPanel />);
  fireEvent.click(screen.getByRole("radio", { name: /Export for printing/ }));
  expect(screen.getByLabelText("Export body Second")).toBeChecked();
  expect(screen.getByLabelText("STL output summary")).toHaveTextContent(
    "2 bodies selected",
  );
  expect(screen.getByLabelText("STL mode")).not.toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Select visible bodies" }),
  );
  expect(screen.getByLabelText("Export body Second")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Generate STL" }));
  await waitFor(() => expect(downloadArrayBuffer).toHaveBeenCalledTimes(1));
  expect(exportFabrication).toHaveBeenCalledWith(
    expect.objectContaining({
      bodyIds: [bodies[0].id],
      mode: "separate",
      fullChecks: true,
    }),
    expect.any(AbortSignal),
    expect.any(Function),
  );
  const bytes = vi.mocked(downloadArrayBuffer).mock.calls[0][0];
  expect(new DataView(bytes).getUint32(80, true)).toBe(12);
  expect(useCadStore.getState().history.present).toBe(state.history.present);
});
it("selects the chosen body by ID and prevents empty, stale and replaced-project exports", () => {
  const state = useCadStore.getState(),
    selected = state.rebuild.result!.bodies[1];
  state.select({
    kind: "body",
    id: selected.id,
    documentId: state.history.present.id,
  });
  beginSaveOrExport();
  render(<FabricationPanel />);
  fireEvent.click(screen.getByRole("radio", { name: /Export for printing/ }));
  fireEvent.click(screen.getByRole("button", { name: "Use selected body" }));
  expect(useFileJobs.getState().exportBodyIds).toEqual([selected.id]);
  fireEvent.click(screen.getByRole("button", { name: "Clear body selection" }));
  expect(screen.getByRole("button", { name: "Generate STL" })).toBeDisabled();
  act(() => useCadStore.getState().setDocument(state.history.present));
  expect(screen.getByText(/Project replaced/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Generate STL" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Save editable project/ }));
  expect(
    screen.getByRole("button", { name: "Save editable project" }),
  ).toBeDisabled();
  expect(exportFabrication).not.toHaveBeenCalled();
  expect(downloadProject).not.toHaveBeenCalled();
});
it("saves invalid geometry as editable data while requiring a current successful rebuild for STL", () => {
  useCadStore.setState({
    rebuild: { ...useCadStore.getState().rebuild, status: "failed" },
  });
  beginSaveOrExport();
  render(<FabricationPanel />);
  expect(
    screen.getByRole("button", { name: "Save editable project" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("radio", { name: /Export for printing/ }));
  expect(screen.getByRole("button", { name: "Generate STL" })).toBeDisabled();
  expect(screen.getByText(/STL needs a successful rebuild/)).toBeVisible();
});
it("legacy options retain explicit advanced modes and prepared warnings are invalidated by edits", async () => {
  openFabrication();
  render(<FabricationPanel />);
  expect(
    screen.getByRole("dialog", { name: "STL export options" }),
  ).toBeVisible();
  expect(screen.getByLabelText("STL mode")).toBeVisible();
  fireEvent.change(screen.getByLabelText("STL mode"), {
    target: { value: "shells" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate STL" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Download with warnings" }),
    ).toBeVisible(),
  );
  expect(downloadArrayBuffer).not.toHaveBeenCalled();
  act(() =>
    useCadStore
      .getState()
      .updateDocument((document) => ({ ...document, name: "Changed" })),
  );
  expect(
    screen.queryByRole("button", { name: "Download with warnings" }),
  ).toBeNull();
  expect(useCadStore.getState().fileError).toMatch(
    /Model changed after validation/,
  );
});
it("links validator failures to an affected feature and preserves its original diagnostic", async () => {
  const state = useCadStore.getState(),
    body = state.rebuild.result!.bodies[0],
    message = `Body ${body.id}: open boundary edge`;
  vi.mocked(exportFabrication).mockRejectedValue(new Error(message));
  beginSaveOrExport();
  render(<FabricationPanel />);
  fireEvent.click(screen.getByRole("radio", { name: /Export for printing/ }));
  fireEvent.click(screen.getByRole("button", { name: "Generate STL" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Export diagnostic")).toHaveTextContent(
      message,
    ),
  );
  expect(screen.getByLabelText("Export diagnostic")).toHaveTextContent(
    "closed, consistently oriented",
  );
  fireEvent.click(screen.getByRole("button", { name: "Inspect First" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useCadStore.getState().selection.selectedIds[0]).toMatchObject({
    kind: "feature",
    id: body.featureId,
  });
  expect(downloadArrayBuffer).not.toHaveBeenCalled();
});
it("blocks entry during competing modeling/file tasks without opening a new task", () => {
  expect(canBeginSaveOrExport()).toBe(true);
  useCadStore.setState({ fileBusy: true });
  beginSaveOrExport();
  expect(useGuidedExport.getState().task).toBeUndefined();
  useCadStore.setState({ fileBusy: false });
  useProjectWorkflow.setState({
    active: {
      session: 3,
      documentId: useCadStore.getState().history.present.id,
      componentId: useCadStore.getState().activeComponentId,
      kind: "sketch",
    },
  });
  expect(canBeginSaveOrExport()).toBe(false);
  beginSaveOrExport();
  expect(useFileJobs.getState().exportOpen).toBe(false);
});
it("gives specific next actions for resource, overlap and coordinate failures", () => {
  const doc = useCadStore.getState().history.present;
  expect(
    exportDiagnostic("STL exceeds the total triangle resource limit.", doc)
      .advice,
  ).toMatch(/fewer bodies/);
  expect(
    exportDiagnostic("Bodies intersect, touch, or contain one another", doc)
      .advice,
  ).toMatch(/Separate files/);
  expect(exportDiagnostic("float32 collapsed triangle", doc).advice).toMatch(
    /closer to the origin/,
  );
});

it("shared command availability reacts to competing tasks and the open dialog", () => {
  const { result } = renderHook(useCommandEnablement);
  expect(result.current.saveOrExport).toBe(true);
  act(() =>
    useProjectWorkflow.setState({
      active: {
        kind: "component",
        session: 3,
        documentId: useCadStore.getState().history.present.id,
        componentId: useCadStore.getState().activeComponentId,
      },
    }),
  );
  expect(result.current.saveOrExport).toBe(false);
  act(() => runCommand("file.saveOrExport"));
  expect(useFileJobs.getState().exportOpen).toBe(false);
  act(() => useProjectWorkflow.setState({ active: undefined }));
  expect(result.current.saveOrExport).toBe(true);
  act(() => runCommand("file.saveOrExport"));
  expect(result.current.saveOrExport).toBe(false);
  act(() => useFileJobs.setState({ exportOpen: false }));
  expect(result.current.saveOrExport).toBe(true);
});
it("does not report a replaced document as saved during an asynchronous project download", async () => {
  let finish!: () => void;
  vi.mocked(downloadProject).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  beginSaveOrExport();
  render(<FabricationPanel />);
  fireEvent.click(
    screen.getByRole("button", { name: "Save editable project" }),
  );
  act(() =>
    useCadStore.getState().setDocument(useCadStore.getState().history.present),
  );
  await act(async () => finish());
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByLabelText("Save diagnostic")).toHaveTextContent(
    "Project changed while saving",
  );
  expect(
    screen.getByRole("button", { name: "Save editable project" }),
  ).toBeDisabled();
});

it("distinguishes prefix body IDs and mesh containment words from overlap diagnostics", () => {
  const state = useCadStore.getState(),
    document = state.history.present,
    result = state.rebuild.result!;
  const bodies = result.bodies.map((body, i) => ({
    ...body,
    id: i === 0 ? "body:f1" : "body:f10",
  }));
  expect(
    exportDiagnostic("Body body:f10: open boundary", document, {
      ...result,
      bodies,
    }).featureId,
  ).toBe(bodies[1].featureId);
  expect(
    exportDiagnostic("Mesh contains nonfinite coordinates", document).advice,
  ).toMatch(/origin/);
  expect(
    exportDiagnostic("Mesh contains degenerate triangles", document).advice,
  ).toMatch(/closed/);
});

it("goal changes clear only the previous file action error", () => {
  beginSaveOrExport();
  render(<FabricationPanel />);
  act(() =>
    useCadStore.getState().setFileError("Editable project could not be saved."),
  );
  expect(screen.getByLabelText("Save diagnostic")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: /Export for printing/ }));
  expect(screen.queryByLabelText("Export diagnostic")).toBeNull();
  act(() =>
    useCadStore.getState().setFileError("Body could not be triangulated."),
  );
  fireEvent.click(screen.getByRole("radio", { name: /Save editable project/ }));
  expect(screen.queryByLabelText("Save diagnostic")).toBeNull();
});
it("matches literal imported body IDs and specific stale-task messages", () => {
  const state = useCadStore.getState(),
    document = state.history.present,
    result = state.rebuild.result!,
    first = result.bodies[0],
    second = result.bodies[1];
  const bodies = [
    { ...first, id: "body:f.1" },
    { ...second, id: "body:fx1" },
  ];
  expect(
    exportDiagnostic("Body body:fx1: open boundary", document, {
      ...result,
      bodies,
    }).featureId,
  ).toBe(second.featureId);
  expect(
    exportDiagnostic("coordinate changed during float32 conversion", document)
      .advice,
  ).toMatch(/origin/);
  expect(
    exportDiagnostic("Project changed. Reopen this task.", document).advice,
  ).toMatch(/reopen/);
});

it("reports self-intersection as damaged source geometry, not overlapping parts", () => {
  for (const defect of ["self-intersection", "self-intersecting", "self intersects"]) {
    expect(
      exportDiagnostic(
        `Body body:f1: ${defect} between non-adjacent triangles.`,
        useCadStore.getState().history.present,
      ).advice,
    ).toMatch(/Repair its source feature/);
  }
});

it("reactively blocks guided file tasks during target scope capture at runtime and through the registry", () => {
  const before = useCadStore.getState();
  const { result } = renderHook(useCommandEnablement);
  expect(result.current.saveOrExport).toBe(true);
  act(() => useTargetScopeCapture.setState({ busy: true }));
  expect(useCadStore.getState()).toBe(before);
  expect(result.current.saveOrExport).toBe(false);
  expect(canBeginSaveOrExport()).toBe(false);
  act(() => beginSaveOrExport());
  expect(useFileJobs.getState().exportOpen).toBe(false);
  expect(useGuidedExport.getState().task).toBeUndefined();
  act(() => runCommand("file.saveOrExport"));
  expect(useFileJobs.getState().exportOpen).toBe(false);
  expect(useGuidedExport.getState().task).toBeUndefined();
  expect(useTargetScopeCapture.getState().busy).toBe(true);
  act(() => useTargetScopeCapture.setState({ busy: false }));
  expect(useCadStore.getState()).toBe(before);
  expect(result.current.saveOrExport).toBe(true);
  expect(canBeginSaveOrExport()).toBe(true);
  act(() => runCommand("file.saveOrExport"));
  expect(useFileJobs.getState().exportOpen).toBe(true);
  expect(useGuidedExport.getState().task?.document).toBe(
    before.history.present,
  );
  expect(useCadStore.getState().history).toBe(before.history);
});
