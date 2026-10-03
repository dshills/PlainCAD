import type { CameraPose } from "../cad/document/schema";
import type { StandardView } from "../cad/inspection/cameraViews";
interface CameraController {
  read(): CameraPose;
  apply(pose: CameraPose): boolean;
  preset(view: StandardView): void;
}
let controller: CameraController | undefined;
export function registerCameraController(next: CameraController) {
  controller = next;
  return () => {
    if (controller === next) controller = undefined;
  };
}
export function captureCamera(): CameraPose | undefined {
  return controller?.read();
}
export function restoreCamera(pose: CameraPose): boolean {
  if (!controller) return false;
  return controller.apply(pose);
}
export function showStandardView(view: StandardView): boolean {
  if (!controller) return false;
  controller.preset(view);
  return true;
}
