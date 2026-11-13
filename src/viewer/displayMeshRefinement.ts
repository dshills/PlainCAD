import * as THREE from "three";
import type { CadDocument } from "../cad/document/schema";
import type { DisplayMeshRequest } from "../cad/kernel/displayMesh";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { requestDisplayMeshes } from "../cad/worker/displayMeshClient";

interface RefinementFrame {
  document: CadDocument;
  result: RebuildResult;
  session: number;
}

type Surface = THREE.Mesh<THREE.BufferGeometry>;
interface Entry {
  frame: RefinementFrame;
  controller: AbortController;
  pending?: Promise<void>;
  geometries?: Map<string, THREE.BufferGeometry>;
  failed?: boolean;
}

/** Single-revision viewer cache. Draw-time substitution leaves the accepted
 * modeling mesh installed for every raycast and keeps fabrication independent. */
export class DisplayMeshRefinement {
  private entry?: Entry;

  constructor(private readonly current: () => RefinementFrame | undefined, private readonly invalidate: () => void) {}

  private matches(frame: RefinementFrame) {
    const now = this.current();
    return now?.document === frame.document && now.result === frame.result && now.session === frame.session;
  }

  sync() {
    if (this.entry && !this.matches(this.entry.frame)) this.dispose();
  }

  request(frame: RefinementFrame, signal?: AbortSignal): Promise<void> | undefined {
    this.sync();
    if (signal?.aborted || !this.matches(frame)) return;
    if (this.entry) return waitForRefinement(this.entry.pending, signal);

    const bodies: DisplayMeshRequest["bodies"] = frame.result.meshes.flatMap(mesh => {
      const proof = mesh.geometryAssertions;
      return mesh.geometrySource === "opencascade" && proof?.valid && Number.isFinite(proof.volume)
        ? [{ id: mesh.bodyId, bounds: mesh.bounds, volume: proof.volume }] : [];
    });
    if (!bodies.length || bodies.length !== frame.result.meshes.length) return;

    const controller = new AbortController(), entry: Entry = { frame, controller };
    this.entry = entry;
    const abort = () => { if (this.entry === entry) this.dispose(); };
    signal?.addEventListener("abort", abort, { once: true });
    entry.pending = requestDisplayMeshes({ document: frame.document, bodies }, controller.signal).then(meshes => {
      if (this.entry !== entry || controller.signal.aborted || !this.matches(frame)) return;
      if (meshes.length !== bodies.length || meshes.some((mesh, index) => mesh.bodyId !== bodies[index].id))
        throw new Error("Fine detail did not return the current body set.");
      const geometries = new Map<string, THREE.BufferGeometry>();
      try {
        for (const mesh of meshes) {
          const geometry = new THREE.BufferGeometry();
          geometries.set(mesh.bodyId, geometry);
          geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
          geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
          geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
        }
      } catch (error) {
        geometries.forEach(geometry => geometry.dispose());
        throw error;
      }
      entry.geometries = geometries;
    }).catch(() => {
      if (!controller.signal.aborted) entry.failed = true;
    }).finally(() => {
      signal?.removeEventListener("abort", abort);
      entry.pending = undefined;
      if (this.entry === entry && this.matches(frame)) this.invalidate();
    });
    return entry.pending;
  }

  draw(group: THREE.Group, fine: boolean, draw: () => void) {
    const entry = this.entry;
    if (!fine || !entry?.geometries || !this.matches(entry.frame)) { draw(); return; }
    const replaced: Array<[Surface, THREE.BufferGeometry]> = [];
    try {
      for (const object of group.children) {
        if (!(object instanceof THREE.Mesh) || !object.visible) continue;
        const geometry = entry.geometries.get(object.userData.bodyId);
        if (geometry) {
          replaced.push([object, object.geometry]);
          object.geometry = geometry;
        }
      }
      draw();
    } finally {
      for (const [object, geometry] of replaced) object.geometry = geometry;
    }
  }

  inspect() {
    const entry = this.entry;
    if (!entry || !this.matches(entry.frame)) return;
    return {
      status: entry.geometries ? "ready" as const : entry.failed ? "unavailable" as const : "pending" as const,
      triangles: entry.geometries ? [...entry.geometries.values()].reduce((sum, geometry) => sum + (geometry.index?.count ?? 0) / 3, 0) : 0,
    };
  }

  dispose() {
    const entry = this.entry;
    this.entry = undefined;
    entry?.controller.abort();
    entry?.geometries?.forEach(geometry => geometry.dispose());
  }
}

function waitForRefinement(pending: Promise<void> | undefined, signal?: AbortSignal) {
  if (!pending || !signal) return pending;
  return new Promise<void>(resolve => {
    const finish = () => {
      signal.removeEventListener("abort", finish);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    void pending.then(finish);
  });
}
