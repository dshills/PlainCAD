import { placePlane, componentPlacementsEqual } from "../../cad/document/componentPlacement";
import { featureComponentId } from "../../cad/document/components";
import { create } from "zustand";
import {
  sketchPlaneChoices,
  type SketchPlaneChoice,
} from "../../cad/sketch/planePicking";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { captureCamera, restoreCamera } from "../../viewer/cameraController";
export const useSketchPlanePicker = create<{
  offset?: string;
  hover?: SketchPlaneChoice;
  error?: string;
}>(() => ({}));
export function currentPlaneChoices(state: CadStore = useCadStore.getState()) {
  const result =
    state.rebuild.status === "succeeded" &&
    state.rebuild.result?.documentId === state.history.present.id
      ? state.rebuild.result
      : undefined;
  const document = state.history.present;
  return sketchPlaneChoices(document, result).filter(choice => {
    if (typeof choice.reference === "string") return true;
    const feature = document.features.find(item => item.id === (typeof choice.reference === "string" ? "" : choice.reference.featureId));
    return feature && componentPlacementsEqual(document, featureComponentId(document, feature), state.activeComponentId);
  }).map(choice => typeof choice.reference === "string" ? { ...choice, transform: placePlane(choice.transform, document.components[state.activeComponentId]?.placement) } : choice);
}
export function alignToSketchPlane(choice: SketchPlaneChoice) {
  const current = captureCamera(),
    plane = choice.transform;
  const distance = current
    ? Math.max(
        10,
        Math.hypot(
          ...current.cameraPosition.map(
            (value, axis) => value - current.cameraTarget[axis],
          ),
        ),
      )
    : 100;
  restoreCamera({
    cameraPosition: [
      plane.origin.x + plane.normal.x * distance,
      plane.origin.y + plane.normal.y * distance,
      plane.origin.z + plane.normal.z * distance,
    ],
    cameraTarget: [plane.origin.x, plane.origin.y, plane.origin.z],
    cameraUp: [plane.v.x, plane.v.y, plane.v.z],
  });
}
