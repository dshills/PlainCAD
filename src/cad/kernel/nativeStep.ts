import { MODEL_RESOURCE_LIMITS } from "../resourceLimits";
import type { BoundingBox, GeometryAssertions } from "./KernelAdapter";
import { withDisposableScope } from "./disposableScope";
import { measureShape } from "./occtGeometry";

export const STEP_EXPORT_MAX_BYTES = 32 * 1024 * 1024;
export interface StepGeometryProof extends GeometryAssertions { bounds: BoundingBox }
export interface NativeStepExport {
  bytes: ArrayBuffer;
  before: StepGeometryProof[];
  after: StepGeometryProof[];
  units: "mm";
}
export function stepBindingDiagnostic(oc: Record<string, any> | undefined): string | undefined {
  if (!oc || typeof oc.STEPControl_Writer_1 !== "function" || typeof oc.STEPControl_Reader_1 !== "function" ||
      typeof oc.STEPControl_Writer?.prototype.Write !== "function" || typeof oc.STEPControl_Reader?.prototype.ReadFile !== "function" ||
      !oc.STEPControl_StepModelType?.STEPControl_AsIs || !oc.IFSelect_ReturnStatus?.IFSelect_RetDone || typeof oc.Bnd_Box_1 !== "function" || typeof oc.BRepBndLib?.AddOptimal !== "function" ||
      !["open", "write", "readFile", "stat", "mkdir", "unlink", "rmdir"].every(method => typeof oc.FS?.[method] === "function"))
    return "STEP export requires native OpenCascade STEP writer, reader and filesystem bindings. They are unavailable in this kernel.";
  return undefined;
}
function geometryProof(oc: Record<string, any>, shape: any): StepGeometryProof {
  const assertions = measureShape(oc, shape);
  return withDisposableScope(scope => {
    const bounds = scope.use(new oc.Bnd_Box_1());
    oc.BRepBndLib.AddOptimal(shape, bounds, false, false);
    const box: BoundingBox = { min: [bounds.GetXmin(), bounds.GetYmin(), bounds.GetZmin()], max: [bounds.GetXmax(), bounds.GetYmax(), bounds.GetZmax()] };
    if ([...box.min, ...box.max].some(value => !Number.isFinite(value)) || box.min.some((value, axis) => value > box.max[axis])) throw new Error("STEP geometry has invalid native bounds.");
    return { ...assertions, bounds: box };
  });
}
export function assertStepRoundTrip(before: StepGeometryProof[], after: StepGeometryProof[]): void {
  if (!before.length || before.length !== after.length) throw new Error("STEP round trip lost or merged an exported body.");
  for (let index = 0; index < before.length; index++) {
    const original = before[index], restored = after[index];
    if (!restored.valid || restored.solidCount !== original.solidCount || !Number.isFinite(restored.volume) || restored.volume <= 0 ||
        Math.abs(restored.volume - original.volume) > Math.max(1e-7, original.volume * 1e-8)) throw new Error(`STEP round trip changed native solid validity, count or exact volume for body ${index + 1}.`);
    for (const side of ["min", "max"] as const) for (let axis = 0; axis < 3; axis++) {
      const expected = original.bounds[side][axis], actual = restored.bounds[side][axis];
      if (!Number.isFinite(actual) || Math.abs(expected - actual) > Math.max(2e-6, Math.abs(expected) * 1e-10)) throw new Error(`STEP round trip changed world coordinates for body ${index + 1}.`);
    }
  }
}
let taskCounter = 0;
const OPEN_ACCESS_MASK = 3, OPEN_WRITE_ONLY = 1, OPEN_CREATE = 64, OPEN_TRUNCATE = 512;
interface StepFileStream { path: string; fd: number; position: number }
/** Installed 1.1.1 routes filename strings incorrectly through std::string.
 * Restrict each synchronous native file call to one explicit task-owned file.
 * This operation is used only inside disposable STEP workers; hooks never cross
 * an await and always restore, including native and filesystem failures. */
