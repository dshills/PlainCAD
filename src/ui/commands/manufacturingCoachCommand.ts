import type { RenderMesh } from "../../cad/kernel/KernelAdapter";
import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { manufacturingReport, correctManufacturingFinding, type CoachSettings } from "../../cad/inspection/manufacturingCoach";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { useManufacturingCoach } from "./manufacturingCoachState";
import { interactionDraftBusy } from "./interactionDraftState";
import { useSketchCanvas } from "./sketchCanvasCommand";
import { useExtrudeDraft } from "./extrudeCommand";
import { useHoleDraft } from "./holeCommand";
import { assertNativeSolidPreview, useModelingDraft } from "./modelingDraftCommand";
import { useGuidedHole } from "./guidedHoleCommand";
import { useProjectWorkflow } from "./projectWorkflowCommand";
import { operationDraftBusy } from "./operationDropCommand";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { useFileJobs } from "../../persistence/fileJobs";
import { currentAiCanvasPreview } from "../../state/aiCanvasPreview";
export { useManufacturingCoach } from "./manufacturingCoachState";
export interface CoachFrame { document: CadDocument; session: number; result: RebuildResult }
function ready(state: CadStore, own = false) {
  return !state.fileBusy && state.rebuild.kernelReady && state.rebuild.status === "succeeded" && state.rebuild.result?.success && state.rebuild.result.documentId === state.history.present.id &&
    !interactionDraftBusy(own ? "coach" : undefined) && !useSketchCanvas.getState().active && !useExtrudeDraft.getState().draft && !useHoleDraft.getState().draft && !useModelingDraft.getState().draft &&
    !useGuidedHole.getState().draft && !useProjectWorkflow.getState().active && !operationDraftBusy() && !useTargetScopeCapture.getState().busy && !useFileJobs.getState().exportOpen && !currentAiCanvasPreview(state);
}
export function canCoach(state = useCadStore.getState()) {
  return Boolean(ready(state) && state.rebuild.result?.meshes.length && state.rebuild.result.meshes.every(mesh => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid));
}
export function beginCoach() {
  const state = useCadStore.getState(); if (!canCoach(state)) throw new Error("Finish the current task and wait for a native model before Manufacturing coach.");
  useManufacturingCoach.setState({ frame: { document: state.history.present, session: state.documentSession, result: state.rebuild.result! } });
}
export function currentCoach(frame: CoachFrame) {
  const state = useCadStore.getState(); return useManufacturingCoach.getState().frame === frame && ready(state, true) && state.history.present === frame.document && state.documentSession === frame.session && state.rebuild.result === frame.result;
}
export function cancelCoach() { useManufacturingCoach.setState({ frame: undefined }); }
export interface CoachPreview { frame: CoachFrame; settings: CoachSettings; findingId: string; document: CadDocument; result: RebuildResult }
const proven = new WeakSet<CoachPreview>();
/** Compare affected native outputs, including equal-volume shape changes. */
export function nativeMeshChanged(before: RenderMesh, after: RenderMesh) {
  const a = before.geometryAssertions, b = after.geometryAssertions;
  if (before.geometrySource !== "opencascade" || after.geometrySource !== "opencascade" || !a?.valid || !b?.valid || ![a.volume, b.volume, a.surfaceArea, b.surfaceArea].every(value => Number.isFinite(value) && value > 0)) throw new Error("Correction comparison requires valid native geometry measurements.");
  const changed = (first: number, second: number) => Math.abs(first - second) > Math.max(1e-7, Math.abs(first) * 1e-9);
  return changed(a.volume, b.volume) || changed(a.surfaceArea, b.surfaceArea) || [0, 1, 2].some(axis => changed(before.bounds.min[axis], after.bounds.min[axis]) || changed(before.bounds.max[axis], after.bounds.max[axis]));
}
export async function previewCoachCorrection(frame: CoachFrame, settings: CoachSettings, findingId: string, signal: AbortSignal): Promise<CoachPreview> {
  if (!currentCoach(frame)) throw new Error("Manufacturing analysis is stale. Reopen the coach.");
  assertNativeSolidPreview(frame.result, frame.document.id);
  const finding = manufacturingReport(frame.document, frame.result, settings).findings.find(finding => finding.id === findingId);
  if (!finding?.correction) throw new Error("This finding has no automatic correction. Review the design manually.");
  const document = correctManufacturingFinding(frame.document, finding.correction), result = await previewModeling(document, signal);
  if (signal.aborted || !currentCoach(frame)) throw new Error("Manufacturing preview was canceled or became stale.");
  assertNativeSolidPreview(result, document.id);
  if (finding.bodyIds.some(id => !frame.result.meshes.some(mesh => mesh.bodyId === id) || !result.meshes.some(mesh => mesh.bodyId === id))) throw new Error("Correction lost an affected body identity. Review the feature scope manually.");
  if (!finding.bodyIds.some(id => {
    const before = frame.result.meshes.find(mesh => mesh.bodyId === id), after = result.meshes.find(mesh => mesh.bodyId === id);
    return nativeMeshChanged(before!, after!);
  })) throw new Error("Correction did not change affected native volume, area or bounds. Review this correction manually.");
  const preview = { frame, settings: { ...settings }, findingId, document, result }; proven.add(preview); return preview;
}
export function applyCoachCorrection(preview: CoachPreview, settings: CoachSettings, findingId: string) {
  if (!proven.has(preview) || !currentCoach(preview.frame) || JSON.stringify(preview.settings) !== JSON.stringify(settings) || preview.findingId !== findingId) throw new Error("Preview the current correction before Apply.");
  assertNativeSolidPreview(preview.result, preview.document.id);
  useCadStore.getState().updateDocument(current => current === preview.frame.document ? preview.document : current);
  if (useCadStore.getState().history.present === preview.frame.document) throw new Error("Correction could not be saved. Review project diagnostics.");
  proven.delete(preview); cancelCoach();
}
