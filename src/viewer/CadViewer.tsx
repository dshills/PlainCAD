import type { RebuildResult } from "../cad/worker/workerProtocol";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { registerViewerDiagnostics } from "./viewerDiagnostics";
import { useInspectionState } from "../state/inspectionState";
import { MeasurementError, measureWorldPoint } from "../cad/inspection/measurements";
import { useViewerState } from "../state/viewerState";
import { useCadStore } from "../state/useCadStore";
import { SelectionRef } from "../cad/document/schema";
import { RenderMesh } from "../cad/kernel/KernelAdapter";
import { boundsFromMeshes } from "../cad/kernel/meshConversion";
import { CadDocument } from "../cad/document/schema";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { sampleArc } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { resolveDocumentPlanes, transformPoint } from "../cad/sketch/planes";

interface ViewerRuntime {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  modelGroup: THREE.Group;
  sketchGroup: THREE.Group;
  measurementGroup: THREE.Group;
  sketchResources: SketchOverlayResources;
}

interface SketchOverlayResources {
  lineMaterial: THREE.LineBasicMaterial;
  constructionMaterial: THREE.LineDashedMaterial;
  errorLineMaterial: THREE.LineBasicMaterial;
  errorPointMaterial: THREE.MeshBasicMaterial;
  pointMaterial: THREE.MeshBasicMaterial;
  circleMaterial: THREE.LineBasicMaterial;
  pointGeometry: THREE.SphereGeometry;
  unitCircleGeometry: THREE.BufferGeometry;
}

const EMPTY_MESHES: RenderMesh[] = [];

