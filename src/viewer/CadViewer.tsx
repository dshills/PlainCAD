import { installOperationDropPicking, type OperationDropPickingHandle } from "./operationDropPicking";
import { installSketchPlanePicking } from "./sketchPlanePicking";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { useThemeState } from "../state/useThemeState";
import { viewerThemeColors } from "../ui/themes/themes";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { registerViewerDiagnostics } from "./viewerDiagnostics";
import { registerCameraController } from "./cameraController";
import { DEFAULT_CAMERA_POSE, cameraClipRange, VIEW_DIRECTIONS, validCameraPose, sectionPlane } from "../cad/inspection/cameraViews";
import { useSectionState } from "../state/sectionState";
import type { CameraPose } from "../cad/document/schema";
import { useInspectionState } from "../state/inspectionState";
import { MeasurementError, measureWorldPoint } from "../cad/inspection/measurements";
import { sketchComponentId } from "../cad/document/components";
import { hiddenViewerBodies, useViewerState } from "../state/viewerState";
import { useCadStore } from "../state/useCadStore";
import { SelectionRef } from "../cad/document/schema";
import { RenderMesh } from "../cad/kernel/KernelAdapter";
import { boundsFromMeshes } from "../cad/kernel/meshConversion";
import { CadDocument } from "../cad/document/schema";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { sampleArc } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { resolveDocumentPlanes, transformPoint } from "../cad/sketch/planes";
import { currentGeometryHighlight, useGeometryHighlight } from "../state/useGeometryHighlight";
import { solidDimensions } from "../cad/inspection/solidDimensions";
import { SolidDimensionOverlay, type DimensionProjection } from "./SolidDimensionOverlay";

interface ViewerRuntime {
  background: THREE.Color;
  grid: THREE.GridHelper;
  camera: THREE.PerspectiveCamera;
  applyPose(pose: CameraPose, remember?: boolean): boolean;
  controls: OrbitControls;
  modelGroup: THREE.Group;
  sketchGroup: THREE.Group;
  measurementGroup: THREE.Group;
  operationPicking: OperationDropPickingHandle;
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
  const theme = useThemeState((state) => state.theme);
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewerRuntime | undefined>(undefined);
  const meshesRef = useRef<RenderMesh[]>([]);
  const selectedBodyIdRef = useRef<string | undefined>(undefined);
  const highlightedBodyIdsRef = useRef<readonly string[]>([]);
  const cameraIntentRef = useRef<{ session: number; preservePose: boolean } | undefined>(undefined);
  const lastAutoFitSessionRef = useRef<number | undefined>(undefined);
  const selectRef = useRef<(selection: SelectionRef | undefined) => void>(selectNoop);
  const documentIdRef = useRef("");
  const meshes = useCadStore((state) => state.rebuild.result?.meshes ?? EMPTY_MESHES);
  const rebuild = useCadStore((state) => state.rebuild);
  const history = useCadStore((state) => state.history);
  const document = history.present;
  const select = useCadStore((state) => state.select);
  const session = useCadStore((state) => state.documentSession);
  const componentId = useCadStore((state) => state.activeComponentId);
  const fileBusy = useCadStore((state) => state.fileBusy);
  const highlight = useGeometryHighlight((state) => state.highlight);
  const currentHighlight = useMemo(() => currentGeometryHighlight({ history, documentSession: session, activeComponentId: componentId, fileBusy, rebuild }, highlight), [highlight, history, session, componentId, fileBusy, rebuild]);
  useEffect(() => {
    // Release captured result arrays on invalidation; an Undo must not revive an
    // old inspection hint just because it returns the same document object.
    if (highlight && !currentHighlight && useGeometryHighlight.getState().highlight === highlight)
      useGeometryHighlight.setState({ highlight: undefined });
  }, [highlight, currentHighlight]);
  const view = useViewerState();
  const inspection = useInspectionState();
  const section = useSectionState();
  const clippingRef = useRef<THREE.Plane | undefined>(undefined);
  const hidden = useMemo(() => hiddenViewerBodies(document, meshes.map(mesh => mesh.bodyId), session, { session: view.session, hiddenBodyIds: view.hiddenBodyIds, hiddenComponentIds: view.hiddenComponentIds }), [document, meshes, session, view.session, view.hiddenBodyIds, view.hiddenComponentIds]);
  const hiddenSketches = view.session === session ? view.hiddenSketchIds : [];
  const hiddenComponents = view.session === session ? view.hiddenComponentIds : [];
  const documentId = useCadStore((state) => state.history.present.id);
  const selectedBodyId = useCadStore((state) => {
    const selection = state.selection.selectedIds[0];
    return selection?.kind === "body" ? selection.id : undefined;
  });
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const dimensions = useMemo(() =>
    !fileBusy && rebuild.status === "succeeded" && rebuild.result
      ? solidDimensions(document, rebuild.result, selection, componentId, hidden)
      : [], [fileBusy, rebuild.status, rebuild.result, document, selection, componentId, hidden]);
  const dimensionProjector = useRef((point: [number, number, number]): DimensionProjection | undefined => {
    const runtime = runtimeRef.current, host = hostRef.current;
    if (!runtime || !host) return;
    if (clippingRef.current && clippingRef.current.distanceToPoint(new THREE.Vector3(...point)) < 0) return;
    runtime.camera.updateMatrixWorld();
    const projected = new THREE.Vector3(...point).project(runtime.camera);
    return { x: (projected.x + 1) * host.clientWidth / 2, y: (1 - projected.y) * host.clientHeight / 2,
      depth: projected.z, width: host.clientWidth, height: host.clientHeight };
  });

