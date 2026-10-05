import { create } from "zustand";
import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { useCadStore } from "../../state/useCadStore";
import { assertNativeSolidPreview } from "./modelingDraftCommand";
import { useSketchCanvas } from "./sketchCanvasCommand";
import type { buildAiPlan } from "../../ai/buildPlan";

export const useAiDrawer = create<{ open: boolean }>(() => ({ open: false }));
export const toggleAiDrawer = () =>
  useAiDrawer.setState((state) => ({ open: !state.open }));
export interface AiDraftFrame {
  document: CadDocument;
  session: number;
  componentId: string;
}
export function currentAiFrame(frame: AiDraftFrame) {
  const state = useCadStore.getState();
  return (
    state.history.present === frame.document &&
    state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId &&
    !state.fileBusy &&
    !useSketchCanvas.getState().active
  );
}
export function assertAiGeometry(
  staged: ReturnType<typeof buildAiPlan>,
  result: RebuildResult,
) {
  assertNativeSolidPreview(result, staged.document.id);
  for (const id of staged.bodyIds)
    if (!result.meshes.some((mesh) => mesh.bodyId === id))
      throw new Error(
        "AI preview did not produce every requested component body.",
      );
  const meshes = result.meshes.filter((mesh) =>
    staged.bodyIds.includes(mesh.bodyId),
  );
  let volume = 0;
  for (const mesh of meshes) {
    const assertions = mesh.geometryAssertions;
    if (
      !assertions?.valid ||
      !Number.isFinite(assertions.volume) ||
      !(assertions.volume > 0)
    )
      throw new Error("AI preview is missing a valid native body volume.");
    volume += assertions.volume;
  }
  if (!Number.isFinite(volume))
    throw new Error("AI component volume exceeds the supported limits.");
  return { meshes, volume };
}
export function applyAiPlan(
  frame: AiDraftFrame,
  staged: ReturnType<typeof buildAiPlan>,
  result: RebuildResult,
) {
  if (!currentAiFrame(frame))
    throw new Error(
      "Project or component changed. Generate a fresh AI preview.",
    );
  assertAiGeometry(staged, result);
  const state = useCadStore.getState();
  state.updateDocument((document) => {
    if (document !== frame.document)
      throw new Error("Project changed. Generate a fresh AI preview.");
    return staged.document;
  });
  if (useCadStore.getState().history.present === frame.document)
    throw new Error(
      useCadStore.getState().fileError || "AI component could not be applied.",
    );
  state.activateComponent(staged.componentId);
  const featureId = staged.featureIds.at(-1);
  if (featureId)
    state.select({
      kind: "feature",
      id: featureId,
      documentId: staged.document.id,
    });
}
