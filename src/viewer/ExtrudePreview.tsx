import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";

interface PreviewRuntime {
  group: THREE.Group;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  render: () => void;
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
/** Independent camera and resources: never registers the project viewer controller. */
export function ExtrudePreview({
  meshes,
  label = "Native extrusion geometry preview",
}: {
  meshes: RenderMesh[];
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<PreviewRuntime>(undefined);
  const [error, setError] = useState("");
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
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(2, -2, 2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x345060, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(1, -2, 3);
    scene.add(light);
    const controls = new OrbitControls(camera, renderer.domElement);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    const resize = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      render();
    };
    runtime.current = { group, camera, controls, render };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => {
      runtime.current = undefined;
      observer.disconnect();
      controls.dispose();
      clearMeshes(group);
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
    if (meshes.length) {
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
  }, [meshes]);
  return (
    <div>
      <div
        ref={host}
        className="extrude-preview"
        role="img"
        aria-label={label}
      />
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
