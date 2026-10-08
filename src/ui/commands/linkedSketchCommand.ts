import { BEFORE_LINKED_SOURCE_EDIT_EVENT, CANCEL_SKETCH_GESTURE_EVENT } from "./sketchCanvasEvents";
import type { CadDocument, SketchProjection } from "../../cad/document/schema";
import { sketchComponentId } from "../../cad/document/components";
import { useCadStore } from "../../state/useCadStore";
import { showGeometryHighlight } from "../../state/useGeometryHighlight";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import { beginSketchCanvas, selectedCanvasEntities, useSketchCanvas, type CanvasSession } from "./sketchCanvasCommand";
import { canOpenSketchProjection } from "./sketchProjectionCommand";

export interface LinkedSketchContext {
  document: CadDocument;
  session: number;
  active: CanvasSession;
  link: SketchProjection;
}
export function linkedSketchContext(projectionId?: string): LinkedSketchContext | undefined {
  const state = useCadStore.getState(), active = useSketchCanvas.getState().active;
  if (!active || !canOpenSketchProjection(state)) return;
  const sketch = state.history.present.sketches[active.sketchId];
  const selected = selectedCanvasEntities(state)?.entityIds ?? [];
  const matches = sketch?.projections?.filter((link) => projectionId ? link.id === projectionId : link.members.some((member) => selected.includes(member.targetEntityId))) ?? [];
  if (matches.length !== 1) return;
  return { document: state.history.present, session: state.documentSession, active, link: matches[0] };
}
function currentContext(context: LinkedSketchContext) {
  const current = linkedSketchContext(context.link.id);
  if (!current || current.document !== context.document || current.session !== context.session || current.active !== context.active || current.link !== context.link)
    throw new Error("Project or link changed. Select the current linked geometry.");
  return useCadStore.getState();
}
export function linkedSketchSource(context: LinkedSketchContext) {
  const feature = context.document.features.find((item) => item.id === context.link.sourceFeatureId);
  if (!feature || feature.type !== "extrude" || feature.operation !== "newBody" || feature.suppressed) return;
  const sketch = context.document.sketches[feature.sketchId];
  if (!sketch || sketchComponentId(context.document, sketch.id) !== (feature.componentId ?? context.document.rootComponentId)) return;
  const componentId = sketchComponentId(context.document, sketch.id);
  return { feature, sketch, componentId, part: context.document.components[componentId]?.name ?? "Part" };
}
export function canNavigateLinkedSketchSource(projectionId?: string, edit = false) {
  const context = linkedSketchContext(projectionId);
  const source = context && linkedSketchSource(context);
  if (!context || !source) return false;
  const state = useCadStore.getState(), result = state.rebuild.result;
  // The store publishes settled results only after matching its captured document
  // object and worker epoch; queued/rebuilding states can retain old results.
  return Boolean(["succeeded", "failed"].includes(state.rebuild.status) && result?.documentId === context.document.id &&
    (!edit || result.sketchPlanes?.[source.sketch.id]));
}
export function showLinkedSketchSource(context = linkedSketchContext()) {
  if (!context) throw new Error("Select geometry from one linked boundary first.");
  const state = currentContext(context), source = linkedSketchSource(context), result = state.rebuild.result;
  if (!source || !canNavigateLinkedSketchSource(context.link.id) || !result) throw new Error("The source is missing or unavailable. Repair this link using a supported boundary.");
  state.select({ kind: "feature", documentId: context.document.id, id: source.feature.id }, { preserveActiveComponent: true });
  const nativeBodyIds = new Set(result.meshes.filter((mesh) => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid && mesh.geometryAssertions.solidCount > 0 && mesh.geometryAssertions.volume > 0).map((mesh) => mesh.bodyId));
  showGeometryHighlight({ document: context.document, session: context.session, result, source: "repair", componentId: state.activeComponentId,
    bodyIds: result.bodies.filter((body) => body.featureId === source.feature.id && nativeBodyIds.has(body.id)).map((body) => body.id) });
  useWorkspaceState.getState().setPanel("inspector");
}
export function editLinkedSketchSource(context = linkedSketchContext()) {
  if (!context) throw new Error("Select geometry from one linked boundary first.");
  currentContext(context);
  const source = linkedSketchSource(context);
  if (!source || !canNavigateLinkedSketchSource(context.link.id, true)) throw new Error("The source drawing is unavailable. Repair the source or link before editing.");
  // The mounted canvas vetoes this switch when incomplete drawing/drag input exists.
  const request = new Event(BEFORE_LINKED_SOURCE_EDIT_EVENT, { cancelable: true });
  if (!window.dispatchEvent(request)) throw new Error("Finish or cancel the current drawing gesture before editing the source. Completed geometry is already saved.");
  currentContext(context);
  window.dispatchEvent(new Event(CANCEL_SKETCH_GESTURE_EVENT));
  const state = currentContext(context);
  if (!beginSketchCanvas(source.sketch.id)) throw new Error("The source drawing could not open. Select its sketch and try again.");
  state.select({ kind: "sketch", documentId: context.document.id, id: source.sketch.id });
  useWorkspaceState.getState().setPanel("auto");
}
