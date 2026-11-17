import { isNativeGeometrySource } from "../cad/kernel/geometrySource";
import type { BoundingBox, RenderMesh } from "../cad/kernel/KernelAdapter";
import type { StepGeometryProof } from "../cad/kernel/nativeStep";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { CadDocument } from "../cad/document/schema";
import { bodyDisplayNames } from "../cad/document/bodyDisplayNames";
import { buildShopDrawing } from "../cad/inspection/shopDrawing";
import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";
import { safeFilename, uniqueFilenames } from "../persistence/filenames";
import { buildStlExport } from "./exportPlan";
import { assertStepReply, assertStepSelection } from "./stepExport";
import { assertStepRoundTrip } from "../cad/kernel/nativeStep";
import { zipFiles, type ExportFile } from "./zip";

export const CONFIGURATION_PACKAGE_MAX_BYTES = 64 * 1024 * 1024;
export const CONFIGURATION_PACKAGE_MAX_MS = 60_000;

export interface ConfigurationPackageRequest {
  requestId: number;
  session: number;
  projectText: string;
  configurationId: string;
  bodyIds: string[];
  drawingBodyId: string;
}

export interface ConfigurationPackageReply {
  requestId: number;
  session: number;
  documentId: string;
  configurationId: string;
  drawingBodyId: string;
  bodyIds: string[];
  proofs: StepGeometryProof[];
  roundTripProofs: StepGeometryProof[];
  /** World-space mesh bounds in the same order as bodyIds. */
  tessellationBounds: BoundingBox[];
  archive: ExportFile;
}

const identifier = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 160;

export function assertConfigurationPackageRequest(request: ConfigurationPackageRequest): void {
  if (!request || !Number.isSafeInteger(request.requestId) || request.requestId < 1 ||
      !Number.isSafeInteger(request.session) || request.session < 0 || typeof request.projectText !== "string" ||
      !identifier(request.configurationId) || !identifier(request.drawingBodyId) || !Array.isArray(request.bodyIds)) {
    throw new Error("Configuration package request is malformed.");
  }
  assertStepSelection(request.bodyIds);
  if (!request.bodyIds.includes(request.drawingBodyId)) throw new Error("Choose a current drawing body from this configuration.");
}

function assertBodyProofs(ids: readonly string[], meshes: readonly RenderMesh[], proofs: readonly StepGeometryProof[]) {
  const byId = new Map(meshes.map(mesh => [mesh.bodyId, mesh]));
  if (meshes.length !== ids.length || byId.size !== ids.length || proofs.length !== ids.length) {
    throw new Error("The fabrication package body set differs from the current native configuration.");
  }
  ids.forEach((id, index) => {
    const mesh = byId.get(id), measured = mesh?.geometryAssertions, proof = proofs[index];
    if (!isNativeGeometrySource(mesh?.geometrySource) || measured?.valid !== true || proof?.valid !== true ||
        !Number.isSafeInteger(proof.solidCount) || proof.solidCount <= 0 || measured.solidCount !== proof.solidCount ||
        !Number.isFinite(proof.volume) || proof.volume <= 0 || !Number.isFinite(measured.volume) || measured.volume <= 0 ||
        Math.abs(measured.volume - proof.volume) > Math.max(1e-7, proof.volume * 1e-8) ||
        !Number.isFinite(proof.surfaceArea) || proof.surfaceArea <= 0 || !Number.isFinite(measured.surfaceArea) || measured.surfaceArea <= 0 ||
        Math.abs(measured.surfaceArea - proof.surfaceArea) > Math.max(1e-7, proof.surfaceArea * 1e-8)) {
      throw new Error(`Fabrication package native geometry differs for body ${id}. Compare the configuration again.`);
    }
  });
  return byId;
}

function matchingTessellationBounds(expected: BoundingBox, actual: BoundingBox | undefined) {
  if (!Array.isArray(actual?.min) || !Array.isArray(actual.max) ||
      actual.min.length !== 3 || actual.max.length !== 3 ||
      actual.min.some((value, axis) => value > actual.max[axis])) return false;
  return (["min", "max"] as const).every(side => [0, 1, 2].every(axis => {
    const value = actual[side][axis];
    const target = expected[side][axis];
    // The same native tessellation is built twice. Allow small numerical
    // variation and floating-point roundoff, not another part placement.
    return Number.isFinite(value) && Number.isFinite(target) &&
      Math.abs(value - target) <= Math.max(2e-6, 16 * Number.EPSILON * Math.abs(target));
  }));
}

