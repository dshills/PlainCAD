import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";
import { assertStepRoundTrip, STEP_EXPORT_MAX_BYTES, type NativeStepExport } from "../cad/kernel/nativeStep";
import type { CadDocument } from "../cad/document/schema";
export interface StepExportRequest { requestId: number; epoch: number; document: CadDocument; bodyIds: string[] }
export interface StepExportReply { requestId: number; epoch: number; bodyIds: string[]; output: NativeStepExport }
export function assertStepSelection(ids: readonly string[], available?: readonly string[]): void {
  if (!ids.length || ids.length > MODEL_RESOURCE_LIMITS.maxBodies || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !id || id.length > 160)) throw new Error("Choose 1–64 unique current bodies for STEP export.");
  if (available && ids.some(id => !available.includes(id))) throw new Error("A selected STEP body is no longer available. Select export bodies again.");
}
export function assertStepReply(reply: StepExportReply, request: StepExportRequest): void {
  if (!reply || reply.requestId !== request.requestId || reply.epoch !== request.epoch || !Array.isArray(reply.bodyIds) || reply.bodyIds.length !== request.bodyIds.length || reply.bodyIds.some((id, index) => id !== request.bodyIds[index])) throw new Error("STEP worker returned a stale or mismatched result.");
  const output = reply.output;
  if (!output || output.units !== "mm" || !(output.bytes instanceof ArrayBuffer) || !output.bytes.byteLength || output.bytes.byteLength > STEP_EXPORT_MAX_BYTES || !Array.isArray(output.before) || !Array.isArray(output.after) || output.before.length !== request.bodyIds.length || output.after.length !== request.bodyIds.length) throw new Error("STEP worker returned malformed or oversized export data.");
  for (const proof of [...output.before, ...output.after]) {
    if (!proof || proof.valid !== true || !Number.isFinite(proof.volume) || proof.volume <= 0 || !Number.isFinite(proof.surfaceArea) || proof.surfaceArea <= 0 || !Number.isSafeInteger(proof.solidCount) || proof.solidCount <= 0 || !proof.bounds || !Array.isArray(proof.bounds.min) || !Array.isArray(proof.bounds.max) || proof.bounds.min.length !== 3 || proof.bounds.max.length !== 3 || [...proof.bounds.min, ...proof.bounds.max].some(value => !Number.isFinite(value)) || proof.bounds.min.some((value, axis) => value > proof.bounds.max[axis])) throw new Error("STEP worker returned invalid native geometry proofs.");
  }
  assertStepRoundTrip(output.before, output.after);
  const bytes = new Uint8Array(output.bytes), decoder = new TextDecoder();
  const header = decoder.decode(bytes.subarray(0, 32)), footer = decoder.decode(bytes.subarray(Math.max(0, bytes.length - 64)));
  if (!header.startsWith("ISO-10303-21;") || !footer.trimEnd().endsWith("END-ISO-10303-21;")) throw new Error("STEP worker returned malformed STEP content.");
}
