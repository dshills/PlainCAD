import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useCadStore } from "../state/useCadStore";
import { RenderMesh } from "../cad/kernel/KernelAdapter";
import { boundsFromMeshes } from "../cad/kernel/meshConversion";

export function CadViewer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const meshes = useCadStore((state) => state.rebuild.result?.meshes ?? []);
  const select = useCadStore((state) => state.select);
  const documentId = useCadStore((state) => state.history.present.id);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e7ebe8");
    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 10000);
    camera.position.set(120, -140, 110);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.domElement.className = "viewer-canvas";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.GridHelper(240, 24, "#7f918b", "#c1cbc7"));
    scene.add(new THREE.AxesHelper(60));
    scene.add(new THREE.HemisphereLight("#ffffff", "#a8b0ad", 2.6));
    const light = new THREE.DirectionalLight("#ffffff", 2);
    light.position.set(80, -80, 120);
    scene.add(light);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const fit = () => fitMeshes(camera, controls, meshes);
    window.addEventListener("resize", resize);
    window.addEventListener("plaincad:fit-view", fit);
    window.addEventListener("plaincad:reset-camera", fit);

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const updateMeshes = (renderMeshes: RenderMesh[]) => {
      disposeObject3D(modelGroup);
      modelGroup.clear();
      for (const mesh of renderMeshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
        geometry.setIndex(mesh.indices);
        const material = new THREE.MeshStandardMaterial({ color: mesh.color ?? "#8fb7b4", roughness: 0.55, metalness: 0.05 });
        const object = new THREE.Mesh(geometry, material);
        object.userData.bodyId = mesh.bodyId;
        object.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: "#31413c" })));
        modelGroup.add(object);
      }
      fitMeshes(camera, controls, renderMeshes);
    };
    updateMeshes(meshes);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(modelGroup.children, true).find((item) => item.object instanceof THREE.Mesh);
      const bodyId = hit ? findBodyId(hit.object) : undefined;
      select(bodyId ? { kind: "body", id: bodyId, documentId } : undefined);
    };
    renderer.domElement.addEventListener("click", click);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("plaincad:fit-view", fit);
      window.removeEventListener("plaincad:reset-camera", fit);
      renderer.domElement.removeEventListener("click", click);
      disposeObject3D(scene);
      disposeObject3D(modelGroup);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [documentId, meshes, select]);

  return <div ref={hostRef} className="viewer-canvas" />;
}

function findBodyId(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.bodyId === "string") return current.userData.bodyId;
    current = current.parent;
  }
  return undefined;
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const item of material) item.dispose();
    } else if (material) {
      material.dispose();
    }
  });
}

function fitMeshes(camera: THREE.PerspectiveCamera, controls: OrbitControls, meshes: RenderMesh[]) {
  const bounds = boundsFromMeshes(meshes);
  if (!bounds) {
    camera.position.set(120, -140, 110);
    controls.target.set(0, 0, 0);
    return;
  }
  const center = new THREE.Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  );
  const size = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2], 40);
  controls.target.copy(center);
  camera.position.set(center.x + size * 1.3, center.y - size * 1.5, center.z + size * 1.1);
  camera.near = Math.max(0.1, size / 100);
  camera.far = size * 100;
  camera.updateProjectionMatrix();
}
