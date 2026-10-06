import { useFacePocketIntent } from "./facePocketIntentState";
import { interactionDraftBusy, useFacePocket } from "./interactionDraftState";
export { useFacePocket } from "./interactionDraftState";
import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { featureComponentId } from "../../cad/document/components";
import { upsertSketch } from "../../cad/document/CadDocument";
import { createSketchOnPlane } from "../../cad/sketch/SketchModel";
import { sketchPlaneChoices, type SketchPlaneChoice } from "../../cad/sketch/planePicking";
import { guidedFaceTriangles } from "../../cad/sketch/guidedHoleGeometry";
import { hiddenViewerBodies, useViewerState } from "../../state/viewerState";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { alignToSketchPlane, useSketchPlanePicker } from "./sketchPlanePicker";
import { beginSketchCanvas, useSketchCanvas } from "./sketchCanvasCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useHoleDraft } from "./holeCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useFileJobs } from "../../persistence/fileJobs";

export interface FacePocketFrame {
  kind: "facePocket";
  document: CadDocument;
  result: RebuildResult;
  session: number;
  componentId: string;
  choiceId?: string;
}
function competingFaceTask() {
  return interactionDraftBusy("facePocket") || useSketchCanvas.getState().active || operationDraftBusy() ||
    useGuidedHole.getState().draft || useExtrudeDraft.getState().draft || useModelingDraft.getState().draft ||
    useHoleDraft.getState().draft || useProjectWorkflow.getState().active || useFileJobs.getState().exportOpen;
}
export function facePocketFaces(state: CadStore = useCadStore.getState()) {
  const result = state.rebuild.result;
  if (state.fileBusy || state.rebuild.status !== "succeeded" || !state.rebuild.kernelReady ||
      !result?.success || result.documentId !== state.history.present.id) return [];
  const hidden = hiddenViewerBodies(state.history.present, result.meshes.map((mesh) => mesh.bodyId),
    state.documentSession, useViewerState.getState());
  return sketchPlaneChoices(state.history.present, result).filter((choice) => {
    if (!choice.bodyId || typeof choice.reference === "string" || hidden.includes(choice.bodyId)) return false;
    const reference = choice.reference;
    const owner = state.history.present.features.find((feature) => feature.id === reference.featureId);
    const mesh = result.meshes.find((item) => item.bodyId === choice.bodyId);
    return Boolean(owner && featureComponentId(state.history.present, owner) === state.activeComponentId &&
      mesh?.geometrySource === "opencascade" && mesh.geometryAssertions?.valid &&
      mesh.geometryAssertions.solidCount === 1 && mesh.geometryAssertions.volume > 0 &&
      guidedFaceTriangles(choice, mesh).length);
  });
}
export function canBeginFacePocket(state: CadStore = useCadStore.getState()) {
  return !useFacePocket.getState().frame && !competingFaceTask() && facePocketFaces(state).length > 0;
}
export function beginFacePocket() {
  const state = useCadStore.getState();
  if (!canBeginFacePocket(state)) throw new Error("Choose an active component with a visible native distance-extrusion planar face. Curved, split, lost and ambiguous faces are unsupported.");
  useSketchPlanePicker.setState({ hover: undefined, error: undefined, offset: undefined });
  useFacePocket.setState({ frame: { kind: "facePocket", document: state.history.present,
    result: state.rebuild.result!, session: state.documentSession, componentId: state.activeComponentId } });
}
export function facePocketCurrent(frame: FacePocketFrame, state: CadStore = useCadStore.getState()) {
  return useFacePocket.getState().frame === frame && !state.fileBusy && !competingFaceTask() &&
    state.history.present === frame.document && state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId && state.rebuild.status === "succeeded" &&
    state.rebuild.result === frame.result;
}
export function chooseFacePocketFace(choiceId: string) {
  const frame = useFacePocket.getState().frame;
  if (!frame || !facePocketCurrent(frame)) throw new Error("The project, component or geometry changed. Cancel and choose the face again.");
  if (!facePocketFaces().some((choice) => choice.id === choiceId))
    throw new Error("Choose a visible, current supported planar face in the active component. Curved, lost, split and ambiguous faces are unavailable.");
  useFacePocket.setState({ frame: { ...frame, choiceId } });
  useSketchPlanePicker.setState({ error: undefined });
}
export function drawOnPocketFace() {
  const frame = useFacePocket.getState().frame;
  if (!frame || !facePocketCurrent(frame)) throw new Error("The project, component or geometry changed. Cancel and choose the face again.");
  const choice: SketchPlaneChoice | undefined = facePocketFaces().find((item) => item.id === frame.choiceId);
  if (!choice || typeof choice.reference === "string") throw new Error("Select a supported planar face before choosing Draw here.");
  const sketch = { ...createSketchOnPlane(`Pocket sketch ${Object.keys(frame.document.sketches).length + 1}`, choice.reference), componentId: frame.componentId };
  // Camera setup is view-only. Validate it before publishing the authored sketch,
  // so a renderer/controller error leaves the picker available for retry.
  alignToSketchPlane(choice);
  const state = useCadStore.getState();
  state.updateDocument((document) => document === frame.document ? upsertSketch(document, sketch) : document);
  if (!useCadStore.getState().history.present.sketches[sketch.id]) throw new Error("The face sketch could not be created. Check Issues and choose the face again.");
  try {
    state.select({ kind: "sketch", id: sketch.id, documentId: frame.document.id });
    const active = beginSketchCanvas(sketch.id);
    if (!active) throw new Error("Sketch drawing is unavailable.");
    // Publish pocket intent only after the authored sketch is actually open.
    useFacePocketIntent.setState({ source: { sketchId: sketch.id, documentId: frame.document.id, session: frame.session, componentId: frame.componentId } });
    cancelFacePocket();
  } catch (failure) {
    useFacePocketIntent.setState({ source: undefined });
    cancelFacePocket();
    const reason = failure instanceof Error ? failure.message : "Sketch drawing could not start.";
    const message = `The face sketch was created, but drawing could not start. Open that sketch again or Undo its creation. ${reason}`;
    useCadStore.getState().setFileError(message);
    throw new Error(message);
  }
}
export function cancelFacePocket() {
  useFacePocket.setState({ frame: undefined });
  useSketchPlanePicker.setState({ hover: undefined, error: undefined });
}
