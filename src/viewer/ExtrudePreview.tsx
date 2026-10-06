import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  distanceAlongExtrusionAxis,
  draggedExtrusionDistance,
  steppedExtrusionDistance,
  extrusionHandleEndpoint,
  type DistanceAxis,
} from "./extrudeDistanceHandle";
import { useThemeState } from "../state/useThemeState";
import { viewerThemeColors } from "../ui/themes/themes";
import { useWorkspaceState } from "../state/useWorkspaceState";
import { ArrowsOutLineVerticalIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutLineVertical";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";

interface PreviewRuntime {
  scene: THREE.Scene;
  grid: THREE.GridHelper;
  group: THREE.Group;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render: () => void;
  fitted: boolean;
  fitKey?: string;
}
function clearMeshes(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
  group.clear();
}
/** A transient draft distance control, never durable project data. */
export interface ExtrudeDistanceHandle extends DistanceAxis {
  key: string;
  distance: number;
  expression: string;
  disabledReason?: string;
  onChange: (value: number) => void;
  onCancel: (expression: string) => void;
  onDragging?: (dragging: boolean) => void;
}
/** Independent camera and resources: never registers the project viewer controller. */
export function ExtrudePreview({
  meshes,
  label = "Native extrusion geometry preview",
  distanceHandle,
}: {
  meshes: RenderMesh[];
  label?: string;
  distanceHandle?: ExtrudeDistanceHandle;
}) {
  const theme = useThemeState((state) => state.theme);
  const workbench = useWorkspaceState((state) => state.layout === "workbench");
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<PreviewRuntime>(undefined);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef(distanceHandle);
  useLayoutEffect(() => {
    handleRef.current = distanceHandle;
  }, [distanceHandle]);
  const drag = useRef<{
    pointerId: number;
    startAxis: number;
    distance: number;
    expression: string;
    axis: DistanceAxis;
    viewport: DOMRect;
    camera: THREE.Camera;
    key: string;
    onCancel: ExtrudeDistanceHandle["onCancel"];
    onDragging: ExtrudeDistanceHandle["onDragging"];
  }>(undefined);
  const [projection, setProjection] = useState<{
    x: number;
    y: number;
    baseX: number;
    baseY: number;
    parallel: boolean;
  }>();
  const endDrag = (cancel: boolean, render = true) => {
    const active = drag.current;
    if (!active) return;
    drag.current = undefined;
    if (runtime.current) runtime.current.controls.enabled = true;
    if (cancel) active.onCancel(active.expression);
    active.onDragging?.(false);
    if (render) {
      setDragging(false);
      runtime.current?.render();
    }
  };
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(
        "Preview display is unavailable. Native geometry results are shown below.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      group = new THREE.Group();
    scene.background = new THREE.Color("#091c27");
    scene.add(group);
    const grid = new THREE.GridHelper(200, 20, 0x7f918b, 0xc1cbc7);
    grid.rotation.x = Math.PI / 2;
    grid.visible = false;
    scene.add(grid);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(2, -2, 2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x345060, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(1, -2, 3);
    scene.add(light);
    const controls = new OrbitControls(camera, renderer.domElement);
    const render = () => {
      renderer.render(scene, camera);
      const handle = handleRef.current,
        rect = element.getBoundingClientRect();
      if (!handle || !runtime.current?.fitted || !rect.width || !rect.height) {
        setProjection(undefined);
        return;
      }
      camera.updateMatrixWorld();
      const endpoint = extrusionHandleEndpoint(handle, handle.distance),
        point = endpoint.clone().project(camera),
        base = new THREE.Vector3(
          handle.origin.x,
          handle.origin.y,
          handle.origin.z,
        ).project(camera),
        x = ((point.x + 1) / 2) * rect.width,
        y = ((1 - point.y) / 2) * rect.height;
      if (
        !drag.current &&
        (point.z < -1 ||
          point.z > 1 ||
          x < 0 ||
          y < 0 ||
          x > rect.width ||
          y > rect.height)
      ) {
        setProjection(undefined);
        return;
      }
      // Keep the captured button mounted beyond the viewport; losing it would
      // strand the gesture or unexpectedly restore the original distance.
      const next = {
        x: drag.current ? Math.max(22, Math.min(rect.width - 22, x)) : x,
        y: drag.current ? Math.max(22, Math.min(rect.height - 22, y)) : y,
        baseX: ((base.x + 1) / 2) * rect.width,
        baseY: ((1 - base.y) / 2) * rect.height,
        parallel:
          distanceAlongExtrusionAxis(
            camera,
            rect,
            { x: rect.left + x, y: rect.top + y },
            handle,
          ) === undefined,
      };
      setProjection((previous) =>
        previous &&
        previous.x === next.x &&
        previous.y === next.y &&
        previous.baseX === next.baseX &&
        previous.baseY === next.baseY &&
        previous.parallel === next.parallel
          ? previous
          : next,
      );
    };
    controls.addEventListener("change", render);
    const resize = () => {
      endDrag(true);
      const width = element.clientWidth,
        height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      render();
    };
    runtime.current = {
      scene,
      grid,
      group,
      camera,
      controls,
      render,
      fitted: false,
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => {
      endDrag(true, false);
      runtime.current = undefined;
      observer.disconnect();
      controls.dispose();
      clearMeshes(group);
      grid.geometry.dispose();
      const gridMaterials = Array.isArray(grid.material)
        ? grid.material
        : [grid.material];
      gridMaterials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);
  useEffect(() => {
    const state = runtime.current;
    if (!state) return;
    const { group, camera, controls, render } = state;
    clearMeshes(group);
    const bounds = new THREE.Box3();
    for (const mesh of meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(mesh.positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(mesh.normals, 3),
      );
      geometry.setIndex(mesh.indices);
      const object = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: "#39c8e7", roughness: 0.6 }),
      );
      object.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: "#082732" }),
        ),
      );
      group.add(object);
      bounds.expandByObject(object);
    }
    if (
      meshes.length &&
      !drag.current &&
      (!state.fitted ||
        !handleRef.current ||
        state.fitKey !== handleRef.current.key)
    ) {
      state.fitKey = handleRef.current?.key;
      state.fitted = true;
      const center = bounds.getCenter(new THREE.Vector3()),
        size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1);
      const direction = camera.position.clone().sub(controls.target);
      if (direction.lengthSq() < 1e-12) direction.set(1, -1, 0.8);
      direction.normalize();
      camera.position.copy(center).addScaledVector(direction, size * 1.8);
      camera.near = Math.max(size / 10000, 0.0001);
      camera.far = size * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    }
    render();
  }, [meshes, distanceHandle?.key]);
  useEffect(() => {
    if (
      drag.current &&
      (distanceHandle?.key !== drag.current.key ||
        distanceHandle?.disabledReason)
    )
      endDrag(true);
    runtime.current?.render();
  }, [distanceHandle]);
  useEffect(() => {
    const cancel = () => endDrag(true);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      event.stopPropagation();
      endDrag(true);
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape, true);
    };
  }, []);
  useEffect(() => {
    const state = runtime.current;
    if (!state) return;
    state.scene.background = new THREE.Color(
      viewerThemeColors[theme].background,
    );
    state.grid.visible = workbench;
    const gridMaterials = Array.isArray(state.grid.material)
      ? state.grid.material
      : [state.grid.material];
    gridMaterials.forEach((material) => {
      material.opacity = 0.35;
      material.transparent = true;
    });
    state.group.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        object.material instanceof THREE.MeshStandardMaterial
      )
        object.material.color.set(
          workbench && theme === "light" ? "#d4ad62" : "#39c8e7",
        );
      if (
        object instanceof THREE.LineSegments &&
        object.material instanceof THREE.LineBasicMaterial
      )
        object.material.color.set(theme === "light" ? "#725327" : "#082732");
    });
    state.render();
  }, [theme, workbench, meshes]);
  const handleUnavailable =
    distanceHandle?.disabledReason ??
    (!dragging && projection?.parallel
      ? "Orbit the preview to see the extrusion axis before dragging."
      : undefined);
  return (
    <div className="native-preview">
      <div className="native-preview-frame" style={{ position: "relative" }}>
        <div
          ref={host}
          className="extrude-preview"
          role="img"
          aria-label={label}
        />
        {distanceHandle && projection ? (
          <>
            <svg
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              <line
                data-testid="extrusion-distance-axis"
                x1={projection.baseX}
                y1={projection.baseY}
                x2={projection.x}
                y2={projection.y}
                stroke="#fff3a6"
                strokeWidth="3"
              />
            </svg>
            <button
              type="button"
              aria-label="Drag extrusion distance"
              title={
                handleUnavailable ??
                "Drag along the extrusion axis. Arrow keys change 1 mm (Shift: 10 mm). Escape cancels a drag."
              }
              disabled={Boolean(handleUnavailable)}
              style={{
                position: "absolute",
                left: projection.x,
                top: projection.y,
                transform: "translate(-50%, -50%)",
                touchAction: "none",
                cursor: handleUnavailable ? "not-allowed" : "grab",
                border: "2px solid #fff3a6",
                background: "#091c27",
                color: "#fff3a6",
                borderRadius: "50%",
                width: 44,
                height: 44,
                padding: 0,
                fontSize: 24,
              }}
              onPointerDown={(event) => {
                const state = runtime.current,
                  handle = handleRef.current;
                if (
                  !state ||
                  !handle ||
                  handle.disabledReason ||
                  event.button !== 0 ||
                  drag.current ||
                  !host.current
                )
                  return;
                const viewport = host.current.getBoundingClientRect(),
                  camera = state.camera.clone();
                camera.updateMatrixWorld();
                const startAxis = distanceAlongExtrusionAxis(
                  camera,
                  viewport,
                  { x: event.clientX, y: event.clientY },
                  handle,
                );
                if (startAxis === undefined) return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                state.controls.enabled = false;
                drag.current = {
                  pointerId: event.pointerId,
                  startAxis,
                  distance: handle.distance,
                  expression: handle.expression,
                  axis: handle,
                  viewport,
                  camera,
                  key: handle.key,
                  onCancel: handle.onCancel,
                  onDragging: handle.onDragging,
                };
                setDragging(true);
                handle.onDragging?.(true);
              }}
              onPointerMove={(event) => {
                const active = drag.current,
                  handle = handleRef.current;
                if (!active || active.pointerId !== event.pointerId || !handle)
                  return;
                const value = distanceAlongExtrusionAxis(
                  active.camera,
                  active.viewport,
                  { x: event.clientX, y: event.clientY },
                  active.axis,
                );
                if (value !== undefined)
                  handle.onChange(
                    draggedExtrusionDistance(
                      active.distance,
                      active.startAxis,
                      value,
                      active.axis.direction,
                    ),
                  );
              }}
              onPointerUp={(event) => {
                if (drag.current?.pointerId === event.pointerId) {
                  endDrag(false);
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={() => endDrag(true)}
              onLostPointerCapture={() => endDrag(true)}
              onKeyDown={(event) => {
                if (
                  ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(
                    event.key,
                  ) &&
                  !drag.current &&
                  !handleUnavailable
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  const sign =
                    event.key === "ArrowUp" || event.key === "ArrowRight"
                      ? 1
                      : -1;
                  distanceHandle.onChange(
                    steppedExtrusionDistance(
                      distanceHandle.distance,
                      sign,
                      event.shiftKey,
                    ),
                  );
                }
              }}
            >
              <ArrowsOutLineVerticalIcon size={20} aria-hidden={true} />
            </button>
          </>
        ) : null}
      </div>
      {distanceHandle ? (
        <p className="muted">
          {handleUnavailable ??
            (projection
              ? `Drag the arrow · ${distanceHandle.distance.toFixed(3)} mm${distanceHandle.direction === "symmetric" ? " total" : ""}. Arrow keys also adjust distance.`
              : "The arrow appears when native geometry is ready and its endpoint is in view. Orbit or enter an exact distance.")}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
