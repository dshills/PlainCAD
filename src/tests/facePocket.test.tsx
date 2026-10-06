import { registerCameraController } from "../viewer/cameraController";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { createSketchOnPlane, createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { resolveDocumentPlanes } from "../cad/sketch/planes";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { assertNativePocketPreview, useExtrudeDraft } from "../ui/commands/extrudeCommand";
import { beginFacePocket, cancelFacePocket, chooseFacePocketFace, drawOnPocketFace, facePocketCurrent, facePocketFaces, useFacePocket } from "../ui/commands/facePocketCommand";
import { beginSketchSolidHandoff, canRemoveSketchMaterial, refreshSketchSolidHandoff, removeSketchMaterial, useSketchSolidHandoff } from "../ui/commands/sketchSolidHandoffCommand";
import { useOperationDrop } from "../ui/commands/operationDropCommand";
import { useFacePocketIntent } from "../ui/commands/facePocketIntentState";
import { SketchSolidHandoffPanel } from "../ui/panels/SketchSolidHandoffPanel";
import { FacePocketPanel } from "../ui/panels/FacePocketPanel";

function fixture() {
  const base = createXySketch("Plate outline");
  const sketch = addCanvasGeometry(base, solveSketch(base, {}), "rectangle", [{ x: 0, y: 0 }, { x: 40, y: 30 }]).sketch;
  let document = upsertSketch(createEmptyDocument(), sketch);
  const profile = rebuildDocument(document).profiles![sketch.id][0];
  const feature = createExtrudeFeature({ name: "Plate", sketchId: sketch.id, profileId: profile.id,
    direction: "positive", operation: "newBody", distance: { expression: "10mm", unit: "mm" } });
  document = upsertFeature(document, feature);
  const result = rebuildDocument(document);
  // Boundary tests use explicit native proof metadata; browser acceptance obtains real OpenCascade proof.
  result.meshes = result.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade", geometryAssertions: { valid: true as const, solidCount: 1, surfaceArea: 3800, volume: 12000 } }));
  result.availableFaces = resolveDocumentPlanes(document, {}).faces;
  useCadStore.setState({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId,
    rebuild: { status: "succeeded", kernelReady: true, result } });
  return { document, result, feature };
}
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useViewerState.setState({ session: -1, hiddenBodyIds: [], hiddenSketchIds: [], hiddenComponentIds: [] });
  cancelFacePocket();
  useFacePocketIntent.setState({ source: undefined });
  useSketchCanvas.setState({ active: undefined });
  useExtrudeDraft.setState({ draft: undefined });
  useOperationDrop.setState({ frame: undefined });
  useSketchSolidHandoff.setState({ source: undefined });
});
afterEach(() => { cleanup(); cancelFacePocket(); useSketchCanvas.setState({ active: undefined }); useExtrudeDraft.setState({ draft: undefined }); useOperationDrop.setState({ frame: undefined }); useSketchSolidHandoff.setState({ source: undefined }); });
it("selects an explicit supported face without editing history and creates one editable face sketch on Draw here", () => {
  const { document, feature } = fixture();
  beginFacePocket();
  const initial = useCadStore.getState().history;
  render(<FacePocketPanel />);
  expect(screen.getByRole("button", { name: "Draw here" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Plate — end cap" }));
  expect(screen.getByRole("status")).toHaveTextContent("inward");
  expect(useCadStore.getState().history).toBe(initial);
  fireEvent.click(screen.getByRole("button", { name: "Draw here" }));
  const state = useCadStore.getState();
  expect(state.history.past).toHaveLength(1);
  const active = useSketchCanvas.getState().active!;
  expect(state.history.present.sketches[active.sketchId].plane).toEqual({ type: "face", featureId: feature.id, stableFaceId: `extrude:${feature.id}:endCap` });
  expect(state.history.present.features).toEqual(document.features);
  expect(useFacePocket.getState().frame).toBeUndefined();
});
it("rejects stale result identity and same-ID document replacement; cancellation leaves no CAD edit", () => {
  fixture(); beginFacePocket();
  const frame = useFacePocket.getState().frame!;
  const before = useCadStore.getState();
  useCadStore.setState({ rebuild: { ...before.rebuild, result: { ...before.rebuild.result! } } });
  expect(facePocketCurrent(frame)).toBe(false);
  expect(() => chooseFacePocketFace(facePocketFaces()[0].id)).toThrow(/geometry changed/);
  useCadStore.setState(before, true);
  useCadStore.setState({ history: { ...before.history, present: { ...before.history.present } } });
  expect(() => drawOnPocketFace()).toThrow(/geometry changed/);
  cancelFacePocket();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("excludes hidden/inactive/fallback/unsupported faces instead of guessing a target", () => {
  const { result } = fixture();
  const state = useCadStore.getState();
  expect(facePocketFaces()).toHaveLength(6);
  useViewerState.setState({ session: state.documentSession, hiddenBodyIds: [result.bodies[0].id] });
  expect(facePocketFaces()).toEqual([]);
  useViewerState.setState({ session: -1 });
  useCadStore.setState({ rebuild: { ...state.rebuild, result: { ...result, availableFaces: [] } } });
  expect(() => beginFacePocket()).toThrow(/Curved, split, lost/);
});
it("opens a cut preview locked to the chosen face body and rejects unchanged or redirected proof", () => {
  const { result, feature } = fixture();
  beginFacePocket(); chooseFacePocketFace(`extrude:${feature.id}:endCap`); drawOnPocketFace();
  const state = useCadStore.getState(), sketchId = useSketchCanvas.getState().active!.sketchId;
  const sketch = addCanvasGeometry(state.history.present.sketches[sketchId], solveSketch(state.history.present.sketches[sketchId], {}), "rectangle", [{ x: 10, y: 10 }, { x: 20, y: 20 }]).sketch;
  const document = upsertSketch(state.history.present, sketch);
  const analysis = rebuildDocument(document); analysis.meshes = result.meshes; analysis.availableFaces = result.availableFaces;
  useSketchCanvas.setState({ active: undefined });
  useCadStore.setState({ history: { ...state.history, present: document }, rebuild: { status: "succeeded", kernelReady: true, result: analysis } });
  beginSketchSolidHandoff(sketchId);
  expect(useSketchSolidHandoff.getState().source?.pocketIntent).toBe(true);
  refreshSketchSolidHandoff(useSketchSolidHandoff.getState().source!);
  expect(canRemoveSketchMaterial()).toBe(true);
  const history = useCadStore.getState().history;
  removeSketchMaterial();
  const draft = useExtrudeDraft.getState().draft!;
  expect(draft.feature).toMatchObject({ operation: "cut", direction: "negative", targetBodyIds: [result.bodies[0].id] });
  expect(useCadStore.getState().history).toBe(history);
  const changed = { ...analysis, meshes: analysis.meshes.map((mesh) => ({ ...mesh, kernelOperation: "cut" as const, geometryAssertions: { valid: true as const, solidCount: 1, surfaceArea: 3800, volume: 11800 } })) };
  expect(() => assertNativePocketPreview(draft, changed, draft.feature)).not.toThrow();
  expect(() => assertNativePocketPreview(draft, { ...changed, meshes: changed.meshes.map((mesh) => ({ ...mesh, geometryAssertions: { valid: true as const, solidCount: 1, surfaceArea: 3800, volume: 12000 } })) }, draft.feature)).toThrow(/remove measurable material/);
  expect(() => assertNativePocketPreview(draft, changed, { ...draft.feature, direction: "positive" })).toThrow(/inward direction/);
  expect(() => assertNativePocketPreview(draft, changed, { ...draft.feature, targetBodyIds: ["wrong"] })).toThrow(/face body/);
});

it("preserves ordinary face sketch guidance unless Draw here captured pocket intent", () => {
  const { document, result, feature } = fixture();
  const base = createSketchOnPlane("Boss outline", { type: "face", featureId: feature.id, stableFaceId: `extrude:${feature.id}:endCap` });
  const sketch = addCanvasGeometry(base, solveSketch(base, {}), "rectangle", [{ x: 10, y: 10 }, { x: 20, y: 20 }]).sketch;
  const authored = upsertSketch(document, sketch), analysis = rebuildDocument(authored);
  analysis.meshes = result.meshes; analysis.availableFaces = result.availableFaces;
  useCadStore.setState({ history: { past: [], present: authored, future: [] }, rebuild: { status: "succeeded", kernelReady: true, result: analysis } });
  beginSketchSolidHandoff(sketch.id); refreshSketchSolidHandoff(useSketchSolidHandoff.getState().source!);
  render(<SketchSolidHandoffPanel />);
  expect(screen.getByRole("heading", { name: "Boss outline: make it solid" })).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Make solid" })).toBeVisible();
});

it("keeps the face picker and history unchanged when camera alignment fails", () => {
  const { feature } = fixture();
  beginFacePocket(); chooseFacePocketFace(`extrude:${feature.id}:endCap`);
  const history = useCadStore.getState().history, frame = useFacePocket.getState().frame;
  const unregister = registerCameraController({ read: () => { throw new Error("Camera unavailable"); }, apply: () => false, preset: () => {} });
  try {
    expect(() => drawOnPocketFace()).toThrow("Camera unavailable");
    expect(useCadStore.getState().history).toBe(history);
    expect(useFacePocket.getState().frame).toBe(frame);
    expect(useFacePocketIntent.getState().source).toBeUndefined();
  } finally { unregister(); }
});
