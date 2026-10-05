import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import {
  addCornerRectangle,
  createSketchOnPlane,
} from "../cad/sketch/SketchModel";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { sketchPlaneChoices } from "../cad/sketch/planePicking";
import type { OriginPlane } from "../cad/document/schema";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";
import { KERNEL_LINEAR_TOLERANCE } from "../cad/sketch/tolerances";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import {
  beginProjectWorkflow,
  useProjectWorkflow,
} from "../ui/commands/projectWorkflowCommand";
import {
  beginExtrudeCreation,
  useExtrudeDraft,
} from "../ui/commands/extrudeCommand";
import { useHoleDraft } from "../ui/commands/holeCommand";
import { currentAiFrame } from "../ui/commands/aiCommand";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import { useModelingDraft } from "../ui/commands/modelingDraftCommand";
import {
  beginGuidedHole,
  cancelGuidedHole,
  canBeginGuidedHole,
  chooseGuidedHoleFace,
  commitGuidedHole,
  guidedHoleCurrent,
  guidedHoleFaces,
  resolveGuidedHoleCenter,
  stageGuidedHole,
  useGuidedHole,
  type GuidedHoleInput,
} from "../ui/commands/guidedHoleCommand";
import {
  guidedFaceBoundary,
  guidedFaceBounds,
  guidedFaceClearance,
  guidedFaceContains,
  guidedFaceTriangles,
  type FaceTriangle,
} from "../cad/sketch/guidedHoleGeometry";
// Load the exact installed OpenCascade WASM bindings; geometry is not mocked.
vi.mock("opencascade.js/dist/opencascade.wasm.js", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const root = `${process.cwd()}/node_modules/opencascade.js/dist`;
  const filename = `${root}/opencascade.wasm.js`;
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
function box(plane: OriginPlane = "XY") {
  const sketch = addCornerRectangle(
    createSketchOnPlane("Outline", plane),
    "20mm",
    "10mm",
  );
  const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
  const feature = createExtrudeFeature({
    name: "Base",
    sketchId: sketch.id,
    profileId: profile.id,
    operation: "newBody",
    distance: { expression: "10mm", unit: "mm" },
    direction: "positive",
  });
  const document = upsertFeature(
    upsertSketch(createEmptyDocument(), sketch),
    feature,
  );
  const result = rebuildDocument(document);
  expect(result.success).toBe(true);
  expect(result.meshes[0].geometrySource).toBe("opencascade");
  const choice = sketchPlaneChoices(document, result).find(
    (c) => c.id === `extrude:${feature.id}:endCap`,
  )!;
  expect(choice).toBeDefined();
  return { document, result, feature, choice };
}

function resetStores() {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useGuidedHole.setState({ draft: undefined });
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useProjectWorkflow.setState({ active: undefined });
  useExtrudeDraft.setState({ draft: undefined });
  useHoleDraft.setState({ draft: undefined });
  useModelingDraft.setState({ draft: undefined });
}
beforeEach(resetStores);
afterEach(resetStores);
function start(unit: "mm" | "in" = "mm", plane: OriginPlane = "XY") {
  const base = box(plane);
  useCadStore.getState().setDocument({
    ...base.document,
    unitSettings: { ...base.document.unitSettings, length: unit },
  });
  const current = useCadStore.getState().history.present;
  const result = rebuildDocument(current);
  useCadStore.setState({
    rebuild: { kernelReady: true, status: "succeeded", result },
  });
  expect(canBeginGuidedHole()).toBe(true);
  beginGuidedHole();
  chooseGuidedHoleFace(base.choice.id);
  const draft = useGuidedHole.getState().draft!;
  const input: GuidedHoleInput = {
    centers: [{ id: "center", x: "5mm", y: "5mm" }],
    diameter: "2mm",
    depth: "3mm",
    throughAll: false,
  };
  return { ...base, draft, input };
}
it("places centers on current native face triangles, rejects invalid references and bounds, and stages immutable inward geometry", () => {
  const { draft, input } = start();
  expect(draft.phase).toBe("centers");
  expect(canBeginGuidedHole()).toBe(false);
  expect(() => chooseGuidedHoleFace("XY")).toThrow(
    /supported native planar face/,
  );
  const triangles = guidedFaceTriangles(draft.choice!, draft.result.meshes[0]);
  expect(guidedFaceContains(triangles, { x: 5, y: 5 })).toBe(true);
  expect(guidedFaceContains(triangles, { x: 25, y: 5 })).toBe(false);
  const bounds = guidedFaceBounds(triangles);
  expect(bounds.width).toBeCloseTo(24.8, 6);
  expect(bounds.height).toBeCloseTo(14.8, 6);
  expect(() => stageGuidedHole(draft, { ...input, centers: [] })).toThrow(
    /unique hole centers/,
  );
  expect(() =>
    stageGuidedHole(draft, {
      ...input,
      centers: [input.centers[0], input.centers[0]],
    }),
  ).toThrow(/unique hole centers/);
  expect(() =>
    stageGuidedHole(draft, {
      ...input,
      centers: [input.centers[0], { ...input.centers[0], id: "same-place" }],
    }),
  ).toThrow(/overlap/);
  expect(() =>
    stageGuidedHole(draft, {
      ...input,
      centers: [{ ...input.centers[0], x: "25mm" }],
    }),
  ).toThrow(/selected face/);
  expect(() => stageGuidedHole(draft, { ...input, diameter: "-1mm" })).toThrow(
    /positive length/,
  );
  expect(() => stageGuidedHole(draft, { ...input, depth: "4deg" })).toThrow(
    /positive length/,
  );
  expect(() =>
    resolveGuidedHoleCenter(draft, { ...input.centers[0], x: "missing" }),
  ).toThrow("Unknown parameter missing.");
  const staged = stageGuidedHole(draft, input);
  expect(useCadStore.getState().history.present).toBe(draft.document);
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(staged.feature).toMatchObject({
    id: draft.featureId,
    componentId: draft.componentId,
    sketchId: draft.sketchId,
    direction: "negative",
    targetBodyIds: [draft.choice!.bodyId],
    centerPointIds: ["center"],
  });
  expect(staged.document.sketches[draft.sketchId].plane).toEqual(
    draft.choice!.reference,
  );
  const native = rebuildDocument(staged.document);
  expect(native.success).toBe(true);
  expect(native.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    2000 - 3 * Math.PI,
    5,
  );
});
it("rejects canceled, stale selection, document session, component, file-busy and rebuild-result contexts without history edits", () => {
  const { draft, input } = start();
  const state = useCadStore.getState();
  for (const overrides of [
    { fileBusy: true },
    { activeComponentId: "another" },
    { documentSession: state.documentSession + 1 },
    {
      selection: {
        selectedIds: [
          {
            kind: "feature" as const,
            id: "another",
            documentId: draft.document.id,
          },
        ],
      },
    },
    { rebuild: { ...state.rebuild, status: "queued" as const } },
    { rebuild: { ...state.rebuild, result: { ...draft.result } } },
  ]) {
    useCadStore.setState({ ...state, ...overrides }, true);
    expect(guidedHoleCurrent(draft)).toBe(false);
    expect(() => stageGuidedHole(draft, input)).toThrow(/changed/);
    expect(useCadStore.getState().history.past).toHaveLength(0);
  }
  useCadStore.setState(state, true);
  const staged = stageGuidedHole(draft, input),
    native = rebuildDocument(staged.document);
  cancelGuidedHole();
  expect(() => commitGuidedHole(draft, staged, native)).toThrow(/changed/);
  expect(useCadStore.getState().history.present).toBe(draft.document);
  expect(useCadStore.getState().history.past).toHaveLength(0);
  useCadStore.getState().setDocument(draft.document);
  expect(guidedHoleCurrent(draft)).toBe(false);
});
it("requires every native target cut before committing sketch and Hole together in one undo step", () => {
  const { draft, input } = start();
  const staged = stageGuidedHole(draft, input),
    native = rebuildDocument(staged.document);
  for (const bad of [
    { ...native, documentId: "another" },
    { ...native, success: false },
    {
      ...native,
      meshes: native.meshes.map((m) => ({
        ...m,
        geometrySource: "fallback" as const,
      })),
    },
    {
      ...native,
      meshes: native.meshes.map((m) => ({
        ...m,
        kernelOperation: "extrusion" as const,
      })),
    },
    {
      ...native,
      meshes: native.meshes.map((m) => ({
        ...m,
        geometryAssertions: { ...m.geometryAssertions!, volume: 0 },
      })),
    },
  ]) {
    expect(() => commitGuidedHole(draft, staged, bad)).toThrow();
    expect(useCadStore.getState().history.present).toBe(draft.document);
    expect(useCadStore.getState().history.past).toHaveLength(0);
  }
  commitGuidedHole(draft, staged, native);
  const after = useCadStore.getState().history.present;
  expect(useCadStore.getState().history.past).toHaveLength(1);
  expect(useGuidedHole.getState().draft).toBeUndefined();
  expect(after.features).toHaveLength(draft.document.features.length + 1);
  expect(Object.keys(after.sketches)).toHaveLength(
    Object.keys(draft.document.sketches).length + 1,
  );
  expect(
    importProjectText(serializeProject(after)).features.find(
      (f) => f.id === draft.featureId,
    ),
  ).toMatchObject({ direction: "negative" });
  useCadStore.getState().undo();
  expect(useCadStore.getState().history.present).toBe(draft.document);
  expect(
    rebuildDocument(useCadStore.getState().history.present).meshes[0]
      .geometryAssertions!.volume,
  ).toBeCloseTo(2000, 5);
  useCadStore.getState().redo();
  expect(useCadStore.getState().history.present).toBe(after);
  expect(
    rebuildDocument(after).meshes[0].geometryAssertions!.volume,
  ).toBeCloseTo(2000 - 3 * Math.PI, 5);
});
it("excludes existing openings from a retained cap's placement surface", () => {
  const { draft, input } = start();
  const staged = stageGuidedHole(draft, { ...input, throughAll: true });
  const result = rebuildDocument(staged.document);
  expect(result.success).toBe(true);
  useCadStore.getState().setDocument(staged.document);
  useCadStore.setState({
    rebuild: { kernelReady: true, status: "succeeded", result },
  });
  cancelGuidedHole();
  const face = guidedHoleFaces().find((f) => f.id === draft.choice!.id)!;
  expect(face).toBeDefined();
  const triangles = guidedFaceTriangles(face, result.meshes[0]);
  expect(guidedFaceContains(triangles, { x: 5, y: 5 })).toBe(false);
  expect(guidedFaceContains(triangles, { x: 12, y: 5 })).toBe(true);
  beginGuidedHole();
  chooseGuidedHoleFace(face.id);
  expect(() => stageGuidedHole(useGuidedHole.getState().draft!, input)).toThrow(
    /outside existing openings/,
  );
});

it("captures bare center and size authored units so later project-default changes cannot resize holes", () => {
  const { draft, input } = start("in");
  const staged = stageGuidedHole(draft, {
    ...input,
    centers: [{ id: "inch-center", x: "0.2", y: "0.2" }],
    diameter: "0.1",
    depth: "0.1",
  });
  expect(staged.centers).toHaveLength(1);
  expect(staged.centers[0].x).toBeCloseTo(5.08, 6);
  expect(staged.centers[0].y).toBeCloseTo(5.08, 6);
  expect(staged.feature.diameter).toMatchObject({
    expression: "0.1",
    authoredUnit: "in",
    unit: "mm",
  });
  expect(staged.feature.depth).toMatchObject({
    expression: "0.1",
    authoredUnit: "in",
    unit: "mm",
  });
  const restored = importProjectText(
    serializeProject({
      ...staged.document,
      unitSettings: { ...staged.document.unitSettings, length: "mm" },
    }),
  );
  const result = rebuildDocument(restored);
  expect(result.success).toBe(true);
  expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    2000 - Math.PI * 1.27 ** 2 * 2.54,
    5,
  );
});

