import * as THREE from "three";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";
import { useFileJobs } from "../persistence/fileJobs";
import { runCommand } from "../ui/commands/commandRegistry";
import { useSketchSolidHandoff } from "../ui/commands/sketchSolidHandoffCommand";
import {
  OPERATION_OVERLAY_VERTEX_BUDGET,
  capOperationGeometry,
  profileOperationGeometry,
} from "../cad/features/operationTargetGeometry";
import {
  OPERATION_DRAG_TYPE,
  operationDropCurrent,
  operationDropTargets,
  operationTransferValue,
  useOperationDrop,
  type OperationTarget,
} from "../ui/commands/operationDropCommand";

const OVERLAY_TOTAL_VERTEX_BUDGET = 65536;

export interface OperationTargetSnapshot {
  targetId: string;
  clippingPlanes: Array<{ normal: number[]; constant: number }>;
}

export interface OperationDropPickingHandle {
  refresh(): void;
  dispose(): void;
  inspect(): OperationTargetSnapshot[];
}

/** A display-only picking layer for explicit profiles and original cap groups.
 * No arbitrary body face/edge index is converted into a durable CAD reference. */
export function installOperationDropPicking(
  scene: THREE.Scene,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  clipping: () => THREE.Plane | undefined,
): OperationDropPickingHandle {
  const group = new THREE.Group();
  scene.add(group);
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  const paths = new Map<string, THREE.Vector3[][]>();
  const screenA = new THREE.Vector3(),
    screenB = new THREE.Vector3(),
    worldPoint = new THREE.Vector3();
  let disposed = false;
  let targets: OperationTarget[] = [];
  let previousFrame: unknown,
    previousView: unknown,
    previousClip: string | undefined;
  let press: { x: number; y: number } | undefined;
  let hoverFrame = 0;
  let pendingPointer: { clientX: number; clientY: number } | undefined;
  const active = () => {
    const frame = useOperationDrop.getState().frame;
    return frame && operationDropCurrent(frame) ? frame : undefined;
  };
  const clear = () => {
    pendingPointer = undefined;
    for (const object of group.children)
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments
      ) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => material.dispose());
      }
    group.clear();
    paths.clear();
    targets = [];
  };
  const color = () => {
    const frame = active();
    const id = frame ? useOperationDrop.getState().hoverId ??
      (frame.handoffSketchId ? useSketchSolidHandoff.getState().selectedTargetId : undefined) : undefined;
    for (const object of group.children) {
      if (
        (object instanceof THREE.Mesh ||
          object instanceof THREE.LineSegments) &&
        !Array.isArray(object.material) &&
        "color" in object.material
      )
        (
          object.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial
        ).color.set(object.userData.targetId === id ? "#ffcf55" : "#32cee0");
    }
  };
  const refresh = () => {
    if (disposed) return;
    const frame = active(),
      view = useViewerState.getState(),
      plane = clipping(),
      clipKey = plane
        ? `${plane.normal.x},${plane.normal.y},${plane.normal.z},${plane.constant}`
        : undefined;
    if (
      frame === previousFrame &&
      view === previousView &&
      clipKey === previousClip
    ) {
      color();
      return;
    }
    previousFrame = frame;
    previousView = view;
    previousClip = clipKey;
    clear();
    if (!frame) return;
    targets = operationDropTargets(frame.operation, useCadStore.getState(), frame.handoffSketchId);
    let vertices = 0;
    for (const target of targets) {
      const remaining = Math.min(
        OPERATION_OVERLAY_VERTEX_BUDGET,
        OVERLAY_TOTAL_VERTEX_BUDGET - vertices,
      );
      if (remaining <= 0) break;
      try {
        const placement =
          target.kind === "profile"
            ? profileOperationGeometry(
                target.sketchId,
                target.profileId,
                frame.result,
                remaining,
              )
            : capOperationGeometry(
                target.ownerId,
                target.role === "endCapPerimeter",
                frame.document,
                frame.result,
                remaining,
              );
        const count = placement.loops.reduce(
          (sum, loop) => sum + loop.length,
          0,
        );
        // Complex targets retain their explicit card alternative. Overlays have
        // a separate bounded resource budget and never allocate kernel handles.
        if (
          count > OPERATION_OVERLAY_VERTEX_BUDGET ||
          vertices + count > OVERLAY_TOTAL_VERTEX_BUDGET
        )
          continue;
        vertices += count;
        const loops = placement.loops.map((loop) =>
          loop.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
        );
        paths.set(target.id, loops);
        const positions = loops.flat().flatMap((p) => p.toArray());
        const geometry = new THREE.BufferGeometry();
        const materialOptions = {
          color: "#32cee0",
          transparent: true,
          opacity: placement.filled ? 0.24 : 0.9,
          depthTest: false,
          depthWrite: false,
          clippingPlanes: plane ? [plane] : [],
        };
        let object: THREE.Mesh | THREE.LineSegments;
        if (placement.filled) {
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(positions, 3),
          );
          geometry.setIndex(placement.indices ?? []);
          object = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
              ...materialOptions,
              side: THREE.DoubleSide,
            }),
          );
        } else {
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
              loops.flatMap((loop) =>
                loop.flatMap((point, index) => [
                  ...point.toArray(),
                  ...loop[(index + 1) % loop.length].toArray(),
                ]),
              ),
              3,
            ),
          );
          object = new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial(materialOptions),
          );
        }
        object.userData.targetId = target.id;
        object.renderOrder = 3;
        group.add(object);
      } catch {
        /* The explicit target card will report a native preview diagnostic. */
      }
    }
    group.updateMatrixWorld(true);
    color();
  };
  const hit = (event: {
    clientX: number;
    clientY: number;
  }): { id?: string; error?: string } => {
    refresh();
    const frame = active(),
      rect = canvas.getBoundingClientRect(),
      sectionPlane = clipping();
    if (!frame || !rect.width || !rect.height) return {};
    camera.updateMatrixWorld();
    if (frame.operation === "extrude") {
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      const hits = ray
        .intersectObjects(
          group.children.filter((object) => object instanceof THREE.Mesh),
        )
        .filter(
          (hit) =>
            !sectionPlane || sectionPlane.distanceToPoint(hit.point) >= 0,
        );
      const first = hits[0],
        next =
          first &&
          hits.find(
            (hit) =>
              hit.object.userData.targetId !== first.object.userData.targetId,
          );
      if (first && next && Math.abs(first.distance - next.distance) < 1e-5)
        return {
          error:
            "Overlapping profile targets are ambiguous here. Choose the exact region card.",
        };
      return { id: first?.object.userData.targetId as string | undefined };
    }
    const candidates: Array<{ id: string; distance: number }> = [];
    for (const [id, loops] of paths) {
      let closest = Infinity;
      for (const loop of loops)
        for (let index = 0; index < loop.length; index++) {
          const a = loop[index],
            b = loop[(index + 1) % loop.length];
          if (
            sectionPlane &&
            sectionPlane.distanceToPoint(a) < 0 &&
            sectionPlane.distanceToPoint(b) < 0
          )
            continue;
          const pa = screenA.copy(a).project(camera),
            pb = screenB.copy(b).project(camera);
          if (pa.z < -1 || pa.z > 1 || pb.z < -1 || pb.z > 1) continue;
          const ax = rect.left + ((pa.x + 1) * rect.width) / 2,
            ay = rect.top + ((1 - pa.y) * rect.height) / 2;
          const bx = rect.left + ((pb.x + 1) * rect.width) / 2,
            by = rect.top + ((1 - pb.y) * rect.height) / 2;
          const dx = bx - ax,
            dy = by - ay;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((event.clientX - ax) * dx + (event.clientY - ay) * dy) /
                (dx * dx + dy * dy || 1),
            ),
          );
          const world = worldPoint.copy(a).lerp(b, t);
          if (sectionPlane && sectionPlane.distanceToPoint(world) < 0) continue;
          closest = Math.min(
            closest,
            Math.hypot(
              event.clientX - (ax + t * dx),
              event.clientY - (ay + t * dy),
            ),
          );
        }
      if (closest <= 8) candidates.push({ id, distance: closest });
    }
    candidates.sort(
      (a, b) => a.distance - b.distance || a.id.localeCompare(b.id),
    );
    if (candidates[1] && candidates[1].distance - candidates[0].distance < 1)
      return {
        error:
          "The cap groups overlap at this point. Choose the exact perimeter card.",
      };
    return { id: candidates[0]?.id };
  };
  const perform = (event: { clientX: number; clientY: number }) => {
    const frame = useOperationDrop.getState().frame;
    try {
      if (!frame || !operationDropCurrent(frame))
        throw new Error(
          "Project, component or modeling task changed. Cancel and choose the operation target again.",
        );
      const target = hit(event);
      if (!target.id)
        throw new Error(
          target.error ??
            "Drop or click a highlighted closed profile or original cap perimeter. Arbitrary faces and edges are unsupported; choose a target card for an overlapping or detailed target.",
        );
      runCommand(frame.handoffSketchId ? "sketch.solidRegion" : "feature.operationTarget", {
        operationFrame: frame,
        operationTargetId: target.id,
      });
    } catch (error) {
      useOperationDrop.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const queueHover = (event: { clientX: number; clientY: number }) => {
    pendingPointer = { clientX: event.clientX, clientY: event.clientY };
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (!active() || !pendingPointer) return;
      const hovered = hit(pendingPointer);
      if (useOperationDrop.getState().hoverId !== hovered.id)
        useOperationDrop.setState({ hoverId: hovered.id });
    });
  };
  const move = (event: PointerEvent) => {
    if (!active() || event.buttons) return;
    queueHover(event);
  };
  const leave = () => {
    pendingPointer = undefined;
    if (active()) useOperationDrop.setState({ hoverId: undefined });
  };
  const down = (event: PointerEvent) => {
    press =
      event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined;
  };
  const click = (event: MouseEvent) => {
    if (!active()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const previous = press;
    press = undefined;
    if (
      event.button === 0 &&
      previous &&
      Math.hypot(previous.x - event.clientX, previous.y - event.clientY) <= 4
    )
      perform(event);
  };
  const over = (event: DragEvent) => {
    if (
      !useOperationDrop.getState().frame ||
      !event.dataTransfer ||
      !Array.from(event.dataTransfer.types).includes(OPERATION_DRAG_TYPE)
    )
      return;
    event.preventDefault();
    // Accept this operation's drag at the canvas while hover resolution stays
    // throttled. Final drop synchronously validates its exact current target;
    // a one-frame hover delay never makes the browser discard a valid drop.
    event.dataTransfer.dropEffect = active() ? "copy" : "none";
    queueHover(event);
  };
  const drop = (event: DragEvent) => {
    const frame = useOperationDrop.getState().frame;
    if (
      !frame ||
      !event.dataTransfer ||
      !Array.from(event.dataTransfer.types).includes(OPERATION_DRAG_TYPE)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    leave();
    if (
      event.dataTransfer.getData(OPERATION_DRAG_TYPE) !==
      operationTransferValue(frame)
    ) {
      useOperationDrop.setState({
        error:
          "This drag belongs to an old operation. Cancel and drag a fresh operation token.",
      });
      return;
    }
    perform(event);
  };
  const unsubs = [
    useCadStore.subscribe(refresh),
    useOperationDrop.subscribe(refresh),
    useViewerState.subscribe(refresh),
    useFileJobs.subscribe(refresh),
    useSketchSolidHandoff.subscribe(refresh),
  ];
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("dragleave", leave);
  canvas.addEventListener("dragend", leave);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("click", click, true);
  canvas.addEventListener("dragover", over);
  canvas.addEventListener("drop", drop, true);
  refresh();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(hoverFrame);
    unsubs.forEach((unsubscribe) => unsubscribe());
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("dragleave", leave);
    canvas.removeEventListener("dragend", leave);
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("click", click, true);
    canvas.removeEventListener("dragover", over);
    canvas.removeEventListener("drop", drop, true);
    clear();
    scene.remove(group);
  };
  return {
    refresh,
    dispose,
    inspect: () => group.children.flatMap((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return [];
      const targetId = object.userData.targetId;
      if (typeof targetId !== "string") return [];
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      return [{
        targetId,
        clippingPlanes: materials.flatMap((material) => (material.clippingPlanes ?? []).map((plane: THREE.Plane) => ({
          normal: plane.normal.toArray(), constant: plane.constant,
        }))),
      }];
    }),
  };
}