  useEffect(() => {
    selectRef.current = select;
    documentIdRef.current = documentId;
  }, [documentId, select]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new THREE.Scene();
    const background = new THREE.Color("#e7ebe8");
    scene.background = background;
    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -140, 110);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.domElement.className = "viewer-canvas";
    host.appendChild(renderer.domElement);

    renderer.localClippingEnabled = true;
    let controls = new OrbitControls(camera, renderer.domElement);
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
    const applyPose = (pose: CameraPose, remember = true): boolean => {
      if (!validCameraPose(pose)) return false;
      if (remember) cameraIntentRef.current = { session: useCadStore.getState().documentSession, preservePose: true };
      // OrbitControls caches its up-axis quaternion at construction. Recreate it
      // after up changes and discard residual damping from the previous view.
      controls.dispose();
      camera.up.fromArray(pose.cameraUp);
      camera.position.fromArray(pose.cameraPosition);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.fromArray(pose.cameraTarget);
      camera.position.fromArray(pose.cameraPosition);
      const distance = camera.position.distanceTo(controls.target);
      const bounds = boundsFromMeshes(meshesRef.current);
      const span = bounds ? new THREE.Vector3(...bounds.max).distanceTo(new THREE.Vector3(...bounds.min)) : 100;
      Object.assign(camera, cameraClipRange(distance, span));
      camera.updateProjectionMatrix();
      controls.update();
      if (runtimeRef.current) runtimeRef.current.controls = controls;
      return true;
    };
    const operationPicking = installOperationDropPicking(scene, renderer.domElement, camera, () => clippingRef.current);
    runtimeRef.current = { background, grid, camera, controls, applyPose, modelGroup, sketchGroup, measurementGroup, operationPicking, sketchResources: createSketchOverlayResources() };
    const unregisterCamera = registerCameraController({
      read: () => ({ cameraPosition: camera.position.toArray(), cameraTarget: controls.target.toArray(), cameraUp: camera.up.toArray() }),
      apply: applyPose,
      preset: (view) => {
        const { direction, up } = VIEW_DIRECTIONS[view];
        const target = controls.target.clone();
        const distance = camera.position.distanceTo(target) || 100;
        const position = target.clone().addScaledVector(new THREE.Vector3(...direction).normalize(), distance);
        applyPose({ cameraPosition: position.toArray(), cameraTarget: target.toArray(), cameraUp: up });
        cameraIntentRef.current = { session: useCadStore.getState().documentSession, preservePose: false };
        fitMeshes(camera, controls, meshesRef.current);
      },
    });