function routedNativeFileCall<T>(oc: Record<string, any>, path: string, mode: "read" | "write", call: () => T): T {
  const fs = oc.FS, previousOpen = fs.open, previousWrite = fs.write;
  let opened = 0;
  let writeLimitExceeded = false;
  try {
    fs.open = function (name: unknown, flags: unknown, ...args: unknown[]) {
      if (typeof name !== "string" || name.length > 1024 || typeof flags !== "number" || !Number.isInteger(flags) || ++opened !== 1 ||
          (mode === "read" ? (flags & OPEN_ACCESS_MASK) !== 0 || Boolean(flags & (OPEN_CREATE | OPEN_TRUNCATE)) : (flags & OPEN_ACCESS_MASK) !== OPEN_WRITE_ONLY || !(flags & OPEN_CREATE) || !(flags & OPEN_TRUNCATE)))
        throw new Error("STEP native file access was unexpected. This kernel cannot safely export STEP.");
      return previousOpen.call(this, path, flags, ...args);
    };
    if (mode === "write") fs.write = function (stream: StepFileStream, buffer: unknown, offset: number, length: number, position?: number, ...args: unknown[]) {
      if (stream.path === path) {
        const start = position ?? stream.position;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > STEP_EXPORT_MAX_BYTES) {
          writeLimitExceeded = true; throw new Error("STEP export exceeds the 32 MiB file resource limit.");
        }
      } else if (stream.fd !== 1 && stream.fd !== 2) throw new Error("STEP attempted to write outside its task-owned file.");
      return previousWrite.call(this, stream, buffer, offset, length, position, ...args);
    };
    const result = call();
    if (writeLimitExceeded) throw new Error("STEP export exceeds the 32 MiB file resource limit.");
    if (opened !== 1) throw new Error("STEP writer/reader did not access its task-owned file.");
    return result;
  } finally {
    fs.open = previousOpen;
    fs.write = previousWrite;
  }
}
export function exportNativeStep(oc: Record<string, any>, shapes: readonly any[]): NativeStepExport {
  const unavailable = stepBindingDiagnostic(oc);
  if (unavailable) throw new Error(unavailable);
  if (!shapes.length || shapes.length > MODEL_RESOURCE_LIMITS.maxBodies || new Set(shapes).size !== shapes.length) throw new Error("Choose 1–64 unique native bodies for STEP export.");
  const before = shapes.map(shape => geometryProof(oc, shape));
  const directory = `/plaincad-step-${++taskCounter}`, path = `${directory}/model.step`;
  oc.FS.mkdir(directory);
  try {
    return withDisposableScope(scope => {
      const writer = scope.use(new oc.STEPControl_Writer_1());
      const done = oc.IFSelect_ReturnStatus.IFSelect_RetDone.value;
      for (const shape of shapes) if (writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true).value !== done) throw new Error("Native STEP transfer failed. No file was exported.");
      if (routedNativeFileCall(oc, path, "write", () => writer.Write("model.step")).value !== done) throw new Error("Native STEP writing failed. No file was exported.");
      const size = oc.FS.stat(path).size;
      if (!Number.isSafeInteger(size) || size <= 0 || size > STEP_EXPORT_MAX_BYTES) throw new Error("STEP file is empty or exceeds the 32 MiB file resource limit.");
      const encoded = oc.FS.readFile(path) as Uint8Array;
      if (encoded.byteLength !== size) throw new Error("Native STEP file could not be read completely.");
      const text = new TextDecoder().decode(encoded);
      if (!text.startsWith("ISO-10303-21;") || !text.trimEnd().endsWith("END-ISO-10303-21;") || !/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/.test(text)) throw new Error("Native STEP file is malformed or does not use millimetres.");
      const reader = scope.use(new oc.STEPControl_Reader_1());
      if (routedNativeFileCall(oc, path, "read", () => reader.ReadFile("model.step")).value !== done || reader.NbRootsForTransfer() !== shapes.length || reader.TransferRoots() !== shapes.length || reader.NbShapes() !== shapes.length) throw new Error("Native STEP round trip lost or merged body roots.");
      const after = shapes.map((_shape, index) => geometryProof(oc, scope.use(reader.Shape(index + 1))));
      assertStepRoundTrip(before, after);
      return { bytes: encoded.slice().buffer, before, after, units: "mm" };
    });
  } finally {
    try { oc.FS.unlink(path); } catch { /* A failed writer may not have created a file. */ }
    try { oc.FS.rmdir(directory); } catch { /* Preserve primary errors; the disposable worker releases its filesystem. */ }
  }
}
