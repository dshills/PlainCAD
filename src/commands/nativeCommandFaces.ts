import { featureComponentId } from "../cad/document/components";
import { faceReferenceBodyId } from "../cad/document/faceReferences";
import type { CadStore } from "../state/useCadStore";

/** Only worker-published faces on current native single-solid bodies are offered. */
export function nativeCommandFaces(state: CadStore) {
  const { history: { present }, rebuild } = state;
  const result = rebuild.result;
  if (rebuild.status !== "succeeded" || !rebuild.kernelReady || !result?.success || result.documentId !== present.id) return [];
  const owners = new Map(present.features.map(feature => [feature.id, feature]));
  const nativeBodies = new Set(result.meshes.filter(mesh => mesh.geometrySource === "opencascade" &&
    mesh.geometryAssertions?.valid && mesh.geometryAssertions.solidCount === 1 && mesh.geometryAssertions.volume > 0).map(mesh => mesh.bodyId));
  return (result.availableFaces ?? []).flatMap(face => {
    const owner = owners.get(face.featureId);
    const bodyId = faceReferenceBodyId(present, { featureId: face.featureId, stableFaceId: face.id });
    return owner && bodyId && (!face.bodyId || face.bodyId === bodyId) && nativeBodies.has(bodyId) ? [{ id: face.id, featureId: face.featureId, bodyId,
      componentId: featureComponentId(present, owner), label: face.label }] : [];
  });
}