export function CadViewer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewerRuntime | undefined>(undefined);
  const meshesRef = useRef<RenderMesh[]>([]);
  const selectedBodyIdRef = useRef<string | undefined>(undefined);
  const lastAutoFitSessionRef = useRef<number | undefined>(undefined);
  const selectRef = useRef<(selection: SelectionRef | undefined) => void>(selectNoop);
  const documentIdRef = useRef("");
  const meshes = useCadStore((state) => state.rebuild.result?.meshes ?? EMPTY_MESHES);
  const rebuild = useCadStore((state) => state.rebuild);
  const document = useCadStore((state) => state.history.present);
  const select = useCadStore((state) => state.select);
  const session = useCadStore((state) => state.documentSession);
  const view = useViewerState();
  const inspection = useInspectionState();
  const hidden = view.session === session ? view.hiddenBodyIds : [];
  const documentId = useCadStore((state) => state.history.present.id);
  const selectedBodyId = useCadStore((state) => {
    const selection = state.selection.selectedIds[0];
    return selection?.kind === "body" ? selection.id : undefined;
  });

  useEffect(() => {
    selectRef.current = select;
    documentIdRef.current = documentId;
  }, [documentId, select]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e7ebe8");
    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -140, 110);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.domElement.className = "viewer-canvas";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const grid = new THREE.GridHelper(240, 24, "#7f918b", "#c1cbc7");
    grid.rotation.x = Math.PI / 2;
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.depthWrite = false;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(60));
    scene.add(new THREE.HemisphereLight("#ffffff", "#a8b0ad", 2.6));
    const light = new THREE.DirectionalLight("#ffffff", 2);
    light.position.set(80, -80, 120);
    scene.add(light);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    const sketchGroup = new THREE.Group();
    sketchGroup.renderOrder = 1;
    scene.add(sketchGroup);
    const measurementGroup = new THREE.Group();
    scene.add(measurementGroup);
    runtimeRef.current = { camera, controls, modelGroup, sketchGroup, measurementGroup, sketchResources: createSketchOverlayResources() };

    const unregisterDiagnostics = import.meta.env.DEV ? registerViewerDiagnostics(() => ({
      cameraUp: camera.up.toArray(),
      cameraTarget: controls.target.toArray(),
      gridNormal: new THREE.Vector3(0, 1, 0).applyQuaternion(grid.getWorldQuaternion(new THREE.Quaternion())).toArray(),
      meshes: modelGroup.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh).map((object) => {
        const attribute = object.geometry.getAttribute("position");
        const positions = new Array<number>(attribute.count * 3);
        const point = new THREE.Vector3();
        for (let index = 0; index < attribute.count; index++) {
          object.localToWorld(point.fromBufferAttribute(attribute, index));
          point.toArray(positions, index * 3);
        }
        return { bodyId: object.userData.bodyId as string, visible: object.visible, positions, indices: Array.from(object.geometry.index?.array ?? []) };
      }),
      measurementLine: measurementGroup.children[0] instanceof THREE.Line ? Array.from(measurementGroup.children[0].geometry.getAttribute("position").array) : [],
      sketchPoints: sketchGroup.children.filter((object) => object instanceof THREE.Mesh && typeof object.userData.sketchEntityId === "string").map((object) => ({
        id: object.userData.sketchEntityId as string, position: object.getWorldPosition(new THREE.Vector3()).toArray(),
      })),
      sketchCircles: sketchGroup.children.filter((object) => object instanceof THREE.LineLoop).map((object) => ({
        id: object.userData.sketchEntityId as string,
        normal: new THREE.Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).toArray(),
      })),
    })) : undefined;

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const fit = () => fitMeshes(camera, controls, meshesRef.current);
    const reset = () => resetCamera(camera, controls);
    window.addEventListener("resize", resize);
    window.addEventListener("plaincad:fit-view", fit);
    window.addEventListener("plaincad:reset-camera", reset);

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(modelGroup.children.filter((object) => object.visible), true).find((item) => item.object instanceof THREE.Mesh);
      const bodyId = hit ? findBodyId(hit.object) : undefined;
      selectRef.current(bodyId ? { kind: "body", id: bodyId, documentId: documentIdRef.current } : undefined);
    };
    renderer.domElement.addEventListener("click", click);

    return () => {
      unregisterDiagnostics?.();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("plaincad:fit-view", fit);
      window.removeEventListener("plaincad:reset-camera", reset);
      renderer.domElement.removeEventListener("click", click);
      disposeObject3D(scene);
      disposeObject3D(modelGroup);
      disposeSketchOverlayResources(runtimeRef.current?.sketchResources);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      runtimeRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    updateMeshes(runtime.modelGroup, meshes);
    applySelection(runtime.modelGroup, selectedBodyIdRef.current);
  }, [meshes]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime)
      updateSketchOverlay(
        runtime.sketchGroup,
        document,
        runtime.sketchResources,
        rebuild.status === "succeeded" &&
          rebuild.result?.documentId === document.id
          ? rebuild.result
          : undefined,
      );
  }, [document, rebuild]);

  useEffect(() => {
    meshesRef.current = meshes.filter((mesh) => !hidden.includes(mesh.bodyId));
    const runtime = runtimeRef.current;
    if (!runtime) return;
    applyVisibility(runtime.modelGroup, hidden);
    if (meshesRef.current.length && lastAutoFitSessionRef.current !== session) {
      fitMeshes(runtime.camera, runtime.controls, meshesRef.current);
      lastAutoFitSessionRef.current = session;
    }
  }, [meshes, view.hiddenBodyIds, view.session, session]);

  useEffect(() => {
    const group = runtimeRef.current?.measurementGroup;
    if (!group) return;
    disposeObject3D(group);
    group.clear();
    if (inspection.session !== session || !inspection.first || !inspection.second || rebuild.status !== "succeeded" || !rebuild.result?.success || rebuild.result.documentId !== document.id) return;
    try {
      const points = [inspection.first,inspection.second].map((ref) => measureWorldPoint(document,rebuild.result!,ref));
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x,p.y,p.z)));
      const line = new THREE.Line(geometry,new THREE.LineBasicMaterial({ color: "#b52977", depthTest:false }));
      line.renderOrder = 2;
      group.add(line);
    } catch (error) {
      // Expected lost references have a diagnostic in the measurement panel.
      if (!(error instanceof MeasurementError)) console.error("Measurement overlay failed", error);
    }
  }, [inspection.session, inspection.first, inspection.second, session, document, rebuild.result, rebuild.status]);

  useEffect(() => {
    selectedBodyIdRef.current = selectedBodyId;
    const runtime = runtimeRef.current;
    if (runtime) applySelection(runtime.modelGroup, selectedBodyId);
  }, [selectedBodyId]);

  return <div ref={hostRef} className="viewer-canvas" />;
}

function applyVisibility(group: THREE.Group, hidden: readonly string[]) {
  for (const object of group.children) object.visible = !hidden.includes(object.userData.bodyId as string);
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
  const disposedGeometries = new WeakSet<THREE.BufferGeometry>();
  const disposedMaterials = new WeakSet<THREE.Material>();
  object.traverse((child) => {
    const disposable = child as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    if (disposable.geometry && !disposedGeometries.has(disposable.geometry)) {
      disposable.geometry.dispose();
      disposedGeometries.add(disposable.geometry);
    }
    const material = disposable.material;
    if (Array.isArray(material)) {
      for (const item of material) {
        if (!disposedMaterials.has(item)) {
          item.dispose();
          disposedMaterials.add(item);
        }
      }
    } else if (material && !disposedMaterials.has(material)) {
      material.dispose();
      disposedMaterials.add(material);
    }
  });
}