/** Check written vertices, or predict float32 loss when STL validation refused the file. */
function assertStlGeometryPrecision(mesh: RenderMesh, label: string, bytes?: ArrayBuffer) {
  const output = bytes && new DataView(bytes), triangleCount = mesh.indices.length / 3;
  if (output && (output.byteLength !== 84 + 50 * triangleCount || output.getUint32(80, true) !== triangleCount))
    throw new Error(`STL for ${label} does not match its source triangles.`);
  // A malformed mesh already has a diagnostic from STL validation.
  if (!Number.isInteger(triangleCount) || triangleCount < 1 ||
      triangleCount > MODEL_RESOURCE_LIMITS.maxTrianglesPerBody ||
      mesh.positions.length / 3 > MODEL_RESOURCE_LIMITS.maxVerticesPerBody) return;
  const sourceMin = [Infinity, Infinity, Infinity], sourceMax = [-Infinity, -Infinity, -Infinity];
  const stlMin = [...sourceMin], stlMax = [...sourceMax], coordinateError = [0, 0, 0];
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      const index = mesh.indices[3 * triangle + vertex] * 3;
      const offset = 96 + 50 * triangle + 12 * vertex;
      for (let axis = 0; axis < 3; axis++) {
        const source = mesh.positions[index + axis];
        if (!Number.isFinite(source)) return;
        const written = output ? output.getFloat32(offset + axis * 4, true) : Math.fround(source);
        sourceMin[axis] = Math.min(sourceMin[axis], source);
        sourceMax[axis] = Math.max(sourceMax[axis], source);
        stlMin[axis] = Math.min(stlMin[axis], written);
        stlMax[axis] = Math.max(stlMax[axis], written);
        coordinateError[axis] = Math.max(coordinateError[axis], Math.abs(written - source));
      }
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    const size = sourceMax[axis] - sourceMin[axis], stlSize = stlMax[axis] - stlMin[axis];
    // Accept at most 0.01% of the source extent, within 0.000001–0.01 mm.
    const tolerance = Math.max(1e-6, Math.min(0.01, size * 1e-4));
    if (!(coordinateError[axis] <= tolerance && Math.abs(stlSize - size) <= tolerance))
      throw new Error(`Binary STL cannot preserve the world coordinates and dimensions of ${label} at its current placement. Move it closer to the origin and compare again, or export STEP instead.`);
  }
}

export function assertConfigurationPackageReply(reply: ConfigurationPackageReply, request: ConfigurationPackageRequest, documentId: string, meshes: readonly RenderMesh[]) {
  if (!reply || reply.requestId !== request.requestId || reply.session !== request.session || reply.documentId !== documentId ||
      reply.configurationId !== request.configurationId || reply.drawingBodyId !== request.drawingBodyId ||
      !Array.isArray(reply.bodyIds) || reply.bodyIds.length !== request.bodyIds.length || reply.bodyIds.some((id, index) => id !== request.bodyIds[index])) {
    throw new Error("The fabrication worker returned a stale or mismatched package.");
  }
  const archive = reply.archive;
  if (!archive || typeof archive.filename !== "string" || !archive.filename.endsWith(".zip") ||
      safeFilename(archive.filename.slice(0, -4), ".zip") !== archive.filename || !(archive.bytes instanceof ArrayBuffer) ||
      archive.bytes.byteLength < 22 || archive.bytes.byteLength > CONFIGURATION_PACKAGE_MAX_BYTES || !Array.isArray(reply.proofs) || !Array.isArray(reply.roundTripProofs)) {
    throw new Error("The fabrication worker returned an invalid or oversized archive.");
  }
  const bytes = new DataView(archive.bytes), end = archive.bytes.byteLength - 22;
  if (bytes.getUint32(0, true) !== 0x04034b50 || bytes.getUint32(end, true) !== 0x06054b50 || bytes.getUint16(end + 10, true) !== request.bodyIds.length + 5) {
    throw new Error("The fabrication worker returned an incomplete ZIP archive.");
  }
  const byId = assertBodyProofs(request.bodyIds, meshes, reply.proofs);
  if (!Array.isArray(reply.tessellationBounds) || reply.tessellationBounds.length !== request.bodyIds.length ||
      request.bodyIds.some((id, index) => !matchingTessellationBounds(byId.get(id)!.bounds, reply.tessellationBounds[index])))
    throw new Error("The fabrication worker returned different body positions or dimensions. Compare the configuration again.");
  assertStepRoundTrip(reply.proofs, reply.roundTripProofs);
}

