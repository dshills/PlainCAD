import * as THREE from "three";
import { faceChoiceAt, sketchPlaneChoices } from "../cad/sketch/planePicking";
import { useCadStore } from "../state/useCadStore";
import { bodyComponentId } from "../cad/document/components";
import { clearAiFacePicking, currentAiFacePicking, useAiFacePicking } from "../state/aiFacePicking";

/** One deliberate click selects a supported authored face, never a nearby role. */
export function installAiFacePicking(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, model: THREE.Group, clipping: () => THREE.Plane | undefined, canPick: () => boolean) {
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  // Capture above the canvas so this deliberately armed picker owns the click
  // before older measurement/plane capture listeners on the canvas.
  const clickHost = canvas.parentElement ?? canvas;
  let press: { x: number; y: number } | undefined, dragged = false;
  const down = (event: PointerEvent) => { if (event.button === 0) { press = { x: event.clientX, y: event.clientY }; dragged = false; } };
  const move = (event: PointerEvent) => { if (press && event.buttons && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) dragged = true; };
  const click = (event: MouseEvent) => {
    const frame = currentAiFacePicking();
    if (!frame || event.button !== 0 || event.target !== canvas) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (dragged) { dragged = false; return; }
    if (!canPick()) { clearAiFacePicking(); return; }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(model.children.filter((object) => object.visible), true).find((item) => item.object instanceof THREE.Mesh && (!clipping() || clipping()!.distanceToPoint(item.point) >= 0));
    const bodyId = hit?.object.userData.bodyId as string | undefined;
    const mesh = frame.result.meshes.find((item) => item.bodyId === bodyId);
    if (!hit?.face || !bodyId || !mesh || mesh.geometrySource !== "opencascade" || !mesh.geometryAssertions?.valid || bodyComponentId(frame.document, bodyId) !== frame.componentId) {
      useAiFacePicking.setState({ message: "Choose a visible native part in the active component." }); return;
    }
    const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    const face = faceChoiceAt(sketchPlaneChoices(frame.document, frame.result), bodyId, hit.point, normal);
    if (!face || typeof face.reference === "string") {
      useAiFacePicking.setState({ message: "This face is curved, split or unavailable. Choose a supported planar face." }); return;
    }
    clearAiFacePicking();
    useCadStore.getState().select({ kind: "face", id: face.id, documentId: frame.document.id });
  };
  const cancel = () => { press = undefined; dragged = false; };
  canvas.addEventListener("pointerdown", down, true); canvas.addEventListener("pointermove", move, true);
  canvas.addEventListener("pointercancel", cancel, true); clickHost.addEventListener("click", click, true);
  return () => {
    canvas.removeEventListener("pointerdown", down, true); canvas.removeEventListener("pointermove", move, true);
    canvas.removeEventListener("pointercancel", cancel, true); clickHost.removeEventListener("click", click, true);
  };
}
