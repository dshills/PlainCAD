import { create } from "zustand";
import {
  sketchPlaneChoices,
  type SketchPlaneChoice,
} from "../../cad/sketch/planePicking";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { captureCamera, restoreCamera } from "../../viewer/cameraController";
export const useSketchPlanePicker = create<{
  hover?: SketchPlaneChoice;
  error?: string;
}>(() => ({}));
export function currentPlaneChoices(state: CadStore = useCadStore.getState()) {
  const result =
    state.rebuild.status === "succeeded" &&
    state.rebuild.result?.documentId === state.history.present.id
      ? state.rebuild.result
      : undefined;
  return sketchPlaneChoices(state.history.present, result);
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