it("offers guided Hole only for current native faces and blocks competing sketch/project workflows", () => {
  const { draft } = start();
  cancelGuidedHole();
  expect(canBeginGuidedHole()).toBe(true);
  const state = useCadStore.getState();
  for (const overrides of [
    { fileBusy: true },
    { activeComponentId: "other" },
    { rebuild: { ...state.rebuild, kernelReady: false } },
    { rebuild: { ...state.rebuild, status: "queued" as const } },
    {
      rebuild: {
        ...state.rebuild,
        result: { ...draft.result, documentId: "another" },
      },
    },
    {
      rebuild: {
        ...state.rebuild,
        result: { ...draft.result, success: false },
      },
    },
    {
      rebuild: {
        ...state.rebuild,
        result: {
          ...draft.result,
          meshes: draft.result.meshes.map((m) => ({
            ...m,
            geometrySource: "fallback" as const,
          })),
        },
      },
    },
  ]) {
    useCadStore.setState({ ...state, ...overrides }, true);
    expect(guidedHoleFaces()).toEqual([]);
    expect(canBeginGuidedHole()).toBe(false);
  }
  useCadStore.setState(state, true);
  useSketchCanvas.setState({
    active: {
      documentId: draft.document.id,
      session: draft.session,
      sketchId: Object.keys(draft.document.sketches)[0],
    },
  });
  expect(canBeginGuidedHole()).toBe(false);
  useSketchCanvas.setState({ active: undefined });
  useProjectWorkflow.setState({
    active: {
      documentId: draft.document.id,
      session: draft.session,
      componentId: draft.componentId,
      kind: "sketch",
    },
  });
  expect(canBeginGuidedHole()).toBe(false);
});
it("rejects more than the supported number of centers before creating geometry", () => {
  const { draft, input } = start();
  const centers = Array.from(
    { length: MODEL_RESOURCE_LIMITS.maxHoleCenters + 1 },
    (_, i) => ({ ...input.centers[0], id: `center-${i}` }),
  );
  expect(() => stageGuidedHole(draft, { ...input, centers })).toThrow(
    /unique hole centers/,
  );
  expect(useCadStore.getState().history.present).toBe(draft.document);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("computes finite placement bounds for a face at the supported triangle resource limit", () => {
  const triangle: [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
  ];
  const triangles = Array.from(
    { length: MODEL_RESOURCE_LIMITS.maxTrianglesPerBody },
    () => triangle,
  );
  const bounds = guidedFaceBounds(triangles);
  // The guide adds a 12% margin around a 20mm × 10mm face.
  expect(bounds.x).toBeCloseTo(-2.4, 6);
  expect(bounds.y).toBeCloseTo(-12.4, 6);
  expect(bounds.width).toBeCloseTo(24.8, 6);
  expect(bounds.height).toBeCloseTo(14.8, 6);
});

it("reacts immediately to extrusion and project workflow opening and cancellation without a CAD store change", () => {
  const { draft } = start();
  cancelGuidedHole();
  const cadState = useCadStore.getState();
  const hook = renderHook(() => useCommandEnablement());
  expect(hook.result.current.createGuidedHole).toBe(true);
  act(() => beginExtrudeCreation(Object.keys(draft.document.sketches)[0]));
  expect(useExtrudeDraft.getState().draft).toBeDefined();
  expect(hook.result.current.createGuidedHole).toBe(false);
  expect(useCadStore.getState()).toBe(cadState);
  act(() => useExtrudeDraft.setState({ draft: undefined }));
  expect(hook.result.current.createGuidedHole).toBe(true);
  act(() => beginProjectWorkflow("sketch"));
  expect(useProjectWorkflow.getState().active).toBeDefined();
  expect(hook.result.current.createGuidedHole).toBe(false);
  expect(useCadStore.getState()).toBe(cadState);
  act(() => useProjectWorkflow.setState({ active: undefined }));
  expect(hook.result.current.createGuidedHole).toBe(true);
  expect(useCadStore.getState()).toBe(cadState);
  hook.unmount();
});

it("rejects circular holes extending beyond a native face edge before changing the document", () => {
  const { draft, input } = start();
  const nearEdge = { ...input, centers: [{ ...input.centers[0], x: "0.5mm" }] };
  const triangles = guidedFaceTriangles(draft.choice!, draft.result.meshes[0]);
  expect(guidedFaceContains(triangles, { x: 0.5, y: 5 })).toBe(true);
  expect(() => stageGuidedHole(draft, nearEdge)).toThrow(
    /fit entirely.*face edges/,
  );
  expect(() => stageGuidedHole(draft, { ...input, diameter: "12mm" })).toThrow(
    /fit entirely/,
  );
  const tangent = stageGuidedHole(draft, {
    ...input,
    centers: [{ ...input.centers[0], x: "1mm" }],
  });
  expect(rebuildDocument(tangent.document).success).toBe(true);
  const small = stageGuidedHole(draft, {
    ...input,
    diameter: "0.2mm",
    centers: [{ ...input.centers[0], x: "0.1mm" }],
  });
  expect(
    rebuildDocument(small.document).meshes[0].geometryAssertions!.volume,
  ).toBeCloseTo(2000 - 0.03 * Math.PI, 5);
  expect(useCadStore.getState().history.present).toBe(draft.document);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("rejects distinct overlapping circles, accepts tangent placement, and models separated holes with exact native volume", () => {
  const { draft, input } = start();
  const pair = (x: string) => ({
    ...input,
    centers: [input.centers[0], { ...input.centers[0], id: "second", x }],
  });
  expect(() => stageGuidedHole(draft, pair("6.5mm"))).toThrow(
    "Circular holes overlap. Move centers farther apart or reduce the diameter.",
  );
  expect(() => stageGuidedHole(draft, pair("7mm"))).not.toThrow();
  const staged = stageGuidedHole(draft, pair("8mm"));
  const result = rebuildDocument(staged.document);
  expect(result.success).toBe(true);
  expect(result.meshes[0].geometryAssertions).toMatchObject({
    valid: true,
    solidCount: 1,
  });
  expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    2000 - 6 * Math.PI,
    5,
  );
  expect(useCadStore.getState().history.present).toBe(draft.document);
});
it("rejects a circle overlapping an existing native opening even when its center lies on material", () => {
  const { draft, input } = start();
  const first = stageGuidedHole(draft, { ...input, throughAll: true });
  useCadStore.getState().setDocument(first.document);
  const result = rebuildDocument(useCadStore.getState().history.present);
  expect(result.success).toBe(true);
  useCadStore.setState({
    rebuild: { kernelReady: true, status: "succeeded", result },
  });
  cancelGuidedHole();
  beginGuidedHole();
  chooseGuidedHoleFace(draft.choice!.id);
  const next = useGuidedHole.getState().draft!;
  const triangles = guidedFaceTriangles(next.choice!, next.result.meshes[0]);
  expect(guidedFaceContains(triangles, { x: 6.5, y: 5 })).toBe(true);
  expect(() =>
    stageGuidedHole(next, {
      ...input,
      centers: [{ id: "new-center", x: "6.5mm", y: "5mm" }],
    }),
  ).toThrow(/fit entirely.*existing openings/);
  // Place a new circle almost tangent to the true opening at the midpoint of
  // an actual native contour chord. Polygon-only clearance would permit this
  // tiny overlap; curved contour uncertainty must reject it before preview.
  const contour = guidedFaceBoundary(triangles);
  const chord = contour.find(
    ({ points: [a, b], clearanceAllowance }) =>
      clearanceAllowance > 0 &&
      Math.abs(Math.hypot(a.x - 5, a.y - 5) - 1) < 1e-5 &&
      Math.abs(Math.hypot(b.x - 5, b.y - 5) - 1) < 1e-5,
  )!;
  expect(chord).toBeDefined();
  const [a, b] = chord.points;
  const midX = (a.x + b.x) / 2 - 5,
    midY = (a.y + b.y) / 2 - 5;
  const directionLength = Math.hypot(midX, midY);
  const nearCurve = {
    x: 5 + (midX / directionLength) * 1.99999,
    y: 5 + (midY / directionLength) * 1.99999,
  };
  expect(guidedFaceContains(triangles, nearCurve)).toBe(true);
  expect(() =>
    stageGuidedHole(next, {
      ...input,
      centers: [
        { id: "curve-center", x: `${nearCurve.x}mm`, y: `${nearCurve.y}mm` },
      ],
    }),
  ).toThrow(/boundaries need extra clearance/);
  const separated = stageGuidedHole(next, {
    ...input,
    centers: [{ id: "new-center", x: "8mm", y: "5mm" }],
  });
  const drilled = rebuildDocument(separated.document);
  expect(drilled.success).toBe(true);
  expect(drilled.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    2000 - 13 * Math.PI,
    5,
  );
  expect(useCadStore.getState().history.present).toBe(next.document);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("keeps conservative clearance for a tiny coarsely tessellated native opening", () => {
  const { draft, input } = start();
  const first = stageGuidedHole(draft, {
    ...input,
    diameter: "0.02mm",
    throughAll: true,
  });
  useCadStore.getState().setDocument(first.document);
  const result = rebuildDocument(useCadStore.getState().history.present);
  expect(result.success).toBe(true);
  expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    2000 - 0.001 * Math.PI,
    6,
  );
  useCadStore.setState({
    rebuild: { kernelReady: true, status: "succeeded", result },
  });
  cancelGuidedHole();
  beginGuidedHole();
  chooseGuidedHoleFace(draft.choice!.id);
  const next = useGuidedHole.getState().draft!;
  const boundary = guidedFaceBoundary(
    guidedFaceTriangles(next.choice!, result.meshes[0]),
  );
  const opening = boundary.filter(({ points }) =>
    points.every((p) => Math.abs(Math.hypot(p.x - 5, p.y - 5) - 0.01) < 1e-6),
  );
  expect(opening.length).toBeGreaterThan(0);
  expect(opening.every((edge) => edge.clearanceAllowance > 0)).toBe(true);
  expect(() =>
    stageGuidedHole(next, {
      ...input,
      diameter: "0.02mm",
      centers: [{ id: "new-center", x: "5.019999mm", y: "5mm" }],
    }),
  ).toThrow(/boundaries need extra clearance/);
  expect(useCadStore.getState().history.present).toBe(next.document);
});
it("rejects opposite-facing placement triangles and stays in face selection when no current surface exists", () => {
  const { draft } = start();
  const mesh = draft.result.meshes[0];
  const reversed = {
    ...mesh,
    indices: mesh.indices.flatMap((_, i, indices) =>
      i % 3 === 0 ? [indices[i], indices[i + 2], indices[i + 1]] : [],
    ),
  };
  expect(guidedFaceTriangles(draft.choice!, reversed)).toEqual([]);
  cancelGuidedHole();
  // Corrupt only runtime tessellation orientation to exercise the defensive
  // selection guard; all normal modeling fixtures above use actual native results.
  useCadStore.setState({
    rebuild: {
      kernelReady: true,
      status: "succeeded",
      result: { ...draft.result, meshes: [reversed] },
    },
  });
  beginGuidedHole();
  expect(useGuidedHole.getState().draft?.phase).toBe("face");
  expect(() => chooseGuidedHoleFace(draft.choice!.id)).toThrow(
    /no current native placement surface/,
  );
  expect(useGuidedHole.getState().draft?.phase).toBe("face");
  expect(useCadStore.getState().history.present).toBe(draft.document);
});

it.each(["XY", "XZ", "YZ"] as const)(
  "contains guided circular holes on native %s cap triangulation",
  (plane) => {
    const { draft, input } = start("mm", plane);
    expect(
      guidedFaceTriangles(draft.choice!, draft.result.meshes[0]).length,
    ).toBeGreaterThan(0);
    expect(() =>
      stageGuidedHole(draft, {
        ...input,
        centers: [{ ...input.centers[0], x: "0.5mm" }],
      }),
    ).toThrow(/fit entirely/);
    const staged = stageGuidedHole(draft, input);
    const result = rebuildDocument(staged.document);
    expect(result.success).toBe(true);
    expect(result.meshes[0].geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(
      2000 - 3 * Math.PI,
      5,
    );
  },
);

it("keeps nondegenerate front-facing tessellation slivers rather than creating artificial guide gaps", () => {
  const { draft } = start();
  const choice = draft.choice!;
  const point = (x: number, y: number) => ({
    x:
      choice.transform.origin.x +
      x * choice.transform.u.x +
      y * choice.transform.v.x,
    y:
      choice.transform.origin.y +
      x * choice.transform.u.y +
      y * choice.transform.v.y,
    z:
      choice.transform.origin.z +
      x * choice.transform.u.z +
      y * choice.transform.v.z,
  });
  const points = [point(0, 0), point(1, 0), point(1, 1e-11)];
  const mesh = {
    ...draft.result.meshes[0],
    positions: points.flatMap((p) => [p.x, p.y, p.z]),
    indices: [0, 1, 2],
  };
  expect(guidedFaceTriangles(choice, mesh)).toHaveLength(1);
});

it("preserves material clearance across duplicated native vertices with float noise at a spatial bucket seam", () => {
  // Two coplanar triangles share a diagonal, with independently emitted near-
  // identical endpoints. The diagonal must not become a placement boundary.
  const triangles: FaceTriangle[] = [
    [
      { x: KERNEL_LINEAR_TOLERANCE * 0.51, y: 0 },
      { x: 10, y: 0 },
      { x: 10 - KERNEL_LINEAR_TOLERANCE / 100, y: 10 },
    ],
    [
      { x: KERNEL_LINEAR_TOLERANCE * 0.49, y: 0 },
      { x: 10 + KERNEL_LINEAR_TOLERANCE / 100, y: 10 },
      { x: 0, y: 10 },
    ],
  ];
  const corners = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const straightEdges = corners.map(
    (point, i): [typeof point, typeof point] => [point, corners[(i + 1) % 4]],
  );
  expect(guidedFaceContains(triangles, { x: 5, y: 5 })).toBe(true);
  const boundary = guidedFaceBoundary(triangles, straightEdges);
  expect(guidedFaceClearance(boundary, { x: 5, y: 5 })).toBeCloseTo(5, 6);
  // A real gap wider than modeling tolerance must still prevent placement;
  // tolerant joining cannot erase material boundaries.
  const separated: FaceTriangle[] = [
    triangles[0],
    [
      { x: -4 * KERNEL_LINEAR_TOLERANCE, y: 0 },
      { x: 10 - 4 * KERNEL_LINEAR_TOLERANCE, y: 10 },
      { x: 0, y: 10 },
    ],
  ];
  const gap = { x: 5 - KERNEL_LINEAR_TOLERANCE, y: 5 };
  expect(guidedFaceContains(separated, gap)).toBe(false);
  const separatedBoundary = guidedFaceBoundary(separated, straightEdges);
  expect(guidedFaceClearance(separatedBoundary, gap)).toBeLessThan(0);
  expect(guidedFaceContains(separated, { x: 8, y: 2 })).toBe(true);
  expect(guidedFaceClearance(separatedBoundary, { x: 8, y: 2 })).toBeCloseTo(
    2,
    6,
  );
});

it("invalidates pending AI frames during guided hole placement and restores them on cancel without changing the document", () => {
  const { draft } = start();
  const frame = {
    document: draft.document,
    session: draft.session,
    componentId: draft.componentId,
  };
  const cadState = useCadStore.getState();
  expect(currentAiFrame(frame)).toBe(false);
  cancelGuidedHole();
  expect(currentAiFrame(frame)).toBe(true);
  beginGuidedHole();
  expect(currentAiFrame(frame)).toBe(false);
  cancelGuidedHole();
  expect(currentAiFrame(frame)).toBe(true);
  expect(useCadStore.getState()).toBe(cadState);
});
