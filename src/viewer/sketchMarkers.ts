import * as THREE from "three";

export interface SketchMarker { id: string; position: [number, number, number] }

/** Instance matrices carry the same world-space spheres as the original point meshes. */
export function addSketchMarkers(
  group: THREE.Group,
  markers: readonly SketchMarker[],
  geometry: THREE.BufferGeometry,
  material: THREE.MeshBasicMaterial,
) {
  if (!markers.length) return;
  const batch = new THREE.InstancedMesh(geometry, material, markers.length);
  const matrix = new THREE.Matrix4();
  try {
    markers.forEach((marker, index) => batch.setMatrixAt(index, matrix.makeTranslation(...marker.position)));
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingSphere();
    batch.userData.sketchMarkers = markers;
    group.add(batch);
  } catch (error) {
    batch.dispose();
    throw error;
  }
}

export function inspectSketchMarkers(group: THREE.Group): SketchMarker[] {
  group.updateWorldMatrix(true, true);
  return group.children.flatMap((object) => {
    if (!(object instanceof THREE.InstancedMesh)) return [];
    const markers = object.userData.sketchMarkers as readonly SketchMarker[] | undefined;
    if (!markers) return [];
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    return markers.map((marker, index) => {
      object.getMatrixAt(index, matrix);
      point.setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld);
      return { id: marker.id, position: point.toArray() as [number, number, number] };
    });
  });
}
