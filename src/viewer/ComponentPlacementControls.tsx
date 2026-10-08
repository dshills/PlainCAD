import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ComponentPlacement } from "../cad/document/schema";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import type { ComponentAlignmentTarget } from "../cad/inspection/componentAlignment";
import { fitCameraBounds } from "./cameraFit";
import { changedPlacementField, componentPlacementMatrix, placementAxis, placementDragAngle, placementDragDistance, placementRotationRing, wrappedRotationDelta, type PlacementAxis, type PlacementMode, type PlacementRing } from "./componentPlacementHandles";
import { useThemeState } from "../state/useThemeState";
import { viewerThemeColors } from "../ui/themes/themes";
import "./ComponentPlacementControls.css";
interface Runtime { group: THREE.Group; camera: THREE.PerspectiveCamera; controls: OrbitControls; render: () => void; fit: () => void }
interface Handle { axis: PlacementAxis; mode: PlacementMode; x: number; y: number; path: string; unavailable: boolean }
interface AlignmentMarker { id: string; label: string; x: number; y: number; selected?: boolean }
const NO_ALIGNMENT_TARGETS: ComponentAlignmentTarget[] = [];
interface Gesture { pointerId: number; axis: PlacementAxis; mode: PlacementMode; original: ComponentPlacement; viewport: DOMRect; camera: THREE.Camera; start: number; last: number; rotation: number; ring: PlacementRing; onChange: (value: ComponentPlacement) => void; onDragging: (value: boolean) => void }
function clear(group: THREE.Group) { group.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => material.dispose()); } }); group.clear(); }
/** Transient display transform during gestures; Apply still requires native proof. */
export function ComponentPlacementControls({ meshes, meshPlacement, placement, bodyIds, disabled, onChange, onDragging, alignmentTargets = NO_ALIGNMENT_TARGETS, selectedAlignmentTargets = NO_ALIGNMENT_TARGETS, alignmentPicking, onAlignmentPick }: {
  meshes: RenderMesh[]; meshPlacement: ComponentPlacement; placement: ComponentPlacement; bodyIds: string[]; disabled: boolean;
  onChange: (placement: ComponentPlacement) => void; onDragging: (dragging: boolean) => void;
  alignmentTargets?: ComponentAlignmentTarget[]; selectedAlignmentTargets?: ComponentAlignmentTarget[]; alignmentPicking?: "source" | "target"; onAlignmentPick?: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null), runtime = useRef<Runtime>(undefined), gesture = useRef<Gesture>(undefined), fittedMeshes = useRef<RenderMesh[] | undefined>(undefined);
  const [handles, setHandles] = useState<Handle[]>([]), [error, setError] = useState("");
  const [alignmentMarkers, setAlignmentMarkers] = useState<AlignmentMarker[]>([]);
  const theme = useThemeState((state) => state.theme);
  const radius = useMemo(() => {
    const selected = meshes.filter((mesh) => bodyIds.includes(mesh.bodyId));
    return Math.max(1, ...selected.flatMap((mesh) => mesh.bounds.max.map((value, axis) => Math.abs(value - mesh.bounds.min[axis]) * 0.35)));
  }, [meshes, bodyIds]);
  const propsRef = useRef({ placement, meshPlacement, bodyIds, radius, alignmentTargets, selectedAlignmentTargets });
  useLayoutEffect(() => { propsRef.current = { placement, meshPlacement, bodyIds, radius, alignmentTargets, selectedAlignmentTargets }; }, [placement, meshPlacement, bodyIds, radius, alignmentTargets, selectedAlignmentTargets]);
  const stop = (cancel: boolean) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = undefined;
    if (runtime.current) runtime.current.controls.enabled = true;
    if (cancel) active.onChange(active.original);
    active.onDragging(false); runtime.current?.render();
  };
  useEffect(() => {
    const element = host.current; if (!element) return;
    fittedMeshes.current = undefined;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError("Placement view is unavailable. Use the exact position and rotation fields."); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group, new THREE.HemisphereLight(0xffffff, 0x345060, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(1, -2, 3); scene.add(light);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000); camera.up.set(0, 0, 1); camera.position.set(2, -2, 2);
    const controls = new OrbitControls(camera, renderer.domElement);
    const render = () => {
      scene.background = new THREE.Color(viewerThemeColors[useThemeState.getState().theme].background);
      renderer.render(scene, camera); camera.updateMatrixWorld();
      const width = element.clientWidth, height = element.clientHeight, rect = element.getBoundingClientRect(), props = propsRef.current;
      const project = (point: THREE.Vector3) => { const p = point.project(camera); return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2, z: p.z }; };
      const origin = new THREE.Vector3(...props.placement.translation), start = project(origin.clone());
      const pickIds = new Set(props.alignmentTargets.map(target => target.id));
      const selectedIds = new Set(props.selectedAlignmentTargets.map(target => target.id));
      const markerTargets = [...props.alignmentTargets, ...props.selectedAlignmentTargets.filter(target => !pickIds.has(target.id))];
      const markers = markerTargets.flatMap(target => {
        const point = target.displayPoint ?? (target.kind === "face" ? undefined : target.point);
        if (!point) return [];
        const p = project(new THREE.Vector3(point.x, point.y, point.z));
        if (p.z < -1 || p.z > 1 || p.x < 12 || p.y < 12 || p.x > width - 12 || p.y > height - 12) return [];
        return [{ id: target.id, label: target.label, x: p.x, y: p.y, selected: selectedIds.has(target.id) }];
      });
      setAlignmentMarkers(previous => previous.length === markers.length && previous.every((marker, i) => marker.id === markers[i].id && marker.x === markers[i].x && marker.y === markers[i].y && marker.label === markers[i].label && marker.selected === markers[i].selected) ? previous : markers);
      const next: Handle[] = [];
      for (const axis of [0, 1, 2] as const) for (const mode of ["translation", "rotation"] as const) {
        const ring = placementRotationRing(props.placement, axis);
        const point = mode === "translation" ? origin.clone().addScaledVector(placementAxis(axis), props.radius * 1.4) : origin.clone().addScaledVector(ring.u, props.radius * Math.cos(Math.PI / 4)).addScaledVector(ring.v, props.radius * Math.sin(Math.PI / 4));
        const screen = project(point);
        if (!gesture.current && (screen.z < -1 || screen.z > 1 || screen.x < 0 || screen.y < 0 || screen.x > width || screen.y > height)) continue;
        const path = mode === "translation" ? `M${start.x},${start.y} L${screen.x},${screen.y}` : Array.from({ length: 49 }, (_, i) => {
          const angle = i / 48 * Math.PI * 2, p = project(origin.clone().addScaledVector(ring.u, props.radius * Math.cos(angle)).addScaledVector(ring.v, props.radius * Math.sin(angle)));
          return `${i ? "L" : "M"}${p.x},${p.y}`;
        }).join(" ");
        const client = { x: rect.left + screen.x, y: rect.top + screen.y };
        const value = mode === "translation" ? placementDragDistance(camera, rect, client, props.placement, axis) : placementDragAngle(camera, rect, client, ring);
        next.push({ axis, mode, x: Math.max(20, Math.min(width - 20, screen.x)), y: Math.max(20, Math.min(height - 20, screen.y)), path, unavailable: value === undefined });
      }
      setHandles((previous) => previous.length === next.length && previous.every((handle, i) => {
        const other = next[i];
        return handle.axis === other.axis && handle.mode === other.mode && handle.x === other.x && handle.y === other.y && handle.path === other.path && handle.unavailable === other.unavailable;
      }) ? previous : next);
    };
    const fit = () => {
      const bounds = new THREE.Box3().setFromObject(group), props = propsRef.current, pivot = new THREE.Vector3(...props.placement.translation);
      bounds.expandByPoint(pivot.clone().addScalar(props.radius * 1.5)); bounds.expandByPoint(pivot.clone().addScalar(-props.radius * 1.5));
      fitCameraBounds(camera, controls.target, bounds); controls.update(); render();
    };
    runtime.current = { group, camera, controls, render, fit }; controls.addEventListener("change", render);
    const resize = () => { stop(true); const width = element.clientWidth, height = element.clientHeight; if (!width || !height) return; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); fit(); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const blur = () => stop(true), escape = (event: KeyboardEvent) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); event.stopPropagation(); stop(true); } };
    window.addEventListener("blur", blur); window.addEventListener("keydown", escape, true);
    return () => { stop(true); fittedMeshes.current = undefined; runtime.current = undefined; observer.disconnect(); controls.dispose(); clear(group); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); window.removeEventListener("blur", blur); window.removeEventListener("keydown", escape, true); };
  }, []);
  useEffect(() => {
    const state = runtime.current; if (!state) return;
    clear(state.group);
    for (const mesh of meshes) {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3)); geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3)); geometry.setIndex(mesh.indices);
      const selected = bodyIds.includes(mesh.bodyId), object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: mesh.assemblyCollision ? "#e96848" : selected ? "#39c8e7" : (mesh.color ?? "#779398"), roughness: 0.65 }));
      object.userData.selected = selected; object.matrixAutoUpdate = false; state.group.add(object);
    }
  }, [meshes, bodyIds]);
  useEffect(() => {
    const state = runtime.current; if (!state) return;
    const delta = componentPlacementMatrix(placement).multiply(componentPlacementMatrix(meshPlacement).invert());
    state.group.children.forEach((object) => { object.matrix.copy(object.userData.selected ? delta : new THREE.Matrix4()); object.matrixWorldNeedsUpdate = true; });
    if (fittedMeshes.current !== meshes && !gesture.current) { fittedMeshes.current = meshes; state.fit(); }
    else state.render();
  }, [placement, meshPlacement, radius, theme, meshes, bodyIds, alignmentTargets, selectedAlignmentTargets]);
  useEffect(() => { if (disabled) stop(true); }, [disabled]);
  useEffect(() => { if (alignmentPicking) stop(true); }, [alignmentPicking]);
  return <div className="component-placement-view">
    <div className="component-placement-frame">
      <div ref={host} className="component-placement-canvas" role="img" aria-label="Component placement geometry preview" />
      <svg aria-hidden="true" className="component-placement-overlay">{handles.map((handle) => <path key={`${handle.mode}:${handle.axis}`} d={handle.path} fill="none" stroke={["#ff8f8f", "#8ce1ae", "#8cbeff"][handle.axis]} strokeWidth={handle.mode === "translation" ? 3 : 1.5} opacity={handle.unavailable ? 0.35 : 0.85} />)}</svg>
      {alignmentMarkers.filter(marker => marker.selected).map(marker => <span key={`selected:${marker.id}`} className="component-alignment-selection" role="img" aria-label={`Selected geometry: ${marker.label}`} title={marker.label} style={{ left: marker.x, top: marker.y }}>✓</span>)}
      {alignmentPicking ? alignmentMarkers.filter(marker => !marker.selected).map(marker => <button key={marker.id} type="button" className="component-alignment-marker" disabled={disabled} aria-label={`Pick ${alignmentPicking}: ${marker.label}`} title={marker.label} style={{ left: marker.x, top: marker.y }} onClick={() => onAlignmentPick?.(marker.id)}>+</button>) : handles.map((handle) => <button key={`${handle.mode}:${handle.axis}`} type="button" className="component-placement-handle" aria-label={`${handle.mode === "translation" ? "Move" : "Rotate"} component ${["X", "Y", "Z"][handle.axis]}`} disabled={disabled || (!gesture.current && handle.unavailable)} title={handle.unavailable ? "Orbit the preview to see this axis before dragging, or use the numeric fields." : "Drag this handle. Arrow keys adjust 1 mm or 1 degree (Shift: 10). Escape restores the drag."} style={{ left: handle.x, top: handle.y, borderColor: ["#ff8f8f", "#8ce1ae", "#8cbeff"][handle.axis] }}
        onPointerDown={(event) => {
          const state = runtime.current; if (disabled || gesture.current || !state || !host.current || event.button !== 0) return;
          const viewport = host.current.getBoundingClientRect(), camera = state.camera.clone(); camera.updateMatrixWorld();
          const ring = placementRotationRing(placement, handle.axis), client = { x: event.clientX, y: event.clientY };
          const start = handle.mode === "translation" ? placementDragDistance(camera, viewport, client, placement, handle.axis) : placementDragAngle(camera, viewport, client, ring);
          if (start === undefined) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); state.controls.enabled = false;
          gesture.current = { pointerId: event.pointerId, axis: handle.axis, mode: handle.mode, original: { translation: [...placement.translation], rotation: [...placement.rotation] }, viewport, camera, ring, start, last: start, rotation: 0, onChange, onDragging }; onDragging(true);
        }}
        onPointerMove={(event) => {
          const active = gesture.current; if (!active || event.pointerId !== active.pointerId) return;
          const client = { x: event.clientX, y: event.clientY }, value = active.mode === "translation" ? placementDragDistance(active.camera, active.viewport, client, active.original, active.axis) : placementDragAngle(active.camera, active.viewport, client, active.ring);
          if (value === undefined) return;
          if (active.mode === "rotation") { active.rotation += wrappedRotationDelta(active.last, value); active.last = value; }
          active.onChange(changedPlacementField(active.original, active.mode, active.axis, active.original[active.mode][active.axis] + (active.mode === "translation" ? value - active.start : active.rotation)));
        }}
        onPointerUp={(event) => { if (gesture.current?.pointerId === event.pointerId) { stop(false); event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => stop(true)} onLostPointerCapture={() => stop(true)}
        onKeyDown={(event) => { if (!disabled && !gesture.current && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); const sign = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : -1; onChange(changedPlacementField(placement, handle.mode, handle.axis, placement[handle.mode][handle.axis] + sign * (event.shiftKey ? 10 : 1) * (handle.mode === "rotation" ? Math.PI / 180 : 1))); } }}
      >{handle.mode === "translation" ? ["X", "Y", "Z"][handle.axis] : `↻${["X", "Y", "Z"][handle.axis]}`}</button>)}
      <button type="button" className="preview-fit" aria-label="Fit component placement" onClick={() => { stop(true); runtime.current?.fit(); }}>Fit placement</button>
    </div>
    <p className="muted">{alignmentPicking ? `Pick ${alignmentPicking === "source" ? "geometry on the moving component" : "where it should meet the other component"}. Visible selections have a checkmark. The lists retain all choices.` : "Drag X/Y/Z to move or a ring to rotate. Apply saves the validated preview. Use Details for exact values."}</p>
    {error ? <p role="status">{error}</p> : null}
  </div>;
}
