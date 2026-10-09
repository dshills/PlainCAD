import { clearAiCanvasPreview, currentAiCanvasPreview, useAiCanvasPreview } from "../state/aiCanvasPreview";
import type { AiProposalMeshes } from "./aiProposalMeshes";
import { openCanvasContext, useCanvasContext } from "../ui/commands/canvasContextState";
import { selectedCanvasActionTarget } from "../ui/commands/canvasActionTarget";
import { runCommand, selectCommandEnablement } from "../ui/commands/commandRegistry";
import { beginLibraryPlacement, libraryFrameCurrent, usePartLibrary, PART_LIBRARY_DRAG_TYPE, readPartLibraryDragId } from "../ui/commands/partLibraryCommand";
import { addMeasurementOverlays, installMeasurementPicking, visibleMeasurementTargets, resolvedMeasurementSelection } from "./measurementPicking";
import { measureModelTargets } from "../cad/inspection/modelMeasurements";
import { ModelMeasurementReadout } from "./ModelMeasurementReadout";
import { createPresentationLights } from "./presentationLights";
import { studioBackground } from "./studioAppearance";
import { DemandRenderer } from "./demandRenderer";
import { fitCameraBounds } from "./cameraFit";
import { ViewerToolbar } from "./ViewerToolbar";
import { addSketchMarkers, inspectSketchMarkers, type SketchMarker } from "./sketchMarkers";
import { ModelMeshes } from "./modelMeshes";
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
import { copyCanvasPng, registerPngCapture } from "../persistence/pngCapture";
import { DEFAULT_CAMERA_POSE, cameraClipRange, VIEW_DIRECTIONS, validCameraPose, sectionPlane } from "../cad/inspection/cameraViews";
import { useSectionState } from "../state/sectionState";
import type { CameraPose } from "../cad/document/schema";
import { useInspectionState } from "../state/inspectionState";
import { MeasurementError, measureWorldPoint } from "../cad/inspection/measurements";
import { sketchComponentId } from "../cad/document/components";
import { hiddenViewerBodies, useViewerState, type PresentationMode, type StudioMaterial } from "../state/viewerState";
import { useCadStore } from "../state/useCadStore";
import { SelectionRef } from "../cad/document/schema";
import { RenderMesh } from "../cad/kernel/KernelAdapter";
import { boundsFromMeshes } from "../cad/kernel/meshConversion";
import { CadDocument } from "../cad/document/schema";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { sampleArc } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { resolvePlacedDocumentPlanes, transformPoint } from "../cad/sketch/planes";
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
  modelMeshes: ModelMeshes;
  aiProposal?: AiProposalMeshes;
  aiOverlayVisibility?: { sketch: boolean; measurement: boolean; mode: PresentationMode };
  refreshQuality(): void;
  invalidate(): void;
  fit(): void;
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
// Debounce short input gaps without adding a long wait before the sharp frame.
const MOVEMENT_RESTORE_DELAY_MS = 50;

