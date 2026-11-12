import { expect, it } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { placedComponentMesh } from "../cad/features/componentPlacement";
import type { BoundingBox, RenderMesh } from "../cad/kernel/KernelAdapter";
import { createBoxMesh } from "../cad/kernel/meshConversion";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { assertConfigurationPackageReply, buildConfigurationPackage, type ConfigurationPackageRequest } from "../fabrication/configurationPackage";
import { buildStlExport } from "../fabrication/exportPlan";

function fixture(mesh: RenderMesh) {
  const document = { ...createEmptyDocument("Fabrication example"), configurations: [{ id: "size", name: "Size", parameters: [] }] };
  const request: ConfigurationPackageRequest = { requestId: 1, session: 2,
    projectText: JSON.stringify(document), configurationId: "size", bodyIds: [mesh.bodyId], drawingBodyId: mesh.bodyId };
  const proof = { ...mesh.geometryAssertions!, bounds: mesh.bounds };
  const encoded = new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;");
  const bytes = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(bytes).set(encoded);
  const result: RebuildResult = { documentId: document.id, success: true,
    bodies: [{ id: mesh.bodyId, name: "Sample box" }], meshes: [mesh], errors: [], warnings: [], durationMs: 0,
    nativeDrawingGeometry: { bounds: mesh.bounds, bores: [], warnings: [] },
    nativeStepExport: { units: "mm", before: [proof], after: [proof], bytes },
  };
  return { request, document, result };
}

function sampleBox() {
  return { ...createBoxMesh("body:sample", 10, 6.4, 8), geometrySource: "opencascade" as const,
    geometryAssertions: { valid: true as const, solidCount: 1, volume: 512, surfaceArea: 390.4 } };
}

it("refuses a watertight STL that preserves volume but changes body dimensions at a distant placement", () => {
  const mesh = placedComponentMesh(sampleBox(), { translation: [99_999_995, 99_999_996.8, 0], rotation: [0, 0, 0] });
  const { request, document, result } = fixture(mesh);
  // Float32 shrinks X from 10 to 8 mm and expands Y from 6.4 to 8 mm.
  // The rounded box remains closed with the original 512 mm³ volume.
  const stl = buildStlExport([mesh], result.bodies, document.name, "separate", true).file.bytes;
  const view = new DataView(stl), x: number[] = [];
  for (let triangle = 0; triangle < view.getUint32(80, true); triangle++)
    for (let vertex = 0; vertex < 3; vertex++) x.push(view.getFloat32(96 + 50 * triangle + 12 * vertex, true));
  expect(mesh.bounds.max[0] - mesh.bounds.min[0]).toBe(10);
  expect(Math.max(...x) - Math.min(...x)).toBe(8);
  expect(() => buildConfigurationPackage(request, document, result, () => {}))
    .toThrow(/Binary STL.*Move it closer to the origin.*export STEP instead/);

  const shiftedXOnly = placedComponentMesh(sampleBox(), { translation: [99_999_995, 0, 0], rotation: [0, 0, 0] });
  const shifted = fixture(shiftedXOnly);
  expect(() => buildStlExport([shiftedXOnly], shifted.result.bodies, document.name, "separate", true))
    .toThrow(/volume disagrees/);
  expect(() => buildConfigurationPackage(shifted.request, shifted.document, shifted.result, () => {}))
    .toThrow(/Binary STL.*Move it closer to the origin.*export STEP instead/);
});

it("checks the ordered worker tessellation bounds against the compared body's placement", () => {
  const mesh = sampleBox(), { request, document, result } = fixture(mesh);
  const ready = buildConfigurationPackage(request, document, result, () => {});
  expect(ready.tessellationBounds).toEqual([mesh.bounds]);
  expect(() => assertConfigurationPackageReply(ready, request, document.id, [mesh])).not.toThrow();

  const shifted = (bounds: BoundingBox): BoundingBox => ({
    min: [bounds.min[0] + 12, bounds.min[1], bounds.min[2]],
    max: [bounds.max[0] + 12, bounds.max[1], bounds.max[2]],
  });
  const displaced = { ...ready,
    proofs: ready.proofs.map(proof => ({ ...proof, bounds: shifted(proof.bounds) })),
    roundTripProofs: ready.roundTripProofs.map(proof => ({ ...proof, bounds: shifted(proof.bounds) })),
    tessellationBounds: ready.tessellationBounds.map(shifted),
  };
  // Exact STEP round trip, counts, area and volume still match.
  expect(displaced.proofs).toEqual(displaced.roundTripProofs);
  expect(displaced.proofs[0].volume).toBe(ready.proofs[0].volume);
  expect(() => assertConfigurationPackageReply(displaced, request, document.id, [mesh]))
    .toThrow(/different body positions or dimensions/);
});