/** Every geometry artifact comes from the same native rebuild, including exact STEP proof and drawing measurements. */
export function buildConfigurationPackage(
  request: ConfigurationPackageRequest,
  document: CadDocument,
  result: RebuildResult,
  progress: (message: string) => void,
): ConfigurationPackageReply {
  const configuration = document.configurations?.find(item => item.id === request.configurationId);
  const step = result.nativeStepExport;
  if (!configuration || !result.success || result.documentId !== document.id || !step) {
    throw new Error(result.errors.map(error => error.message).join(" ") || "This configuration did not produce a valid native fabrication package.");
  }
  assertStepReply({ requestId: request.requestId, epoch: request.session, bodyIds: request.bodyIds, output: step }, {
    requestId: request.requestId, epoch: request.session, document, bodyIds: request.bodyIds,
  });
  const byId = assertBodyProofs(request.bodyIds, result.meshes, step.before);
  const labels = bodyDisplayNames(document, result.bodies);
  const names = uniqueFilenames(request.bodyIds.map(id => labels[id] ?? id));
  const encode = (value: string) => new TextEncoder().encode(value).buffer;
  const stlFiles: ExportFile[] = [];
  const parts = request.bodyIds.map((bodyId, index) => {
    const mesh = byId.get(bodyId)!, label = labels[bodyId] ?? bodyId;
    progress(`Validating STL for ${label}…`);
    let output: ReturnType<typeof buildStlExport>;
    try {
      output = buildStlExport([mesh], result.bodies.filter(body => body.id === bodyId), document.name, "separate", true, labels);
    } catch (error) {
      // Rounding can also cause degenerate triangles or trigger the volume
      // check. Explain how to recover when the source placement is the cause.
      assertStlGeometryPrecision(mesh, label);
      throw error;
    }
    assertStlGeometryPrecision(mesh, label, output.file.bytes);
    const filename = `stl/${names[index]}`;
    stlFiles.push({ filename, bytes: output.file.bytes });
    return { bodyId, name: label, filename, ...step.before[index], warnings: output.warnings };
  });
  progress("Generating the drawing and parts list…");
  const drawing = buildShopDrawing(document, result, request.drawingBodyId);
  const files: ExportFile[] = [
    { filename: "project.pcaddoc", bytes: encode(request.projectText) },
    { filename: "model.step", bytes: step.bytes },
    { filename: "drawing.svg", bytes: encode(drawing.svg) },
    { filename: "parts-list.csv", bytes: encode(drawing.bomCsv) },
    ...stlFiles,
  ];
  files.push({ filename: "manifest.json", bytes: encode(JSON.stringify({
    version: 1, units: "mm", documentId: document.id,
    configuration: { id: configuration.id, name: configuration.name },
    project: "project.pcaddoc", step: "model.step", partsList: "parts-list.csv",
    drawing: { filename: "drawing.svg", bodyId: drawing.bodyId, sectionHeightMm: drawing.sectionHeight, warnings: drawing.warnings },
    parts,
  }, null, 2)) });
  progress("Preparing the fabrication ZIP…");
  const bytes = zipFiles(files, CONFIGURATION_PACKAGE_MAX_BYTES);
  return {
    requestId: request.requestId, session: request.session, documentId: document.id,
    configurationId: configuration.id, drawingBodyId: drawing.bodyId, bodyIds: [...request.bodyIds], proofs: step.before, roundTripProofs: step.after,
    tessellationBounds: request.bodyIds.map(id => byId.get(id)!.bounds),
    archive: { filename: safeFilename(`${document.name}--${configuration.name}`, ".zip", "-fabrication"), bytes },
  };
}
