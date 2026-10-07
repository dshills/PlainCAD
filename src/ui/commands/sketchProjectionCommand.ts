import type { CadDocument, SketchProjection } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { planSketchProjection, breakSketchProjection, deleteSketchProjection } from "../../cad/sketch/sketchProjection";
import { documentTimeline, timelineItemId } from "../../cad/document/timelineOrdering";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { sketchComponentId } from "../../cad/document/components";
import { useCadStore } from "../../state/useCadStore";
import { selectedCanvasEntities, useSketchCanvas, type CanvasSession } from "./sketchCanvasCommand";
import { interactionDraftBusy } from "./interactionDraftState";
import { operationDraftBusy } from "./operationDropCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { assertNativeSolidPreview, useModelingDraft } from "./modelingDraftCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useSketchProjection } from "./sketchProjectionState";
export { useSketchProjection } from "./sketchProjectionState";
export type SketchProjectionPlan = ReturnType<typeof planSketchProjection>;
export interface SketchProjectionFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  active: CanvasSession;
  selectedIds: string[];
  replaceProjectionId?: string;
}
function competingTask() {
  return Boolean(interactionDraftBusy("projection") || operationDraftBusy() || useGuidedHole.getState().draft ||
    useExtrudeDraft.getState().draft || useModelingDraft.getState().draft || useHoleDraft.getState().draft ||
    useFileJobs.getState().exportOpen || useProjectWorkflow.getState().active);
}
export function currentSketchProjectionFrame(frame: SketchProjectionFrame, state = useCadStore.getState()) {
  return state.history.present === frame.document && state.documentSession === frame.session && state.activeComponentId === frame.componentId &&
    useSketchCanvas.getState().active === frame.active && frame.active.documentId === frame.document.id && frame.active.session === frame.session &&
    sketchComponentId(frame.document, frame.active.sketchId) === frame.componentId &&
    JSON.stringify(selectedCanvasEntities()?.entityIds ?? []) === JSON.stringify(frame.selectedIds) && !state.fileBusy && !competingTask();
}
export function canOpenSketchProjection(state = useCadStore.getState()) {
  const active = useSketchCanvas.getState().active;
  if (!active || useSketchProjection.getState().frame || !state.rebuild.kernelReady) return false;
  return currentSketchProjectionFrame({ document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, active, selectedIds: selectedCanvasEntities()?.entityIds ?? [] }, state);
}
export function openSketchProjection(replaceProjectionId?: string) {
  if (!canOpenSketchProjection()) throw new Error("Open a current sketch and finish the current operation before projecting part edges.");
  const state = useCadStore.getState(), active = useSketchCanvas.getState().active!;
  if (replaceProjectionId && !state.history.present.sketches[active.sketchId].projections?.some((projection) => projection.id === replaceProjectionId)) throw new Error("The linked projection was removed. Choose a current link.");
  const frame: SketchProjectionFrame = { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, active, selectedIds: selectedCanvasEntities()?.entityIds ?? [], replaceProjectionId };
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  if (!currentSketchProjectionFrame(frame)) throw new Error("Sketch selection changed. Start Project edges again.");
  useSketchProjection.setState({ frame });
}
export function cancelSketchProjection() { useSketchProjection.setState({ frame: undefined }); }
function sourceDocument(frame: SketchProjectionFrame): CadDocument {
  const timeline = documentTimeline(frame.document).map(timelineItemId), index = timeline.indexOf(frame.active.sketchId);
  if (index < 0) throw new Error("The destination sketch is missing from the timeline.");
  const upstream = new Set(timeline.slice(0, index));
  return { ...frame.document, features: frame.document.features.filter((feature) => upstream.has(feature.id)), sketches: Object.fromEntries(Object.entries(frame.document.sketches).filter(([id]) => upstream.has(id))) };
}
export interface SketchProjectionChoice { id: string; featureId: string; role: SketchProjection["role"]; label: string }
export async function loadSketchProjectionSources(frame: SketchProjectionFrame, signal: AbortSignal) {
  if (useSketchProjection.getState().frame !== frame || !currentSketchProjectionFrame(frame)) throw new Error("Project or sketch changed. Start Project edges again.");
  const proof = await previewModeling(sourceDocument(frame), signal);
  if (signal.aborted || useSketchProjection.getState().frame !== frame || !currentSketchProjectionFrame(frame)) throw new Error("Projection source check canceled or became stale.");
  assertNativeSolidPreview(proof, frame.document.id);
  const choices: SketchProjectionChoice[] = [];
  for (const edge of proof.availableEdges ?? []) {
    if (edge.sourceEntityId) continue;
    const feature = frame.document.features.find((item) => item.id === edge.featureId);
    if (feature?.type !== "extrude" || feature.operation !== "newBody" || feature.suppressed || (feature.termination && feature.termination.type !== "distance")) continue;
    const part = frame.document.components[feature.componentId ?? frame.document.rootComponentId]?.name ?? "Part";
    choices.push({ id: `${feature.id}:${edge.role}`, featureId: feature.id, role: edge.role, label: `${part} · ${feature.name} · ${edge.role === "endCapPerimeter" ? "End cap" : "Start cap"}` });
  }
  return { proof, choices };
}
const previews = new WeakMap<RebuildResult, SketchProjectionPlan>();
function assertProjectionPreview(plan: SketchProjectionPlan, result: RebuildResult) {
  if (!result.success || result.documentId !== plan.document.id) throw new Error(result.errors.map((error) => error.message).join(" ") || "Projection preview rebuild failed.");
  assertNativeSolidPreview(result, plan.document.id);
  const sketch = result.solvedSketches?.[plan.sketchId];
  if (!sketch || sketch.errors.some((error) => error.severity === "error") || plan.projection.members.some((member) => !plan.document.sketches[plan.sketchId].entities[member.targetEntityId])) throw new Error("Linked projected geometry did not solve. Repair the source and preview again.");
  return sketch;
}
export async function previewSketchProjection(frame: SketchProjectionFrame, plan: SketchProjectionPlan, signal: AbortSignal) {
  if (useSketchProjection.getState().frame !== frame || !currentSketchProjectionFrame(frame) || plan.base !== frame.document || plan.sketchId !== frame.active.sketchId) throw new Error("Project, sketch or projection draft changed. Start a fresh projection.");
  const result = await previewModeling(plan.document, signal);
  if (signal.aborted || useSketchProjection.getState().frame !== frame || !currentSketchProjectionFrame(frame)) throw new Error("Projection preview canceled or became stale.");
  const solved = assertProjectionPreview(plan, result);
  previews.set(result, plan);
  return { result, solved };
}
export function applySketchProjection(frame: SketchProjectionFrame, plan: SketchProjectionPlan, result: RebuildResult) {
  if (useSketchProjection.getState().frame !== frame || !currentSketchProjectionFrame(frame) || plan.base !== frame.document || previews.get(result) !== plan || plan.sketchId !== frame.active.sketchId) throw new Error("The native proof belongs to an old projection. Generate a current preview.");
  assertProjectionPreview(plan, result);
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  if (!currentSketchProjectionFrame(frame)) throw new Error("The sketch changed. Preview Project edges again.");
  useCadStore.getState().updateDocument((document) => document === frame.document ? plan.document : document);
  if (useCadStore.getState().history.present === frame.document) throw new Error("Projection could not be saved. Review project diagnostics.");
  previews.delete(result); useSketchCanvas.setState({ selection: undefined }); cancelSketchProjection();
}
export function breakCurrentSketchProjection(projectionId: string) {
  const state = useCadStore.getState(), active = useSketchCanvas.getState().active, result = state.rebuild.result;
  if (!active || !canOpenSketchProjection() || state.rebuild.status !== "succeeded" || !result?.success || result.documentId !== state.history.present.id) throw new Error("Break link needs a current successful projected sketch. Repair or remove a broken projection first.");
  const frame: SketchProjectionFrame = { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, active, selectedIds: selectedCanvasEntities()?.entityIds ?? [] };
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  const current = useCadStore.getState();
  if (!currentSketchProjectionFrame(frame) || current.rebuild.status !== "succeeded" || current.rebuild.result !== result) throw new Error("Project, sketch or rebuild changed. Select the current projection before breaking its link.");
  const document = breakSketchProjection(frame.document, active.sketchId, projectionId, result);
  useCadStore.getState().updateDocument((latest) => latest === frame.document ? document : latest);
  if (useCadStore.getState().history.present === frame.document) throw new Error("Projection link could not be broken. Review project diagnostics and try again.");
  useSketchCanvas.setState({ selection: undefined });
}

export function removeCurrentSketchProjection(projectionId: string) {
  const state = useCadStore.getState(), active = useSketchCanvas.getState().active;
  if (!active || !canOpenSketchProjection()) throw new Error("Finish the current task before removing a projection.");
  const frame: SketchProjectionFrame = { document: state.history.present, session: state.documentSession, componentId: state.activeComponentId, active, selectedIds: selectedCanvasEntities()?.entityIds ?? [] };
  window.dispatchEvent(new Event("plaincad:cancel-sketch-gesture"));
  if (!currentSketchProjectionFrame(frame)) throw new Error("Project, sketch or task changed. Select the current projection.");
  const document = deleteSketchProjection(frame.document, active.sketchId, projectionId);
  useCadStore.getState().updateDocument((latest) => latest === frame.document ? document : latest);
  if (useCadStore.getState().history.present === frame.document) throw new Error("Projection could not be removed. Review project diagnostics and try again.");
  useSketchCanvas.setState({ selection: undefined });
}
