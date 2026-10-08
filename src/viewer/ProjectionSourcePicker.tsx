import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import type { ProjectionBoundaryTarget } from "./projectionBoundaryPicking";
import { fitCameraBounds } from "./cameraFit";
import { useThemeState } from "../state/useThemeState";
import { viewerThemeColors } from "../ui/themes/themes";
import "./ProjectionSourcePicker.css";

interface PickerRuntime {
  scene: THREE.Scene;
  group: THREE.Group;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render: () => void;
  fit: () => void;
  fitted: boolean;
}
function dispose(group: THREE.Group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose());
    }
  });
  group.clear();
}
/** Owns its renderer/camera, and never modifies the project viewer or document. */
export function ProjectionSourcePicker({ meshes, targets, selectedId, disabled, onChoose }: {
  meshes: RenderMesh[];
  targets: ProjectionBoundaryTarget[];
  selectedId: string;
  disabled: boolean;
  onChoose: (target: ProjectionBoundaryTarget) => void;
}) {
  const host = useRef<HTMLDivElement>(null), runtime = useRef<PickerRuntime>(undefined), targetsRef = useRef(targets);
  targetsRef.current = targets;
  const theme = useThemeState((state) => state.theme);
  const [paths, setPaths] = useState<{ id: string; path: string }[]>([]), [error, setError] = useState("");
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError("Interactive source view is unavailable. Choose a boundary by name below."); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), group = new THREE.Group();
    scene.add(group, new THREE.HemisphereLight(0xffffff, 0x334455, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(1, -2, 3); scene.add(light);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    camera.up.set(0, 0, 1); camera.position.set(2, -2, 2);
    const controls = new OrbitControls(camera, renderer.domElement);
    const render = () => {
      renderer.render(scene, camera);
      camera.updateMatrixWorld();
      const width = element.clientWidth, height = element.clientHeight;
      const next = targetsRef.current.map((target) => {
        const curves = target.curves.map((curve) => curve.map((point) => new THREE.Vector3(point.x, point.y, point.z).project(camera)));
        const path = curves.filter((curve) => curve.every((point) => point.z >= -1 && point.z <= 1)).map((curve) => curve.map((point, i) => `${i ? "L" : "M"}${((point.x + 1) * width / 2).toFixed(2)},${((1 - point.y) * height / 2).toFixed(2)}`).join(" ")).join(" ");
        return { id: target.id, path };
      });
      setPaths((previous) => previous.length === next.length && previous.every((item, i) => item.id === next[i].id && item.path === next[i].path) ? previous : next);
    };
    const fit = () => {
      const bounds = new THREE.Box3().setFromObject(group);
      if (!bounds.isEmpty() && element.clientWidth > 0 && element.clientHeight > 0 && fitCameraBounds(camera, controls.target, bounds)) {
        if (runtime.current) runtime.current.fitted = true;
        controls.update();
      }
      render();
    };
    controls.addEventListener("change", render);
    runtime.current = { scene, group, camera, controls, render, fit, fitted: false };
    const resize = () => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
      if (!runtime.current?.fitted) fit(); else render();
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => { runtime.current = undefined; observer.disconnect(); controls.dispose(); dispose(group); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
  }, []);
  useEffect(() => {
    const state = runtime.current;
    if (!state) return;
    dispose(state.group);
    for (const mesh of meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
      geometry.setIndex(mesh.indices);
      state.group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: "#779398", roughness: 0.75 })));
    }
    state.fit();
  }, [meshes]);
  useEffect(() => { runtime.current?.render(); }, [targets]);
  useEffect(() => { if (runtime.current) { runtime.current.scene.background = new THREE.Color(viewerThemeColors[theme].background); runtime.current.render(); } }, [theme]);
  const pathMap = useMemo(() => new Map(paths.map((item) => [item.id, item.path])), [paths]);
  const choose = (target: ProjectionBoundaryTarget) => { if (!disabled) onChoose(target); };
  return <div className="projection-source-picker">
    <div className="projection-source-frame">
      <div ref={host} className="projection-source-canvas" role="img" aria-label="Native projection source geometry" />
      <svg className="projection-source-overlay" aria-label="Pick a complete part boundary">
        {targets.map((target) => {
          const path = pathMap.get(target.id);
          if (!path) return null;
          return <g key={target.id} role="button" aria-label={`${target.disabledReason ? "Inspect unavailable" : "Project"} ${target.label}`} aria-pressed={target.id === selectedId} aria-disabled={disabled} tabIndex={disabled ? -1 : 0} className={`projection-boundary${target.id === selectedId ? " selected" : ""}${target.disabledReason ? " incompatible" : ""}`} onClick={() => choose(target)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); choose(target); } }}>
            <title>{target.disabledReason ?? `${target.label} — click to preview linked geometry`}</title>
            <path d={path} className="projection-boundary-hit" />
            <path d={path} className="projection-boundary-line" />
          </g>;
        })}
      </svg>
      <button type="button" className="preview-fit" aria-label="Fit projection sources" disabled={!meshes.length} onClick={() => runtime.current?.fit()}>Fit sources</button>
    </div>
    <p className="muted">Click a highlighted boundary to preview its linked outline. Orbit by dragging the part; scroll to zoom. Boundary outlines show through the part so both caps can be selected. Tab, then Enter or Space also selects a boundary.</p>
    {error ? <p role="status">{error}</p> : null}
  </div>;
}
