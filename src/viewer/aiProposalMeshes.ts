import * as THREE from "three";
import { ModelMeshes } from "./modelMeshes";
import type { AiCanvasPreview } from "../state/aiCanvasPreview";
import type { PresentationMode, StudioMaterial } from "../state/viewerState";

/** Independent, unpickable proposal geometry in the existing world frame. */
export class AiProposalMeshes {
  private meshes = new ModelMeshes();
  private result?: AiCanvasPreview["result"];
  readonly group = this.meshes.group;
  update(preview: AiCanvasPreview, mode: PresentationMode, material: StudioMaterial, edges: boolean, hidden: readonly string[], plane?: THREE.Plane) {
    if (this.result !== preview.result) {
      this.meshes.update(preview.result.meshes);
      this.result = preview.result;
    }
    this.meshes.setPresentationMode(mode, material);
    this.meshes.setEdgesVisible(edges);
    const changed = new Set(preview.bodyIds);
    for (const child of this.group.children) {
      if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshStandardMaterial)) continue;
      child.visible = !hidden.includes(child.userData.bodyId);
      child.material.emissive.set(changed.has(child.userData.bodyId) ? "#126878" : "#000000");
      child.material.emissiveIntensity = changed.has(child.userData.bodyId) ? 0.35 : 0;
      child.material.clippingPlanes = plane ? [plane] : null;
      child.traverse((object) => {
        if (object instanceof THREE.LineSegments && object.material instanceof THREE.LineBasicMaterial)
          object.material.clippingPlanes = plane ? [plane] : null;
      });
    }
  }
  inspect() {
    return this.group.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh).map((object) => ({
      bodyId: object.userData.bodyId as string, geometryId: object.geometry.uuid, visible: object.visible,
      positions: Array.from(object.geometry.getAttribute("position").array), indices: Array.from(object.geometry.index?.array ?? []),
    }));
  }
  dispose() { this.meshes.dispose(); this.result = undefined; this.group.removeFromParent(); }
}

export function renderAiProposal(runtime: { aiProposal?: AiProposalMeshes; aiOverlayVisibility?: { sketch: boolean; measurement: boolean; mode: PresentationMode }; modelGroup: THREE.Group; sketchGroup: THREE.Group; measurementGroup: THREE.Group; invalidate(): void }, preview: AiCanvasPreview, mode: "before" | "after", presentation: PresentationMode, material: StudioMaterial, edges: boolean, hidden: readonly string[], plane?: THREE.Plane) {
  runtime.aiOverlayVisibility ??= { sketch: runtime.sketchGroup.visible, measurement: runtime.measurementGroup.visible, mode: presentation };
  const proposal = runtime.aiProposal ??= new AiProposalMeshes();
  proposal.update(preview, presentation, material, edges, hidden, plane);
  if (!proposal.group.parent) runtime.modelGroup.parent?.add(proposal.group);
  proposal.group.visible = mode === "after";
  runtime.modelGroup.visible = mode === "before";
  const saved = runtime.aiOverlayVisibility;
  runtime.sketchGroup.visible = (mode === "after" && Boolean(preview.candidate && !preview.result.meshes.length)) ||
    (mode === "before" && (saved.mode === presentation ? saved.sketch : presentation === "model"));
  runtime.measurementGroup.visible = mode === "before" && (saved.mode === presentation ? saved.measurement : presentation === "model");
  runtime.invalidate();
}