function updateMeshes(modelGroup: THREE.Group, renderMeshes: RenderMesh[]) {
  disposeObject3D(modelGroup);
  modelGroup.clear();
  for (const mesh of renderMeshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
    geometry.setIndex(mesh.indices);
    const baseColor = mesh.color ?? "#8fb7b4";
    const material = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const object = new THREE.Mesh(geometry, material);
    object.userData.bodyId = mesh.bodyId;
    object.userData.baseColor = baseColor;
    object.userData.edgeColor = "#31413c";
    const edgeMaterial = new THREE.LineBasicMaterial({ color: "#31413c" });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
    edges.userData.edgeOwner = true;
    edges.userData.edgeColor = "#31413c";
    object.add(edges);
    modelGroup.add(object);
  }
}

function createSketchOverlayResources(): SketchOverlayResources {
  const circlePoints = Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
  });
  return {
    lineMaterial: new THREE.LineBasicMaterial({
      color: "#245c87",
      depthWrite: false,
    }),
    constructionMaterial: new THREE.LineDashedMaterial({
      color: "#a66b23",
      dashSize: 2,
      gapSize: 1,
      depthWrite: false,
    }),
    errorLineMaterial: new THREE.LineBasicMaterial({
      color: "#c53a35",
      depthWrite: false,
    }),
    errorPointMaterial: new THREE.MeshBasicMaterial({
      color: "#c53a35",
      depthWrite: false,
    }),
    pointMaterial: new THREE.MeshBasicMaterial({
      color: "#245c87",
      depthWrite: false,
    }),
    circleMaterial: new THREE.LineBasicMaterial({
      color: "#7b3f98",
      depthWrite: false,
    }),
    pointGeometry: new THREE.SphereGeometry(1.4, 12, 8),
    unitCircleGeometry: new THREE.BufferGeometry().setFromPoints(circlePoints),
  };
}

function disposeSketchOverlayResources(
  resources: SketchOverlayResources | undefined,
) {
  resources?.lineMaterial.dispose();
  resources?.constructionMaterial.dispose();
  resources?.errorLineMaterial.dispose();
  resources?.errorPointMaterial.dispose();
  resources?.pointMaterial.dispose();
  resources?.circleMaterial.dispose();
  resources?.pointGeometry.dispose();
  resources?.unitCircleGeometry.dispose();
}

