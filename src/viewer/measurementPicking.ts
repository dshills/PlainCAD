import * as THREE from "three";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { modelMeasurementTargets, type ModelMeasurementTarget } from "../cad/inspection/modelMeasurements";
import { faceChoiceAt, sketchPlaneChoices } from "../cad/sketch/planePicking";
import { useInspectionState } from "../state/inspectionState";
import { useCadStore } from "../state/useCadStore";
import { hiddenViewerBodies, useViewerState } from "../state/viewerState";
import { sketchComponentId } from "../cad/document/components";

export function visibleMeasurementTargets(): ModelMeasurementTarget[] {
  const state = useCadStore.getState(), view = useViewerState.getState();
  const result = state.rebuild.result;
  if (state.fileBusy || state.rebuild.status !== "succeeded" || !result?.success || result.documentId !== state.history.present.id || (view.session === state.documentSession && view.presentationMode === "render")) return [];
  const hidden = hiddenViewerBodies(state.history.present, result.meshes.map((mesh) => mesh.bodyId), state.documentSession, view);
  const targets = modelMeasurementTargets(state.history.present, result);
  return targets.filter((target) => target.bodyId ? !hidden.includes(target.bodyId) : !target.sketchId || (view.session !== state.documentSession || (!view.hiddenSketchIds.includes(target.sketchId) && !view.hiddenComponentIds.includes(sketchComponentId(state.history.present, target.sketchId)))));
}
/** A displayed selection must retain every picked member and its exact snapshot. */
export function resolvedMeasurementSelection(document: CadDocument, result: RebuildResult | undefined, capture: { document?: CadDocument; result?: RebuildResult; targetIds: readonly string[] }, targets: ModelMeasurementTarget[]): ModelMeasurementTarget[] {
  if (capture.document !== document || capture.result !== result) return [];
  const resolved = capture.targetIds.map((id) => targets.find((target) => target.id === id));
  return resolved.every((target) => target !== undefined) ? resolved : [];
}
/** Screen-space tolerance handles picking only; the picked target owns exact values. */
export function installMeasurementPicking(canvas: HTMLCanvasElement, camera: THREE.Camera, models: THREE.Group, clipping: () => THREE.Plane | undefined) {
  let press: { x: number; y: number } | undefined;
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const down = (event: PointerEvent) => { press = event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined; };
  const click = (event: MouseEvent) => {
    const inspection = useInspectionState.getState(), state = useCadStore.getState();
    if (!inspection.picking || inspection.session !== state.documentSession) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const previous = press; press = undefined;
    if (event.button !== 0 || !previous || Math.hypot(previous.x - event.clientX, previous.y - event.clientY) > 4) return;
    const rect = canvas.getBoundingClientRect(), plane = clipping(), targets = visibleMeasurementTargets();
    if (!targets.length || !rect.width || !rect.height) { inspection.setError(state.documentSession, "Measure needs visible geometry from the current successful model in Model view."); return; }
    camera.updateMatrixWorld();
    const pixel = (point: { x: number; y: number; z: number }) => {
      const world = new THREE.Vector3(point.x, point.y, point.z);
      if (plane && plane.distanceToPoint(world) < 0) return;
      const projected = world.project(camera);
      if (projected.z < -1 || projected.z > 1) return;
      return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 };
    };
    const candidates = targets.flatMap((target) => {
      if (target.kind === "face") return [];
      let distance = Infinity;
      if (target.point) {
        const p = pixel(target.point);
        if (p) distance = Math.hypot(p.x - event.clientX, p.y - event.clientY);
      } else for (const path of target.paths) {
        for (let i = 0; i < path.length - (target.closed ? 0 : 1); i++) {
          const a = pixel(path[i]), b = pixel(path[(i + 1) % path.length]);
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((event.clientX - a.x) * dx + (event.clientY - a.y) * dy) / (dx * dx + dy * dy || 1)));
          distance = Math.min(distance, Math.hypot(event.clientX - a.x - t * dx, event.clientY - a.y - t * dy));
        }
      }
      return distance <= 8 ? [{ target, distance }] : [];
    });
    // Explicit endpoints take precedence over their incident edges. Native edges
    // take precedence over a coincident source sketch displayed at the same cap.
    const points = candidates.filter((item) => item.target.point);
    let eligible = points.length ? points : candidates;
    const native = eligible.filter((item) => item.target.bodyId);
    if (native.length) eligible = native;
    eligible.sort((a, b) => a.distance - b.distance || a.target.id.localeCompare(b.target.id));
    let target: ModelMeasurementTarget | undefined = eligible[0]?.target;
    if (eligible[1] && !(eligible[0].target.point && eligible[1].target.point && Math.hypot(eligible[0].target.point.x - eligible[1].target.point.x, eligible[0].target.point.y - eligible[1].target.point.y, eligible[0].target.point.z - eligible[1].target.point.z) < 1e-6) && Math.abs(eligible[1].distance - eligible[0].distance) < 1) {
      inspection.setError(state.documentSession, "Measurement targets overlap here. Choose the exact geometry in the accessible target list."); return;
    }
    if (!target) {
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(models.children.filter((object) => object.visible), true).find((item) => item.object instanceof THREE.Mesh && (!plane || plane.distanceToPoint(item.point) >= 0));
      const normal = hit?.face?.normal.clone().transformDirection(hit.object.matrixWorld);
      const choice = hit && normal ? faceChoiceAt(sketchPlaneChoices(state.history.present, state.rebuild.result), hit.object.userData.bodyId, hit.point, normal) : undefined;
      target = choice ? targets.find((item) => item.id === `face:${choice.id}`) : undefined;
    }
    if (!target) { inspection.setError(state.documentSession, "Click a solved sketch point or curve, a highlighted original native cap edge, or a supported planar face. Curved, split and new boolean topology are unavailable."); return; }
    inspection.pick(state.documentSession, state.history.present, state.rebuild.result!, target.id);
  };
  const key = (event: KeyboardEvent) => {
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="menu"]'))) return;
    if (event.key === "Escape" && useInspectionState.getState().picking) useInspectionState.getState().setPicking(useCadStore.getState().documentSession, false);
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("click", click, true);
  window.addEventListener("keydown", key);
  return () => { canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("click", click, true); window.removeEventListener("keydown", key); };
}

/** One line batch and one point batch keep inspection cost bounded by vertices,
 * rather than a material/draw call for every authored target. Viewer owns disposal. */
export function addMeasurementOverlays(group: THREE.Group, targets: ModelMeasurementTarget[], selectedIds: readonly string[]) {
  const lines: number[] = [], lineColors: number[] = [], points: number[] = [], pointColors: number[] = [];
  const selected = new Set(selectedIds), highlight = new THREE.Color("#b52977"), ordinary = new THREE.Color("#32cee0");
  for (const target of targets) {
    const color = selected.has(target.id) ? highlight : ordinary;
    if (target.point) {
      points.push(target.point.x, target.point.y, target.point.z); pointColors.push(color.r, color.g, color.b);
    } else for (const path of target.paths) for (let i = 0; i < path.length - (target.closed ? 0 : 1); i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      lines.push(a.x, a.y, a.z, b.x, b.y, b.z); lineColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
  }
  if (lines.length) {
    const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(lines, 3)).setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthTest: false })));
  }
  if (points.length) {
    const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(points, 3)).setAttribute("color", new THREE.Float32BufferAttribute(pointColors, 3));
    group.add(new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: 7, depthTest: false })));
  }
}
