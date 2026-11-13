import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { createBoxMesh } from "../cad/kernel/meshConversion";
import type { DisplayMesh } from "../cad/kernel/displayMesh";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { requestDisplayMeshes } from "../cad/worker/displayMeshClient";
import { DisplayMeshRefinement } from "../viewer/displayMeshRefinement";

vi.mock("../cad/worker/displayMeshClient", () => ({ requestDisplayMeshes: vi.fn() }));

it("keeps the pick mesh installed, reuses fine geometry, and disposes replaced revision buffers", async () => {
  const document = createEmptyDocument();
  const mesh = { ...createBoxMesh("box", 2, 3, 4), geometrySource: "opencascade" as const,
    geometryAssertions: { valid: true as const, volume: 24, surfaceArea: 52, solidCount: 1 } };
  const result: RebuildResult = { documentId: document.id, success: true, bodies: [], meshes: [mesh], errors: [], warnings: [], durationMs: 0 };
  let current = { document, result, session: 1 };
  const completed: Array<(value: DisplayMesh[]) => void> = [], signals: AbortSignal[] = [];
  vi.mocked(requestDisplayMeshes).mockImplementation((_request, signal) =>
    new Promise(resolve => { completed.push(resolve); signals.push(signal); }));
  const invalidate = vi.fn(), refinement = new DisplayMeshRefinement(() => current, invalidate);
  const original = new THREE.BufferGeometry(), model = new THREE.Mesh(original);
  const group = new THREE.Group();
  group.add(model);
  model.userData.bodyId = mesh.bodyId;
  const detail: DisplayMesh = { bodyId: mesh.bodyId, positions: new Float32Array(mesh.positions), normals: new Float32Array(mesh.normals), indices: new Uint32Array(mesh.indices) };

  const old = refinement.request(current);
  current = { ...current, session: 2 };
  const fresh = refinement.request(current);
  expect(signals[0].aborted).toBe(true);
  completed[0]([detail]);
  await old;
  expect(refinement.inspect()?.status).toBe("pending");
  expect(invalidate).not.toHaveBeenCalled();

  expect(refinement.request(current)).toBe(fresh);
  const cancellation = new AbortController();
  const waiting = refinement.request(current, cancellation.signal);
  cancellation.abort();
  await waiting;
  expect(signals[1].aborted).toBe(false);
  completed[1]([detail]);
  await fresh;
  expect(refinement.inspect()).toEqual({ status: "ready", triangles: mesh.indices.length / 3 });
  expect(invalidate).toHaveBeenCalledOnce();
  expect(requestDisplayMeshes).toHaveBeenCalledTimes(2);
  const dispose = vi.fn();
  expect(() => refinement.draw(group, true, () => {
    expect(model.geometry).not.toBe(original);
    model.geometry.addEventListener("dispose", dispose);
    throw new Error("Draw interrupted");
  })).toThrow("Draw interrupted");
  expect(model.geometry).toBe(original);
  refinement.draw(group, false, () => expect(model.geometry).toBe(original));
  current = { ...current, document: { ...document } };
  refinement.sync();
  expect(dispose).toHaveBeenCalledOnce();
  expect(refinement.inspect()).toBeUndefined();
  original.dispose();
});
