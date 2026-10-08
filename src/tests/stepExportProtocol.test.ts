import { expect, it } from "vitest";
import { assertStepReply, assertStepSelection, type StepExportReply, type StepExportRequest } from "../fabrication/stepExport";
import { createBoxTemplate } from "../templates/templates";
const request: StepExportRequest = { requestId: 4, epoch: 2, document: createBoxTemplate(), bodyIds: ["current"] };
function bytes(text: string) { const encoded = new TextEncoder().encode(text), buffer = new ArrayBuffer(encoded.length); new Uint8Array(buffer).set(encoded); return buffer; }
function reply(): StepExportReply {
  const proof = { valid: true as const, solidCount: 1, volume: 100, surfaceArea: 60, bounds: { min: [0, 0, 0] as [number, number, number], max: [10, 10, 1] as [number, number, number] } };
  return { requestId: 4, epoch: 2, bodyIds: ["current"], output: { units: "mm", bytes: bytes("ISO-10303-21;\nEND-ISO-10303-21;"), before: [proof], after: [proof] } };
}
it("bounds body selections and rejects missing, duplicated, oversized or stale IDs", () => {
  expect(() => assertStepSelection(["current"], ["current"])).not.toThrow();
  expect(() => assertStepSelection([])).toThrow(/1–64/); expect(() => assertStepSelection(["current", "current"])).toThrow(/unique/);
  expect(() => assertStepSelection(["lost"], ["current"])).toThrow(/no longer available/);
  expect(() => assertStepSelection(Array.from({ length: 65 }, (_, index) => `body${index}`))).toThrow(/1–64/);
});
it("rejects incorrect request IDs, epochs, body lists, malformed bytes and missing native proofs", () => {
  expect(() => assertStepReply(reply(), request)).not.toThrow();
  expect(() => assertStepReply({ ...reply(), requestId: 3 }, request)).toThrow(/stale/);
  expect(() => assertStepReply({ ...reply(), epoch: 1 }, request)).toThrow(/stale/);
  expect(() => assertStepReply({ ...reply(), bodyIds: ["other"] }, request)).toThrow(/mismatched/);
  const invalid = reply(); invalid.output.bytes = bytes("wrong"); expect(() => assertStepReply(invalid, request)).toThrow(/malformed STEP/);
  const missing = reply(); missing.output.after = []; expect(() => assertStepReply(missing, request)).toThrow(/malformed/);
});
it("rejects altered native volume, solid count, bounds and invalid numeric proofs", () => {
  for (const field of ["volume", "solidCount"] as const) {
    const changed = reply(); changed.output.after = [{ ...changed.output.after[0], [field]: changed.output.after[0][field] + 1 }];
    expect(() => assertStepReply(changed, request)).toThrow(/exact volume/);
  }
  const moved = reply(); moved.output.after = [{ ...moved.output.after[0], bounds: { min: [1, 0, 0], max: [11, 10, 1] } }]; expect(() => assertStepReply(moved, request)).toThrow(/world coordinates/);
  const invalid = reply(); invalid.output.before = [{ ...invalid.output.before[0], volume: NaN }]; expect(() => assertStepReply(invalid, request)).toThrow(/invalid native/);
});