function updateSketchOverlay(
  sketchGroup: THREE.Group,
  document: CadDocument,
  resources: SketchOverlayResources,
  result?: RebuildResult,
) {
  disposeSketchOverlayObjects(sketchGroup, resources);
  sketchGroup.clear();
  const evaluated = evaluateParameters(document.parameters);
  const finite = (...values: number[]) => values.every(Number.isFinite);
  const linePositions: number[] = [];
  const constructionPositions: number[] = [];
  const errorPositions: number[] = [];
  const planes = result?.sketchPlanes
    ? { transforms: new Map(Object.entries(result.sketchPlanes)) }
    : resolveDocumentPlanes(document, evaluated.values);
  for (const sketch of Object.values(document.sketches)) {
    const transform = planes.transforms.get(sketch.id);
    if (!transform) continue;
    const solved =
      result?.solvedSketches?.[sketch.id] ??
      solveSketch(sketch, evaluated.values);
    const failed = solved.errors.length > 0;
    for (const arc of solved.arcs) {
      if (
        !finite(
          arc.center.x,
          arc.center.y,
          arc.start.x,
          arc.start.y,
          arc.end.x,
          arc.end.y,
          arc.radius,
          arc.startAngle,
          arc.sweep,
        )
      )
        continue;
      const geometry = new THREE.BufferGeometry().setFromPoints(
        sampleArc(arc).map((p) => {
          const w = transformPoint(transform, p.x, p.y);
          return new THREE.Vector3(w.x, w.y, w.z);
        }),
      );
      const object = new THREE.Line(
        geometry,
        failed
          ? resources.errorLineMaterial
          : arc.construction
            ? resources.constructionMaterial
            : resources.lineMaterial,
      );
      if (arc.construction) object.computeLineDistances();
      object.userData.sketchEntityId = arc.id;
      sketchGroup.add(object);
    }
    for (const line of solved.lines) {
      if (!finite(line.start.x, line.start.y, line.end.x, line.end.y)) continue;
      const start = transformPoint(transform, line.start.x, line.start.y);
      const end = transformPoint(transform, line.end.x, line.end.y);
      (failed
        ? errorPositions
        : line.construction
          ? constructionPositions
          : linePositions
      ).push(start.x, start.y, start.z, end.x, end.y, end.z);
    }
    for (const point of Object.values(solved.points)) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const world = transformPoint(transform, point.x, point.y);
      const object = new THREE.Mesh(
        resources.pointGeometry,
        failed ? resources.errorPointMaterial : resources.pointMaterial,
      );
      object.position.set(world.x, world.y, world.z);
      object.userData.sketchEntityId = point.id;
      sketchGroup.add(object);
    }
    for (const circle of solved.circles) {
      if (!finite(circle.center.x, circle.center.y, circle.radius)) continue;
      const center = transformPoint(transform, circle.center.x, circle.center.y);
      if (circle.construction) {
        const points = Array.from({ length: 97 }, (_, i) => {
          const angle = (i / 96) * Math.PI * 2,
            w = transformPoint(
              transform,
              circle.center.x + circle.radius * Math.cos(angle),
              circle.center.y + circle.radius * Math.sin(angle),
            );
          return new THREE.Vector3(w.x, w.y, w.z);
        });
        const object = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          failed ? resources.errorLineMaterial : resources.constructionMaterial,
        );
        object.computeLineDistances();
        object.userData.sketchEntityId = circle.id;
        sketchGroup.add(object);
        continue;
      }
      const object = new THREE.LineLoop(
        resources.unitCircleGeometry,
        failed ? resources.errorLineMaterial : resources.circleMaterial,
      );
      object.position.set(center.x, center.y, center.z);
      const normalTarget = transformPoint(transform, circle.center.x, circle.center.y, 1);
      object.up.set(transform.v.x, transform.v.y, transform.v.z);
      object.lookAt(normalTarget.x, normalTarget.y, normalTarget.z);
      object.scale.set(circle.radius, circle.radius, 1);
      object.userData.sketchEntityId = circle.id;
      sketchGroup.add(object);
    }
  }
  if (errorPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(errorPositions, 3),
    );
    sketchGroup.add(
      new THREE.LineSegments(geometry, resources.errorLineMaterial),
    );
  }
  if (constructionPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(constructionPositions, 3),
    );
    const object = new THREE.LineSegments(
      geometry,
      resources.constructionMaterial,
    );
    object.computeLineDistances();
    sketchGroup.add(object);
  }
  if (linePositions.length > 0) {
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    sketchGroup.add(new THREE.LineSegments(lineGeometry, resources.lineMaterial));
  }
}

function disposeSketchOverlayObjects(sketchGroup: THREE.Group, resources: SketchOverlayResources) {
  sketchGroup.traverse((child) => {
    const object = child as THREE.Object3D & { geometry?: THREE.BufferGeometry };
    if (object.geometry && object.geometry !== resources.pointGeometry && object.geometry !== resources.unitCircleGeometry) {
      object.geometry.dispose();
    }
  });
}

function applySelection(
  modelGroup: THREE.Group,
  selectedBodyId: string | undefined,
) {
  modelGroup.traverse((child) => {
    if (
      child instanceof THREE.Mesh &&
      child.material instanceof THREE.MeshStandardMaterial
    ) {
      const selected = child.userData.bodyId === selectedBodyId;
      child.material.color.set(
        selected ? "#f2c14e" : (child.userData.baseColor ?? "#8fb7b4"),
      );
      child.material.emissive.set(selected ? "#3a2500" : "#000000");
      child.material.emissiveIntensity = selected ? 0.18 : 0;
    }
    if (
      child instanceof THREE.LineSegments &&
      child.material instanceof THREE.LineBasicMaterial
    ) {
      const bodyId = findBodyId(child);
      child.material.color.set(
        bodyId === selectedBodyId
          ? "#7a5200"
          : (child.userData.edgeColor ?? "#31413c"),
      );
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
  controls.update();
}

function resetCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  camera.position.set(120, -140, 110);
  camera.near = 0.1;
  camera.far = 10000;
  controls.target.set(0, 0, 0);
  camera.updateProjectionMatrix();
  controls.update();
}

function selectNoop(_selection: SelectionRef | undefined) {
}