export function CadViewer() {
  const theme = useThemeState((state) => state.theme);
  const hostRef = useRef<HTMLDivElement>(null);
  const frameListeners = useRef(new Set<() => void>());
  const subscribeFrames = useRef((listener: () => void) => {
    frameListeners.current.add(listener);
    return () => { frameListeners.current.delete(listener); };
  });
  const runtimeRef = useRef<ViewerRuntime | undefined>(undefined);
  const meshesRef = useRef<RenderMesh[]>([]);
  const renderedMeshesRef = useRef<RenderMesh[]>([]);
  const renderedDocumentRef = useRef<CadDocument | undefined>(undefined);
  const selectedBodyIdRef = useRef<string | undefined>(undefined);
  const highlightedBodyIdsRef = useRef<readonly string[]>([]);
  const cameraIntentRef = useRef<{ session: number; preservePose: boolean } | undefined>(undefined);
  const lastAutoFitSessionRef = useRef<number | undefined>(undefined);
  const selectRef = useRef<(selection: SelectionRef | undefined) => void>(selectNoop);
  const documentIdRef = useRef("");
  const meshes = useCadStore((state) => state.rebuild.result?.meshes ?? EMPTY_MESHES);
  const rebuild = useCadStore((state) => state.rebuild);
  const aiPreview = useAiCanvasPreview((state) => state.preview);
  const aiPreviewMode = useAiCanvasPreview((state) => state.mode);
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
  const presentationMode = view.session === session ? view.presentationMode : "model";
  const inspection = useInspectionState();
  useEffect(() => {
    if (inspection.picking && inspection.session !== session) inspection.setPicking(session, false);
  }, [inspection.picking, inspection.session, session]);
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
    const axes = new THREE.AxesHelper(60);
    scene.add(axes);
    const lights = createPresentationLights(scene);

    const modelMeshes = new ModelMeshes();
    const modelGroup = modelMeshes.group;
    scene.add(modelGroup);
    const sketchGroup = new THREE.Group();
    sketchGroup.renderOrder = 1;
    scene.add(sketchGroup);
    const measurementGroup = new THREE.Group();
    scene.add(measurementGroup);
    const sharpPixelRatio = Math.min(window.devicePixelRatio, 2);
    let moving = false, interacting = false, lastInput = 0;
    let keepFitted = false;
    let edgesVisible = true;
    let appliedPresentationMode: PresentationMode | undefined;
    let appliedStudioMaterial: StudioMaterial | undefined;
    let appliedBackground: string | undefined;
    const frames = new DemandRenderer(() => {
      if (!host.clientWidth || !host.clientHeight || renderer.getContext().isContextLost()) return false;
      const changed = controls.update();
      if (moving && !interacting && performance.now() - lastInput >= MOVEMENT_RESTORE_DELAY_MS) {
        moving = false;
        refreshQuality();
      }
      renderer.render(scene, camera);
      frameListeners.current.forEach((listener) => listener());
      return changed || (moving && !interacting);
    });
    const invalidate = frames.invalidate;
    const refreshQuality = (sharp = false) => {
      const state = useCadStore.getState(), view = useViewerState.getState();
      const current = view.session === state.documentSession;
      const optimize = !current || view.optimizeWhileMoving;
      const showEdges = !current || view.showModelEdges;
      const mode = current ? view.presentationMode : "model";
      const material = current ? view.studioMaterial : "original";
      const nextBackground = studioBackground(mode, current ? view.studioBackdrop : "theme", viewerThemeColors[useThemeState.getState().theme].background);
      if (nextBackground !== appliedBackground) {
        background.set(nextBackground);
        appliedBackground = nextBackground;
      }
      if (mode !== appliedPresentationMode || material !== appliedStudioMaterial) {
        modelMeshes.setPresentationMode(mode, material);
        lights.setMode(mode);
        axes.visible = mode === "model";
        sketchGroup.visible = measurementGroup.visible = mode === "model";
        applySelection(modelGroup, selectedBodyIdRef.current, highlightedBodyIdsRef.current);
        appliedPresentationMode = mode;
        appliedStudioMaterial = material;
      }
      grid.visible = !current || view.showGrid;
      const reduced = moving && optimize && !sharp;
      const ratio = reduced ? Math.min(sharpPixelRatio, 1) : sharpPixelRatio;
      if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
      edgesVisible = showEdges && !reduced;
      if (modelMeshes.setEdgesVisible(edgesVisible)) {
        applyClipping(modelGroup, clippingRef.current);
        applySelection(modelGroup, selectedBodyIdRef.current, highlightedBodyIdsRef.current);
      }
      invalidate();
    };
    const startMoving = () => {
      keepFitted = false;
      interacting = true;
      moving = true;
      lastInput = performance.now();
      refreshQuality();
    };
    const endMoving = () => { interacting = false; lastInput = performance.now(); invalidate(); };
    const listenToControls = () => {
      controls.addEventListener("change", invalidate);
      controls.addEventListener("start", startMoving);
      controls.addEventListener("end", endMoving);
    };
    const disposeControls = () => {
      controls.removeEventListener("change", invalidate);
      controls.removeEventListener("start", startMoving);
      controls.removeEventListener("end", endMoving);
      controls.dispose();
    };
    listenToControls();
    const applyPose = (pose: CameraPose, remember = true): boolean => {
      if (!validCameraPose(pose)) return false;
      keepFitted = false;
      if (remember) cameraIntentRef.current = { session: useCadStore.getState().documentSession, preservePose: true };
      // OrbitControls caches its up-axis quaternion at construction. Recreate it
      // after up changes and discard residual damping from the previous view.
      disposeControls();
      moving = false;
      interacting = false;
      camera.up.fromArray(pose.cameraUp);
      camera.position.fromArray(pose.cameraPosition);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      listenToControls();
      refreshQuality();
      controls.target.fromArray(pose.cameraTarget);
      camera.position.fromArray(pose.cameraPosition);
      const distance = camera.position.distanceTo(controls.target);
      const bounds = boundsFromMeshes(meshesRef.current);
      const span = bounds ? new THREE.Vector3(...bounds.max).distanceTo(new THREE.Vector3(...bounds.min)) : 100;
      Object.assign(camera, cameraClipRange(distance, span));
      camera.updateProjectionMatrix();
      controls.update();
      if (runtimeRef.current) runtimeRef.current.controls = controls;
      invalidate();
      return true;
    };
    const operationPicking = installOperationDropPicking(scene, renderer.domElement, camera, () => clippingRef.current, invalidate);
    const fit = () => {
      keepFitted = true;
      const preview = currentAiCanvasPreview(useCadStore.getState());
      fitMeshes(camera, controls, preview && useAiCanvasPreview.getState().mode === "after" ? preview.result.meshes : meshesRef.current);
      invalidate();
    };
    runtimeRef.current = { background, grid, camera, controls, applyPose, modelGroup, modelMeshes, refreshQuality, invalidate, fit, sketchGroup, measurementGroup, operationPicking, sketchResources: createSketchOverlayResources() };
    const unregisterPng = registerPngCapture("viewer", (request) => {
      if (currentAiCanvasPreview(useCadStore.getState()) || runtimeRef.current?.aiProposal)
        throw new Error("Apply or cancel the AI preview before exporting PNG.");
      if (request.document !== renderedDocumentRef.current || request.result?.meshes !== renderedMeshesRef.current || request.session !== useCadStore.getState().documentSession)
        throw new Error("The drawing view is updating. Wait for the current model, then export PNG again.");
      if (!host.clientWidth || !host.clientHeight)
        throw new Error("Open the 3D view before exporting its PNG.");
      if (renderer.getContext().isContextLost())
        throw new Error("3D rendering was interrupted. Reload the project before exporting PNG.");
      const selectedMesh = request.bodyId ? request.result.meshes.find((mesh) => mesh.bodyId === request.bodyId) : undefined;
      if (request.bodyId && !selectedMesh) throw new Error("Selected body is no longer available. Select a rebuilt body again.");
      if (!request.bodyId && !modelGroup.children.some((object) => object.visible))
        throw new Error("All bodies are hidden. Show a body before exporting the project view.");
      // Encode full-resolution pixels even if a camera gesture is still settling.
      const previousRatio = renderer.getPixelRatio();
      const previousEdges = edgesVisible;
      const visibility = [...new Set([...scene.children, ...modelGroup.children, sketchGroup, measurementGroup])].map((object) => ({ object, visible: object.visible }));
      try {
        refreshQuality(true);
        // 3D images present the model, without editing or inspection overlays.
        sketchGroup.visible = false;
        measurementGroup.visible = false;
        applySelection(modelGroup, undefined, []);
        let exportCamera = camera;
        if (selectedMesh) {
          for (const child of scene.children) child.visible = child === modelGroup || child instanceof THREE.Light;
          for (const child of modelGroup.children) child.visible = child.userData.bodyId === request.bodyId;
          applyClipping(modelGroup, undefined);
          exportCamera = camera.clone();
          const bounds = selectedMesh.bounds;
          const center = new THREE.Vector3(...bounds.min).add(new THREE.Vector3(...bounds.max)).multiplyScalar(0.5);
          const span = new THREE.Vector3(...bounds.max).sub(new THREE.Vector3(...bounds.min)).length();
          const direction = camera.position.clone().sub(controls.target).normalize();
          const angle = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
          const distance = Math.max(span, 1) / (2 * Math.sin(angle)) * 1.2;
          exportCamera.position.copy(center).addScaledVector(direction, distance);
          exportCamera.lookAt(center);
          Object.assign(exportCamera, cameraClipRange(distance, span));
          exportCamera.updateProjectionMatrix();
        }
        // Copy immediately after rendering: WebGL's default buffer is transient.
        renderer.render(scene, exportCamera);
        return copyCanvasPng(renderer.domElement);
      } finally {
        if (renderer.getPixelRatio() !== previousRatio) renderer.setPixelRatio(previousRatio);
        modelMeshes.setEdgesVisible(previousEdges);
        edgesVisible = previousEdges;
        for (const saved of visibility) saved.object.visible = saved.visible;
        applySelection(modelGroup, selectedBodyIdRef.current, highlightedBodyIdsRef.current);
        applyClipping(modelGroup, clippingRef.current);
        renderer.render(scene, camera);
      }
    });
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
        fit();
      },
    });

    const unregisterDiagnostics = import.meta.env.DEV ? registerViewerDiagnostics(() => ({
      performance: {
        ...frames.inspect(),
        markerBatches: sketchGroup.children.filter((object) => object instanceof THREE.InstancedMesh).length,
        pixelRatio: renderer.getPixelRatio(), sharpPixelRatio, moving,
        showModelEdges: edgesVisible,
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        bufferWidth: renderer.domElement.width, bufferHeight: renderer.domElement.height,
      },
      aiPreview: runtimeRef.current?.aiProposal ? { mode: useAiCanvasPreview.getState().mode, meshes: runtimeRef.current.aiProposal.inspect() } : undefined,
      presentation: { mode: modelGroup.userData.presentationMode ?? "model", gridVisible: grid.visible, axesVisible: axes.visible, sketchVisible: sketchGroup.visible, measurementVisible: measurementGroup.visible, lights: scene.children.filter((object) => object instanceof THREE.Light && object.visible).length, shadowMaps: renderer.shadowMap.enabled },
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
        return { bodyId: object.userData.bodyId as string, geometryId: object.geometry.uuid, visible: object.visible, highlighted: object.userData.highlighted === true, clippingEnabled: object.material instanceof THREE.MeshStandardMaterial && Boolean(object.material.clippingPlanes?.length), normals: Array.from(object.geometry.getAttribute("normal").array), appearance: object.material instanceof THREE.MeshStandardMaterial ? { roughness: object.material.roughness, metalness: object.material.metalness, flatShading: object.material.flatShading, color: object.material.color.getHexString() } : undefined, positions, indices: Array.from(object.geometry.index?.array ?? []) };
      }),
      measurementLine: measurementGroup.children[0] instanceof THREE.Line ? Array.from(measurementGroup.children[0].geometry.getAttribute("position").array) : [],
      sketchPoints: inspectSketchMarkers(sketchGroup),
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
      if (keepFitted) fitMeshes(camera, controls, meshesRef.current);
      invalidate();
    };
    const reset = () => applyPose(DEFAULT_CAMERA_POSE);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
    resizeObserver?.observe(host);
    window.addEventListener("resize", resize);
    window.addEventListener("plaincad:fit-view", fit);
    window.addEventListener("plaincad:reset-camera", reset);

    renderer.domElement.addEventListener("webglcontextrestored", invalidate);
    invalidate();

    const guardAiPreview = (event: MouseEvent) => {
      if (currentAiCanvasPreview(useCadStore.getState())) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    renderer.domElement.addEventListener("click", guardAiPreview, true);
    const uninstallMeasurementPicking = installMeasurementPicking(renderer.domElement, camera, modelGroup, () => clippingRef.current);
    const uninstallPlanePicking = installSketchPlanePicking(scene, renderer, camera, modelGroup, () => clippingRef.current, invalidate);
    let disposed = false, uninstallAiFacePicking = () => {};
    void import("./aiFacePicking").then(({ installAiFacePicking }) => {
      if (!disposed) uninstallAiFacePicking = installAiFacePicking(renderer.domElement, camera, modelGroup, () => clippingRef.current,
        () => selectCommandEnablement(useCadStore.getState()).measurementPicking && !useInspectionState.getState().picking && !currentAiCanvasPreview(useCadStore.getState()));
    }).catch((error) => {
      console.error("AI face selection failed", error);
      if (!disposed) useCadStore.getState().setFileError("AI face selection could not start. Save your project and reload to retry.");
    });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pickBody = (event: MouseEvent) => {
      if (currentAiCanvasPreview(useCadStore.getState())) return undefined;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(modelGroup.children.filter((object) => object.visible), true).find((item) => item.object instanceof THREE.Mesh && (!clippingRef.current || clippingRef.current.distanceToPoint(item.point) >= 0));
      const bodyId = hit ? findBodyId(hit.object) : undefined;
      return bodyId;
    };
    let press: { x: number; y: number; button: number } | undefined, dragged = false;
    const down = (event: PointerEvent) => { pendingContext = undefined; press = { x: event.clientX, y: event.clientY, button: event.button }; dragged = false; };
    const move = (event: PointerEvent) => { if (press && event.buttons !== 0 && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) dragged = true; };
    let pendingContext: MouseEvent | undefined;
    const openPointerContext = (event: MouseEvent) => {
      if (useInspectionState.getState().picking || !selectCommandEnablement(useCadStore.getState()).measurementPicking || window.document.querySelector("dialog[open]")) return;
      selectBody(event);
      if (selectCommandEnablement(useCadStore.getState()).canvasBodyActions) openCanvasContext(event.clientX, event.clientY);
    };
    const up = (event: PointerEvent) => {
      if (pendingContext && press && event.button === press.button && event.target === renderer.domElement && !dragged) openPointerContext(pendingContext);
      pendingContext = undefined; press = undefined;
    };
    const cancelPointer = () => { pendingContext = undefined; press = undefined; dragged = false; };
    const selectBody = (event: MouseEvent) => {
      if (currentAiCanvasPreview(useCadStore.getState())) return undefined;
      const bodyId = pickBody(event);
      selectRef.current(bodyId ? { kind: "body", id: bodyId, documentId: documentIdRef.current } : undefined);
      return bodyId;
    };
    const click = (event: MouseEvent) => { if (event.button === 0 && !dragged) selectBody(event); };
    const context = (event: MouseEvent) => {
      event.preventDefault();
      if (!press && event.clientX === 0 && event.clientY === 0) {
        if (!window.document.querySelector("dialog[open]") && selectCommandEnablement(useCadStore.getState()).canvasBodyActions) openCanvasContext(event.clientX, event.clientY);
        return;
      }
      // macOS/Linux may dispatch contextmenu before the right-button drag begins.
      if (press) { pendingContext = event; return; }
      if (!dragged) openPointerContext(event);
    };
    const doubleClick = (event: MouseEvent) => {
      if (dragged || useInspectionState.getState().picking || !selectCommandEnablement(useCadStore.getState()).measurementPicking || window.document.querySelector("dialog[open]")) return;
      selectBody(event);
      const state = useCadStore.getState(), target = selectedCanvasActionTarget(state);
      if (!selectCommandEnablement(state).canvasEditBase || !target) return;
      useCanvasContext.setState({ menu: undefined });
      void (async () => {
        try { await runCommand("canvas.editBody", { canvasTarget: target }); }
        catch (error) { useCadStore.getState().setFileError(error instanceof Error ? error.message : "Could not edit this part."); }
      })();
    };
    const contextKey = (event: KeyboardEvent) => {
      if (window.document.querySelector("dialog[open]")) return;
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      if (!selectCommandEnablement(useCadStore.getState()).canvasBodyActions) return;
      event.preventDefault(); const rect = renderer.domElement.getBoundingClientRect(); openCanvasContext(rect.left + 30, rect.top + 30);
    };
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "3D modeling canvas");
    renderer.domElement.addEventListener("click", click);
    renderer.domElement.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelPointer);
    renderer.domElement.addEventListener("contextmenu", context);
    renderer.domElement.addEventListener("dblclick", doubleClick);
    renderer.domElement.addEventListener("keydown", contextKey);

    return () => {
      renderer.domElement.removeEventListener("click", guardAiPreview, true);
      disposed = true;
      uninstallAiFacePicking();
      uninstallMeasurementPicking();
      uninstallPlanePicking();
      operationPicking.dispose();
      unregisterDiagnostics?.();
      unregisterCamera();
      unregisterPng();
      frames.dispose();
      renderer.domElement.removeEventListener("webglcontextrestored", invalidate);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("plaincad:fit-view", fit);
      window.removeEventListener("plaincad:reset-camera", reset);
      renderer.domElement.removeEventListener("click", click);
      renderer.domElement.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelPointer);
      renderer.domElement.removeEventListener("contextmenu", context);
      renderer.domElement.removeEventListener("dblclick", doubleClick);
      renderer.domElement.removeEventListener("keydown", contextKey);
      runtimeRef.current?.aiProposal?.dispose();
      clearAiCanvasPreview();
      modelMeshes.dispose();
      scene.remove(modelGroup, sketchGroup);
      if (runtimeRef.current) disposeSketchOverlayObjects(sketchGroup, runtimeRef.current.sketchResources);
      sketchGroup.clear();
      disposeObject3D(scene);
      disposeSketchOverlayResources(runtimeRef.current?.sketchResources);
      disposeControls();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      runtimeRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const colors = viewerThemeColors[theme];
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
    runtime.refreshQuality();
  }, [theme]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.modelMeshes.update(meshes);
    // Prepare requested edges with the rebuild, so ending a gesture only toggles cached lines.
    const state = useCadStore.getState(), preferences = useViewerState.getState();
    runtime.modelMeshes.setEdgesVisible(preferences.session !== state.documentSession || preferences.showModelEdges);
    runtime.refreshQuality();
    renderedMeshesRef.current = meshes;
    applyClipping(runtime.modelGroup, clippingRef.current);
    applySelection(runtime.modelGroup, selectedBodyIdRef.current, highlightedBodyIdsRef.current);
    runtime.invalidate();
  }, [meshes]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const preview = currentAiCanvasPreview(useCadStore.getState(), aiPreview);
    let canceled = false;
    if (!preview) {
      if (runtime.aiProposal) {
        runtime.aiProposal.dispose();
        runtime.aiProposal = undefined;
        runtime.modelGroup.visible = true;
        const saved = runtime.aiOverlayVisibility;
        runtime.sketchGroup.visible = saved?.mode === presentationMode ? saved.sketch : presentationMode === "model";
        runtime.measurementGroup.visible = saved?.mode === presentationMode ? saved.measurement : presentationMode === "model";
        runtime.aiOverlayVisibility = undefined;
        runtime.invalidate();
      }
      return;
    }
    void import("./aiProposalMeshes").then(({ renderAiProposal }) => {
      if (canceled || runtimeRef.current !== runtime || !currentAiCanvasPreview(useCadStore.getState(), preview)) return;
      renderAiProposal(runtime, preview, aiPreviewMode, presentationMode, view.studioMaterial, view.showModelEdges, hidden, clippingRef.current);
    }).catch((error) => {
      console.error("AI preview failed", error);
      if (currentAiCanvasPreview(useCadStore.getState(), preview)) {
        clearAiCanvasPreview(preview);
        useCadStore.getState().setFileError("AI preview could not be displayed. Your project was preserved. Try the request again.");
      }
    });
    return () => { canceled = true; };
  }, [aiPreview, aiPreviewMode, document, session, rebuild.result, rebuild.status, fileBusy, componentId, selection, presentationMode, view.studioMaterial, view.showModelEdges, hidden, section.session, section.axis, section.offset, section.positive]);

  useEffect(() => { runtimeRef.current?.refreshQuality(); }, [view.presentationMode, view.studioMaterial, view.studioBackdrop, view.showGrid, view.showModelEdges, view.optimizeWhileMoving, view.session, session]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    renderedDocumentRef.current = document;
    if (runtime)
      updateSketchOverlay(
        runtime.sketchGroup,
        aiPreviewMode === "after" && aiPreview?.candidate && !aiPreview.result.meshes.length ? aiPreview.candidate : document,
        runtime.sketchResources,
        hiddenComponents,
        hiddenSketches,
        aiPreviewMode === "after" && aiPreview?.candidate && !aiPreview.result.meshes.length ? aiPreview.result :
          rebuild.status === "succeeded" && rebuild.result?.documentId === document.id ? rebuild.result : undefined,
      );
    if (runtime) { applyClipping(runtime.sketchGroup, clippingRef.current); runtime.invalidate(); }
  }, [document, rebuild, aiPreview, aiPreviewMode, view.hiddenComponentIds, view.hiddenSketchIds, view.session, session]);

  useEffect(() => {
    meshesRef.current = meshes.filter((mesh) => !hidden.includes(mesh.bodyId));
    const runtime = runtimeRef.current;
    if (!runtime) return;
    applyVisibility(runtime.modelGroup, hidden);
    if (meshesRef.current.length && lastAutoFitSessionRef.current !== session) {
      const intent = cameraIntentRef.current?.session === session ? cameraIntentRef.current : undefined;
      if (!intent) runtime.applyPose(DEFAULT_CAMERA_POSE, false);
      if (!intent?.preservePose) runtime.fit();
      lastAutoFitSessionRef.current = session;
    }
    runtime.invalidate();
  }, [meshes, document, view.hiddenBodyIds, view.hiddenComponentIds, view.session, session]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const group = runtime?.measurementGroup;
    if (!group) return;
    disposeObject3D(group);
    group.clear();
    runtime.invalidate();
    if (inspection.session === session && inspection.picking && rebuild.status === "succeeded" && rebuild.result?.success && !fileBusy) {
      const targets = visibleMeasurementTargets();
      if (inspection.document && (inspection.document !== document || inspection.result !== rebuild.result)) inspection.clearModel();
      const selected = resolvedMeasurementSelection(document, rebuild.result, inspection, targets);
      addMeasurementOverlays(group, targets, selected.map((target) => target.id));
      if (selected.length === 2) try {
        const measurement = measureModelTargets(selected[0], selected[1]);
        if (measurement.length !== undefined && measurement.paths[0]?.length === 2) {
          const geometry = new THREE.BufferGeometry().setFromPoints(measurement.paths[0].map((point) => new THREE.Vector3(point.x, point.y, point.z)));
          group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#b52977", depthTest: false })));
        }
      } catch (error) {
        if (!(error instanceof MeasurementError)) console.error("Measurement overlay failed", error);
      }
      applyClipping(group, clippingRef.current);
      return;
    }
    if (inspection.document && (inspection.document !== document || inspection.result !== rebuild.result || rebuild.status !== "succeeded" || fileBusy)) inspection.clearModel();
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
  }, [inspection.session, inspection.first, inspection.second, inspection.picking, inspection.targetIds, inspection.document, inspection.result, session, document, rebuild.result, rebuild.status, fileBusy, view.hiddenBodyIds, view.hiddenComponentIds, view.hiddenSketchIds, view.session, presentationMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const axis = section.session === session ? section.axis : undefined;
    const spec = axis ? sectionPlane(axis, section.offset, section.positive) : undefined;
    clippingRef.current = spec ? new THREE.Plane(new THREE.Vector3(...spec.normal), spec.constant) : undefined;
    for (const group of [runtime.modelGroup, runtime.sketchGroup, runtime.measurementGroup, ...(runtime.aiProposal ? [runtime.aiProposal.group] : [])]) applyClipping(group, clippingRef.current);
    // The picker must read the newly installed plane, after this effect updates
    // clippingRef; a synchronous section-store subscription reads the old plane.
    runtime.operationPicking.refresh();
    runtime.invalidate();
  }, [session, section.session, section.axis, section.offset, section.positive]);

  useEffect(() => {
    selectedBodyIdRef.current = selectedBodyId;
    highlightedBodyIdsRef.current = currentHighlight?.bodyIds ?? [];
    const runtime = runtimeRef.current;
    if (runtime) { applySelection(runtime.modelGroup, selectedBodyId, highlightedBodyIdsRef.current); runtime.invalidate(); }
  }, [selectedBodyId, currentHighlight]);

  return <div ref={hostRef} className="viewer-canvas" onDragOver={event => {
    if (!event.dataTransfer.types.includes(PART_LIBRARY_DRAG_TYPE)) return;
    const frame = usePartLibrary.getState().frame;
    event.preventDefault(); event.dataTransfer.dropEffect = presentationMode === "model" && frame && !frame.busy && !frame.placement && libraryFrameCurrent(frame) ? "copy" : "none";
  }} onDrop={event => {
    if (!event.dataTransfer.types.includes(PART_LIBRARY_DRAG_TYPE)) return;
    event.preventDefault(); event.stopPropagation();
    const frame = usePartLibrary.getState().frame;
    if (presentationMode !== "model" || !frame || frame.busy || frame.placement || !libraryFrameCurrent(frame)) { useCadStore.getState().setFileError("Open the local part library in Model view with a current rebuilt project before dropping a part."); return; }
    const id = readPartLibraryDragId(event.dataTransfer.getData(PART_LIBRARY_DRAG_TYPE));
    const runtime = runtimeRef.current;
    if (!id || !runtime) { useCadStore.getState().setFileError("This saved-part drag is invalid or the model view is not ready. Try dragging the part again or use Insert at origin."); return; }
    const rect = event.currentTarget.querySelector<HTMLCanvasElement>("canvas.viewer-canvas")?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) { useCadStore.getState().setFileError("The model canvas is not ready for part placement. Try again or use Insert at origin."); return; }
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, runtime.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    if (!hit) { useCadStore.getState().setFileError("This view cannot place a part on the XY ground plane. Use an angled or top view, or Insert at origin."); return; }
    void beginLibraryPlacement(id, { x: hit.x, y: hit.y, z: hit.z });
  }}>{presentationMode === "model" && (!aiPreview || aiPreviewMode === "before") ? <ModelMeasurementReadout project={dimensionProjector.current} subscribeFrames={subscribeFrames.current} /> : null}{presentationMode === "model" && (!aiPreview || aiPreviewMode === "before") && !inspection.picking ? <SolidDimensionOverlay dimensions={dimensions} project={dimensionProjector.current} subscribeFrames={subscribeFrames.current} /> : null}<ViewerToolbar hasGeometry={(aiPreviewMode === "after" && currentAiCanvasPreview(useCadStore.getState(), aiPreview) ? aiPreview!.result.meshes : meshes).some((mesh) => !hidden.includes(mesh.bodyId))} /></div>;
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
  const points: SketchMarker[] = [], errorPoints: SketchMarker[] = [];
  const planes = result?.sketchPlanes
    ? { transforms: new Map(Object.entries(result.sketchPlanes)) }
    : resolvePlacedDocumentPlanes(document, evaluated.values);
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
      (failed ? errorPoints : points).push({ id: point.id, position: [world.x, world.y, world.z] });
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
  addSketchMarkers(sketchGroup, points, resources.pointGeometry, resources.pointMaterial);
  addSketchMarkers(sketchGroup, errorPoints, resources.pointGeometry, resources.errorPointMaterial);
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
    if (child instanceof THREE.InstancedMesh) child.dispose();
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
  if (modelGroup.userData.presentationMode === "render") {
    selectedBodyId = undefined;
    highlightedBodyIds = [];
  }
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
        selected ? "#f2c14e" : suggested ? "#32cee0" : (child.userData.presentationColor ?? child.userData.baseColor ?? "#8fb7b4"),
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
  fitCameraBounds(camera, controls.target, new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max)));
  controls.update();
}

function selectNoop(_selection: SelectionRef | undefined) {
}