    const unregisterDiagnostics = import.meta.env.DEV ? registerViewerDiagnostics(() => ({
      resources: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 },
      cameraUp: camera.up.toArray(),
      operationTargets: operationPicking.inspect(),
      background: background.getHexString(),
      cameraPosition: camera.position.toArray(),
      sectionPlane: clippingRef.current ? { normal: clippingRef.current.normal.toArray(), constant: clippingRef.current.constant } : undefined,
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
        return { bodyId: object.userData.bodyId as string, visible: object.visible, highlighted: object.userData.highlighted === true, clippingEnabled: object.material instanceof THREE.MeshStandardMaterial && Boolean(object.material.clippingPlanes?.length), positions, indices: Array.from(object.geometry.index?.array ?? []) };
      }),
      measurementLine: measurementGroup.children[0] instanceof THREE.Line ? Array.from(measurementGroup.children[0].geometry.getAttribute("position").array) : [],
      sketchPoints: sketchGroup.children.filter((object) => object instanceof THREE.Mesh && typeof object.userData.sketchEntityId === "string").map((object) => ({
        id: object.userData.sketchEntityId as string, position: object.getWorldPosition(new THREE.Vector3()).toArray(),
      })),
      sketchCircles: sketchGroup.children.filter((object) => object instanceof THREE.LineLoop).map((object) => ({
        id: object.userData.sketchEntityId as string,
        normal: new THREE.Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).toArray(),
      })),
    }), (point) => {
      camera.updateMatrixWorld();
      const projected = new THREE.Vector3(...point).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: (projected.x + 1) * rect.width / 2, y: (1 - projected.y) * rect.height / 2, depth: projected.z };
    }) : undefined;

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const fit = () => fitMeshes(camera, controls, meshesRef.current);
    const reset = () => applyPose(DEFAULT_CAMERA_POSE);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
    resizeObserver?.observe(host);
    window.addEventListener("resize", resize);
    window.addEventListener("plaincad:fit-view", fit);
    window.addEventListener("plaincad:reset-camera", reset);

    let raf = 0;
    const animate = () => {
      if (host.clientWidth && host.clientHeight) {
        controls.update();
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    const uninstallPlanePicking = installSketchPlanePicking(scene, renderer, camera, modelGroup, () => clippingRef.current);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(modelGroup.children.filter((object) => object.visible), true).find((item) => item.object instanceof THREE.Mesh && (!clippingRef.current || clippingRef.current.distanceToPoint(item.point) >= 0));
      const bodyId = hit ? findBodyId(hit.object) : undefined;
      selectRef.current(bodyId ? { kind: "body", id: bodyId, documentId: documentIdRef.current } : undefined);
    };
    renderer.domElement.addEventListener("click", click);

    return () => {
      uninstallPlanePicking();
      operationPicking.dispose();
      unregisterDiagnostics?.();
      unregisterCamera();
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
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
    const colors = viewerThemeColors[theme];
    runtime.background.set(colors.background);
    const positions = runtime.grid.geometry.getAttribute("position");
    const attribute = runtime.grid.geometry.getAttribute("color");
    const major = new THREE.Color(colors.gridMajor), minor = new THREE.Color(colors.gridMinor);
    for (let i = 0; i < positions.count; i += 2) {
      const center = (Math.abs(positions.getX(i)) < 1e-6 && Math.abs(positions.getX(i + 1)) < 1e-6) ||
        (Math.abs(positions.getZ(i)) < 1e-6 && Math.abs(positions.getZ(i + 1)) < 1e-6);
      const color = center ? major : minor;
      attribute.setXYZ(i, color.r, color.g, color.b);
      attribute.setXYZ(i + 1, color.r, color.g, color.b);
    }
    attribute.needsUpdate = true;
    const resources = runtime.sketchResources;
    resources.lineMaterial.color.set(colors.line);
    resources.pointMaterial.color.set(colors.line);
    resources.constructionMaterial.color.set(colors.construction);
    resources.errorLineMaterial.color.set(colors.error);
    resources.errorPointMaterial.color.set(colors.error);
    resources.circleMaterial.color.set(colors.circle);
  }, [theme]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    updateMeshes(runtime.modelGroup, meshes);
    applyClipping(runtime.modelGroup, clippingRef.current);
    applySelection(runtime.modelGroup, selectedBodyIdRef.current, highlightedBodyIdsRef.current);
  }, [meshes]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime)
      updateSketchOverlay(
        runtime.sketchGroup,
        document,
        runtime.sketchResources,
        hiddenComponents,
        hiddenSketches,
        rebuild.status === "succeeded" &&
          rebuild.result?.documentId === document.id
          ? rebuild.result
          : undefined,
      );
    if (runtime) applyClipping(runtime.sketchGroup, clippingRef.current);
  }, [document, rebuild, view.hiddenComponentIds, view.hiddenSketchIds, view.session, session]);

  useEffect(() => {
    meshesRef.current = meshes.filter((mesh) => !hidden.includes(mesh.bodyId));
    const runtime = runtimeRef.current;
    if (!runtime) return;
    applyVisibility(runtime.modelGroup, hidden);
    if (meshesRef.current.length && lastAutoFitSessionRef.current !== session) {
      const intent = cameraIntentRef.current?.session === session ? cameraIntentRef.current : undefined;
      if (!intent) runtime.applyPose(DEFAULT_CAMERA_POSE, false);
      if (!intent?.preservePose) fitMeshes(runtime.camera, runtime.controls, meshesRef.current);
      lastAutoFitSessionRef.current = session;
    }
  }, [meshes, document, view.hiddenBodyIds, view.hiddenComponentIds, view.session, session]);

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
      applyClipping(group, clippingRef.current);
    } catch (error) {
      // Expected lost references have a diagnostic in the measurement panel.
      if (!(error instanceof MeasurementError)) console.error("Measurement overlay failed", error);
    }
  }, [inspection.session, inspection.first, inspection.second, session, document, rebuild.result, rebuild.status]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const axis = section.session === session ? section.axis : undefined;
    const spec = axis ? sectionPlane(axis, section.offset, section.positive) : undefined;
    clippingRef.current = spec ? new THREE.Plane(new THREE.Vector3(...spec.normal), spec.constant) : undefined;
    for (const group of [runtime.modelGroup, runtime.sketchGroup, runtime.measurementGroup]) applyClipping(group, clippingRef.current);
    // The picker must read the newly installed plane, after this effect updates
    // clippingRef; a synchronous section-store subscription reads the old plane.
    runtime.operationPicking.refresh();
  }, [session, section.session, section.axis, section.offset, section.positive]);

  useEffect(() => {
    selectedBodyIdRef.current = selectedBodyId;
    highlightedBodyIdsRef.current = currentHighlight?.bodyIds ?? [];
    const runtime = runtimeRef.current;
    if (runtime) applySelection(runtime.modelGroup, selectedBodyId, highlightedBodyIdsRef.current);
  }, [selectedBodyId, currentHighlight]);

  return <div ref={hostRef} className="viewer-canvas"><SolidDimensionOverlay dimensions={dimensions} project={dimensionProjector.current} /></div>;
}

