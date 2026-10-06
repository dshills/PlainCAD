import { create } from "zustand";
import type { CadDocument, SelectionRef } from "../../cad/document/schema";
import type { RebuildError, RebuildResult, RebuildWarning } from "../../cad/worker/workerProtocol";
import { useCadStore } from "../../state/useCadStore";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import { beginSketchCanvas, selectCanvasEntities, useSketchCanvas } from "./sketchCanvasCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { useModelingDraft } from "./modelingDraftCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { suggestClosingEdge, type ClosingEdgeSuggestion } from "../../cad/sketch/repairSuggestions";
import { upsertSketch } from "../../cad/document/CadDocument";
import { createId } from "../../cad/document/ids";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import { detectProfiles } from "../../cad/sketch/profileDetection";
import { assertProjectJsonShape } from "../../persistence/importSafety";
import { showGeometryHighlight } from "../../state/useGeometryHighlight";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";

export type RepairIssue = RebuildError | RebuildWarning;
export interface RepairContext {
  document: CadDocument;
  result: RebuildResult;
  session: number;
  issueId: string;
}
export const useRepairFocus = create<{ focus?: {
  document: CadDocument;
  session: number;
  sketchId: string;
  dimensionId?: string;
  constraintId?: string;
  closingEdge?: ClosingEdgeSuggestion;
} }>(() => ({}));

