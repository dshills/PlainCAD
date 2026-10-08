import * as THREE from "three";
import type { PresentationMode, StudioMaterial } from "../state/viewerState";
import { STUDIO_MATERIALS } from "./studioAppearance";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";

interface RenderedBody {
  source: RenderMesh;
  edges?: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  object: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}
function sameValues(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}
function sameGeometry(a: RenderMesh, b: RenderMesh) {
  return sameValues(a.positions, b.positions) && sameValues(a.normals, b.normals) && sameValues(a.indices, b.indices);
}
function createBody(source: RenderMesh): RenderedBody {
  const geometry = new THREE.BufferGeometry();
  let material: THREE.MeshStandardMaterial | undefined;
  try {
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(source.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(source.normals, 3));
    geometry.setIndex(source.indices);
    material = new THREE.MeshStandardMaterial({ color: source.color ?? "#8fb7b4", roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const object = new THREE.Mesh(geometry, material);
    object.userData.bodyId = source.bodyId;
    object.userData.baseColor = source.color ?? "#8fb7b4";
    object.userData.edgeColor = "#31413c";
    return { source, object };
  } catch (error) {
    geometry.dispose();
    material?.dispose();
    throw error;
  }
}
function disposeBody({ object, edges }: RenderedBody) {
  object.geometry.dispose();
  object.material.dispose();
  edges?.geometry.dispose();
  edges?.material.dispose();
  object.removeFromParent();
}

/** Viewer-owned buffers only. Matching IDs alone never establish matching geometry. */
export class ModelMeshes {
  private bodies = new Map<string, RenderedBody>();
  private mode: PresentationMode = "model";
  private studioMaterial: StudioMaterial = "original";
  readonly group = new THREE.Group();

  update(sources: readonly RenderMesh[]) {
    const next = new Map<string, RenderedBody>();
    const created: RenderedBody[] = [];
    try {
      for (const source of sources) {
        if (next.has(source.bodyId)) throw new Error("Viewer received duplicate body IDs.");
        const previous = this.bodies.get(source.bodyId);
        const body = previous && sameGeometry(previous.source, source) ? previous : createBody(source);
        if (body !== previous) created.push(body);
        next.set(source.bodyId, body);
      }
    } catch (error) {
      created.forEach(disposeBody);
      throw error;
    }
    for (const [id, body] of this.bodies) if (next.get(id) !== body) disposeBody(body);
    for (const source of sources) {
      const body = next.get(source.bodyId)!;
      body.source = source;
      body.object.userData.baseColor = source.color ?? "#8fb7b4";
      body.object.material.color.set(body.object.userData.baseColor);
      this.applyAppearance(body);
      if (body.object.parent !== this.group) this.group.add(body.object);
    }
    // Keep native result ordering for diagnostics and picking without rebuilding buffers.
    const order = new Map(sources.map((source, index) => [source.bodyId, index]));
    this.group.children.sort((a, b) => order.get(a.userData.bodyId)! - order.get(b.userData.bodyId)!);
    this.bodies = next;
  }

  /** Appearance never changes the native mesh buffers or durable geometry. */
  setPresentationMode(mode: PresentationMode, material: StudioMaterial = "original") {
    this.mode = mode;
    this.studioMaterial = material;
    this.group.userData.presentationMode = mode;
    for (const body of this.bodies.values()) this.applyAppearance(body);
  }

  private applyAppearance(body: RenderedBody) {
    const material = body.object.material;
    const appearance = this.mode === "render" ? STUDIO_MATERIALS[this.studioMaterial] : { roughness: 0.55, metalness: 0.05 };
    material.roughness = appearance.roughness;
    material.metalness = appearance.metalness;
    body.object.userData.presentationColor = this.mode === "render" && this.studioMaterial === "metal"
      ? "#bbc4cc" : body.object.userData.baseColor;
    material.color.set(body.object.userData.presentationColor);
    // Interpolate the existing per-face native vertex normals. Keep hard-edge
    // splits, positions and triangulation intact; STL still uses native data.
    material.flatShading = false;
  }

  setEdgesVisible(visible: boolean) {
    let created = false;
    for (const body of this.bodies.values()) {
      const { object } = body;
      if (visible && !body.edges) {
        const geometry = new THREE.EdgesGeometry(object.geometry);
        let material: THREE.LineBasicMaterial | undefined;
        try {
          material = new THREE.LineBasicMaterial({ color: "#31413c" });
          const edges = new THREE.LineSegments(geometry, material);
          edges.userData.edgeOwner = true;
          edges.userData.edgeColor = "#31413c";
          object.add(edges);
          body.edges = edges;
          created = true;
        } catch (error) {
          geometry.dispose();
          material?.dispose();
          throw error;
        }
      }
      if (body.edges) body.edges.visible = visible;
    }
    return created;
  }

  dispose() {
    this.bodies.forEach(disposeBody);
    this.bodies.clear();
  }
}