function applyClipping(group: THREE.Group, plane: THREE.Plane | undefined) {
  group.traverse((object) => {
    const material = (object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      const enabled = Boolean(item.clippingPlanes?.length);
      item.clippingPlanes = plane ? [plane] : null;
      if (enabled !== Boolean(plane)) item.needsUpdate = true;
    }
  });
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
  hiddenComponents: readonly string[],
  hiddenSketches: readonly string[],
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
    if (hiddenSketches.includes(sketch.id) || hiddenComponents.includes(sketchComponentId(document, sketch.id))) continue;
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
  highlightedBodyIds: readonly string[] = [],
) {
  const highlighted = new Set(highlightedBodyIds);
  modelGroup.traverse((child) => {
    if (
      child instanceof THREE.Mesh &&
      child.material instanceof THREE.MeshStandardMaterial
    ) {
      const selected = child.userData.bodyId === selectedBodyId;
      const suggested = highlighted.has(child.userData.bodyId as string);
      child.userData.highlighted = suggested;
      child.material.color.set(
        selected ? "#f2c14e" : suggested ? "#32cee0" : (child.userData.baseColor ?? "#8fb7b4"),
      );
      child.material.emissive.set(selected ? "#3a2500" : suggested ? "#003c44" : "#000000");
      child.material.emissiveIntensity = selected || suggested ? 0.18 : 0;
    }
    if (
      child instanceof THREE.LineSegments &&
      child.material instanceof THREE.LineBasicMaterial
    ) {
      const bodyId = findBodyId(child);
      child.material.color.set(
        bodyId === selectedBodyId
          ? "#7a5200"
          : highlighted.has(bodyId ?? "") ? "#007c90"
          : (child.userData.edgeColor ?? "#31413c"),
      );
    }
  });
}

function fitMeshes(camera: THREE.PerspectiveCamera, controls: OrbitControls, meshes: RenderMesh[]) {
  const bounds = boundsFromMeshes(meshes);
  if (!bounds) return;
  const center = new THREE.Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  );
  const size = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2], 40);
  const direction = camera.position.clone().sub(controls.target).normalize();
  if (direction.lengthSq() === 0) direction.set(1, -1, 1).normalize();
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, size * 2.4);
  Object.assign(camera, cameraClipRange(size * 2.4, size));
  camera.updateProjectionMatrix();
  controls.update();
}

function selectNoop(_selection: SelectionRef | undefined) {
}