export function repairAvailable(state = useCadStore.getState()) {
  return !state.fileBusy && !useFileJobs.getState().exportOpen && !useTargetScopeCapture.getState().busy &&
    !useExtrudeDraft.getState().draft && !useHoleDraft.getState().draft &&
    !useModelingDraft.getState().draft && !useGuidedHole.getState().draft &&
    !useProjectWorkflow.getState().active;
}
function currentIssue(context: RepairContext) {
  const state = useCadStore.getState();
  if (!repairAvailable(state)) throw new Error("Finish or cancel the current task before repairing model issues.");
  if (state.history.present !== context.document || state.documentSession !== context.session ||
    state.rebuild.result !== context.result || context.result.documentId !== context.document.id ||
    (state.rebuild.status !== "succeeded" && state.rebuild.status !== "failed"))
    throw new Error("Model changed. Choose an issue from the latest rebuild.");
  const issue = [...context.result.errors, ...context.result.warnings].find((i) => i.id === context.issueId);
  if (!issue) throw new Error("This issue is no longer available. Inspect the latest rebuild.");
  return { state, issue };
}
export function selectionForRepairIssue(issue: RepairIssue, document: CadDocument): SelectionRef | undefined {
  const id = issue.sourceId;
  if (!id) return;
  if (issue.source === "parameter") {
    const parameter = Object.values(document.parameters).find((p) => p.id === id) ?? (Object.hasOwn(document.parameters, id) ? document.parameters[id] : undefined);
    if (parameter) return { kind: "parameter", id: parameter.id, documentId: document.id };
  }
  if (issue.source === "sketch" && Object.hasOwn(document.sketches, id)) return { kind: "sketch", id, documentId: document.id };
  if ((issue.source === "feature" || issue.source === "kernel") && document.features.some((f) => f.id === id))
    return { kind: "feature", id, documentId: document.id };
}
function issueReferences(issue: RepairIssue) {
  const details = "details" in issue ? issue.details : undefined;
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const data = details as Record<string, unknown>;
  return {
    entityId: typeof data.entityId === "string" ? data.entityId : undefined,
    constraintId: typeof data.constraintId === "string" ? data.constraintId : undefined,
  };
}
export function repairGuidance(issue: RepairIssue, document: CadDocument, result: RebuildResult) {
  const sketch = issue.source === "sketch" && issue.sourceId && Object.hasOwn(document.sketches, issue.sourceId) ? document.sketches[issue.sourceId] : undefined;
  const references = issueReferences(issue);
  const referenceId = references.constraintId;
  const dimension = sketch?.dimensions.find((d) => d.id === referenceId);
  const constraint = sketch?.constraints.find((c) => c.id === referenceId);
  const solved = sketch && result.solvedSketches?.[sketch.id];
  // Profile diagnostics have a distinct producer ID. Geometry, rather than the
  // human-readable message, establishes whether an outline can be closed.
  const closingEdge = sketch && solved && issue.id.startsWith("profile:") &&
    result.profiles?.[sketch.id]?.length === 0 ? suggestClosingEdge(sketch, solved) : undefined;
  const unavailablePlane = sketch && !result.sketchPlanes?.[sketch.id];
  const title = dimension ? "Repair a driving dimension" : constraint ? "Repair a sketch constraint" : closingEdge ? "Close this sketch outline" : issue.source === "parameter" ? "Repair a parameter expression" : unavailablePlane ? "Inspect this sketch plane" : issue.source === "sketch" ? "Inspect this sketch" : "Inspect this modeling operation";
  const guidance = dimension ? "Edit the highlighted dimension expression, or remove it if it conflicts with another dimension. The solver may report several contributors; inspect them before choosing a change." : constraint ? "Inspect the highlighted constraint and its geometry. Correct its references or remove it if it conflicts with the intended shape." : closingEdge ? `The outline has two open endpoints ${closingEdge.distance.toFixed(3)} mm apart. Show them before explicitly adding a straight closing edge. Existing points, dimensions and constraints stay intact.` : issue.source === "parameter" ? "Correct the expression and units in the parameter controls. Dependent geometry will rebuild after the edit." : unavailablePlane ? "The sketch plane is unavailable. Inspect its source controls and choose an available supported replacement for a lost face reference; geometry cannot be repaired by guessing." : issue.source === "sketch" ? "Open the drawing to inspect its geometry and dimensions. Underconstrained geometry can be intentional; it is not automatically fixed." : "Open the feature controls to inspect its source, dimensions and supported targets. Lost or changed geometry requires an explicit supported replacement reference. Failed geometry cannot be exported.";
  return { title, guidance, dimension, constraint, closingEdge, sketch, references };
}
export function focusRepairIssue(context: RepairContext) {
  const { state, issue } = currentIssue(context);
  const target = selectionForRepairIssue(issue, context.document);
  if (!target) throw new Error("This diagnostic has no editable source. Inspect its message and model inputs.");
  const guidance = repairGuidance(issue, context.document, context.result);
  const canvas = useSketchCanvas.getState().active;
  if (canvas && (target.kind !== "sketch" || canvas.sketchId !== target.id || canvas.session !== context.session || canvas.documentId !== context.document.id))
    throw new Error("Finish the current sketch before opening a different repair target.");
  const drawing = target.kind === "sketch" && context.result.sketchPlanes?.[target.id];
  const repairCanvas = drawing ? canvas ?? beginSketchCanvas(target.id) : undefined;
  if (drawing && !repairCanvas) throw new Error("The repair drawing could not open. Finish the current task and choose this issue again.");
  state.select(target);
  const feature = target.kind === "feature" ? context.document.features.find((f) => f.id === target.id) : undefined;
  const bodies = new Set(context.result.bodies.filter((body) => body.featureId === target.id).map((body) => body.id));
  if (feature && "targetBodyIds" in feature) feature.targetBodyIds?.forEach((id) => bodies.add(id));
  if (feature && "targetEdgeRefs" in feature) feature.targetEdgeRefs?.forEach((ref) => context.result.bodies.filter((body) => body.featureId === ref.featureId).forEach((body) => bodies.add(body.id)));
  showGeometryHighlight({ document: context.document, session: context.session, source: "repair", result: context.result, componentId: useCadStore.getState().activeComponentId, bodyIds: [...bodies] });
  useRepairFocus.setState({ focus: undefined });
  if (repairCanvas) {
    const ids = guidance.closingEdge ? [guidance.closingEdge.startId, guidance.closingEdge.endId] : guidance.dimension?.entityIds ?? guidance.constraint?.entityIds ?? (guidance.references.entityId ? [guidance.references.entityId] : []);
    selectCanvasEntities(repairCanvas, context.document, ids.filter((id) => Object.hasOwn(guidance.sketch!.entities, id)));
    useRepairFocus.setState({ focus: { document: context.document, session: context.session, sketchId: target.id, dimensionId: guidance.dimension?.id, constraintId: guidance.constraint?.id, closingEdge: guidance.closingEdge } });
  } else useWorkspaceState.getState().setPanel("inspector");
}
export function addRepairClosingEdge(context: RepairContext) {
  const { state, issue } = currentIssue(context);
  const evaluation = evaluateParameters(context.document.parameters);
  if (evaluation.errors.length) throw new Error("Repair parameter expressions before adding a closing edge.");
  const { sketch, closingEdge } = repairGuidance(issue, context.document, context.result);
  if (!sketch || !closingEdge) throw new Error("No unambiguous closing edge is available. Repair the outline in the drawing.");
  const canvas = useSketchCanvas.getState().active;
  const shown = useRepairFocus.getState().focus;
  if (!canvas || canvas.sketchId !== sketch.id || canvas.session !== context.session || canvas.documentId !== context.document.id ||
    shown?.document !== context.document || shown.session !== context.session || shown.sketchId !== sketch.id ||
    shown.closingEdge?.startId !== closingEdge.startId || shown.closingEdge.endId !== closingEdge.endId)
    throw new Error("Show the open endpoints in the drawing before adding the edge.");
  const id = createId("line"), nextSketch = { ...sketch, entities: { ...sketch.entities, [id]: { id, type: "line" as const, startPointId: closingEdge.startId, endPointId: closingEdge.endId } } };
  const solved = solveSketch(nextSketch, evaluation.values), profiles = detectProfiles(solved);
  if (solved.errors.length || profiles.errors.length || !profiles.profiles.length)
    throw new Error("A straight closing edge would not produce a valid closed profile. Draw the intended boundary instead.");
  const next = upsertSketch(context.document, nextSketch);
  assertProjectJsonShape(next);
  state.updateDocument((document) => document === context.document ? next : document);
  if (useCadStore.getState().history.present === context.document) throw new Error("Repair could not be saved. Check project diagnostics.");
  useRepairFocus.setState({ focus: undefined });
  useSketchCanvas.setState({ selection: undefined });
}
