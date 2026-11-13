import { readFileSync } from "node:fs";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { applyCadCommand } from "../commands/cadCommandOperations";
import { importProjectText } from "../persistence/projectCodec";
import { serializeProject } from "../persistence/exportProject";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import { exportNativeStep, importNativeStep, STEP_EXPORT_MAX_BYTES, stepBindingDiagnostic, stepImportBindingDiagnostic } from "../cad/kernel/nativeStep";
import { getDisposableScopeMetrics } from "../cad/kernel/disposableScope";
import { createBoxTemplate } from "../templates/templates";
import { clearNativeFeatureCache, rebuildDocument } from "../cad/features/rebuildGraph";
import { addCircleAt, createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { sketchPlaneTransform } from "../cad/sketch/planes";
const runtime = vi.hoisted(() => ({ oc: undefined as Record<string, any> | undefined }));
vi.mock("opencascade.js/dist/opencascade.wasm.js", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const { dirname } = await import("node:path");
  const filename = createRequire(import.meta.url).resolve("opencascade.js/dist/opencascade.wasm.js"), root = dirname(filename);
  const source = readFileSync(filename, "utf8");
  if (!source.includes("export default opencascade;")) throw new Error("Installed OpenCascade module factory is unsupported by the native test harness.");
  const factory = new Function("require", "__dirname", "__filename", source.replace("export default opencascade;", "return opencascade;"))(createRequire(filename), root, filename);
  return { default: async () => {
    runtime.oc = await factory({ wasmBinary: readFileSync(`${root}/opencascade.wasm.wasm`), print: () => undefined, printErr: () => undefined });
    return runtime.oc;
  } };
});
const kernel = new OpenCascadeKernel();
vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });
beforeAll(async () => OpenCascadeKernel.initialize());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); clearNativeFeatureCache(); });
describe("installed native STEP writer/reader geometry and ownership", () => {
  it("reimports curved subtractive solids and separately transferred overlapping placed bodies with exact volumes and world bounds", () => {
    vi.stubGlobal("document", undefined);
    const box = kernel.createBox(20, 10, 10);
    // This fixture needs an authored circle and tests STEP transfer of the cut solid.
    const circle = addCircleAt({ ...createXySketch(), solveMode: "validate" }, "0mm", "0mm", "2mm");
    const solved = solveSketch(circle, {});
    expect(solved.errors).toEqual([]);
    const [profile] = detectProfiles(solved).profiles;
    expect(profile).toBeDefined();
    const tool = kernel.extrudeProfile(profile, 10, sketchPlaneTransform("XY")), cut = kernel.cut(box, tool);
    const posed = kernel.placeShape(cut, { translation: [31, -7, 9], rotation: [0, 0, Math.PI / 2] });
    const overlap = kernel.cloneShape(posed);
    const distinctBox = kernel.createBox(3, 4, 5), distinct = kernel.placeShape(distinctBox, { translation: [-51, 2, -1], rotation: [Math.PI / 2, 0, 0] });
    const fs = runtime.oc!.FS, open = fs.open, write = fs.write, files = fs.readdir("/");
    try {
      const output = kernel.exportStep([posed, overlap, distinct]);
      expect(output.units).toBe("mm"); expect(output.bytes.byteLength).toBeGreaterThan(1000);
      expect(output.before).toHaveLength(3); expect(output.after).toHaveLength(3);
      for (const proof of output.after.slice(0, 2)) {
        expect(proof).toMatchObject({ valid: true, solidCount: 1 });
        expect(proof.volume).toBeCloseTo(2000 - 40 * Math.PI, 6);
        expect(proof.bounds.min[0]).toBeCloseTo(26, 6); expect(proof.bounds.max[0]).toBeCloseTo(36, 6);
        expect(proof.bounds.min[1]).toBeCloseTo(-17, 6); expect(proof.bounds.max[1]).toBeCloseTo(3, 6);
        expect(proof.bounds.min[2]).toBeCloseTo(9, 6); expect(proof.bounds.max[2]).toBeCloseTo(19, 6);
      }
      expect(output.after[2].volume).toBeCloseTo(60, 6);
      output.after[2].bounds.min.forEach((value, index) => expect(value).toBeCloseTo([-52.5, -3, -3][index], 6));
      output.after[2].bounds.max.forEach((value, index) => expect(value).toBeCloseTo([-49.5, 2, 1][index], 6));
      expect(output.after.reduce((sum, proof) => sum + proof.volume, 0)).toBeCloseTo(2 * (2000 - 40 * Math.PI) + 60, 6);
      expect(new TextDecoder().decode(output.bytes)).toMatch(/ISO-10303-21;[\s\S]*END-ISO-10303-21;/);
      expect(fs.open).toBe(open); expect(fs.write).toBe(write); expect(fs.readdir("/")).toEqual(files);
    } finally { [distinct, distinctBox, overlap, posed, cut, tool, box].forEach(shape => kernel.disposeShape(shape)); }
  });
  it("imports one placed native STEP solid and converts model units to millimetres", () => {
    vi.stubGlobal("document", undefined);
    const box = kernel.createBox(20, 10, 4);
    const posed = kernel.placeShape(box, { translation: [31, -7, 9], rotation: [0, 0, Math.PI / 2] });
    const oc = runtime.oc!, open = oc.FS.open, files = oc.FS.readdir("/");
    try {
      const text = new TextDecoder().decode(kernel.exportStep([posed]).bytes);
      const source = text.replace(/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/g, "SI_UNIT($,.METRE.)");
      const restored = importNativeStep(oc, source);
      try {
        expect(restored.proof.solidCount).toBe(1);
        expect(restored.proof.volume).toBeCloseTo(800 * 1000 ** 3, 1);
        expect(restored.proof.bounds.min).toEqual([26000, -17000, 9000]);
        expect(restored.proof.bounds.max).toEqual([36000, 3000, 13000]);
      } finally { restored.shape.delete(); }
      expect(() => importNativeStep(oc, new TextDecoder().decode(kernel.exportStep([box, posed]).bytes))).toThrow(/one STEP root/);
      expect(oc.FS.open).toBe(open);
      expect(oc.FS.readdir("/")).toEqual(files);
    } finally { kernel.disposeShape(posed); kernel.disposeShape(box); }
  });
  it("reports installed STEP reader support for an empty native rebuild and diagnoses missing file bindings", () => {
    const oc = runtime.oc!;
    expect(rebuildDocument(createEmptyDocument())).toMatchObject({ success: true, meshes: [], stepImportAvailable: true });
    const unavailable = stepImportBindingDiagnostic({ ...oc, FS: { ...oc.FS, writeFile: undefined } });
    expect(unavailable).toMatch(/reader and filesystem bindings/);
  });
  it("rebuilds a saved STEP source and cuts the same native body without inventing feature history", () => {
    vi.stubGlobal("document", undefined);
    const source = importProjectText(readFileSync("src/persistence/fixtures/schema-v21.pcaddoc", "utf8"));
    expect(source.sketches).toEqual({});
    const imported = rebuildDocument(source);
    expect(imported.errors).toEqual([]);
    expect(imported.meshes[0]).toMatchObject({ bodyId: "body:imported-bore", kernelOperation: "stepImport", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(imported.meshes[0].geometryAssertions!.volume).toBeCloseTo(2000 - 40 * Math.PI, 6);
    const outline = applyCadCommand(source, { command: "cad.sketch.create", arguments: { name: "New pocket", plane: "XY", offset: "19mm", componentId: "placed-part" } });
    const sketchId = outline.result.id!;
    const profile = applyCadCommand(outline.document, { command: "cad.sketch.rectangle", arguments: { sketchId, width: "2mm", height: "2mm", origin: { x: "27mm", y: "-15mm" } } });
    const cut = applyCadCommand(profile.document, { command: "cad.feature.extrude", arguments: { sketchId, operation: "cut", distance: "4mm", direction: "negative", targetBodyIds: ["body:imported-bore"] } });
    const reopened = importProjectText(serializeProject(cut.document));
    const result = rebuildDocument(reopened, { exportStepBodyIds: ["body:imported-bore"] });
    expect(result.errors).toEqual([]);
    expect(result.meshes[0]).toMatchObject({ bodyId: "body:imported-bore", kernelOperation: "cut" });
    expect(result.nativeStepExport!.after[0].volume).toBeCloseTo(2000 - 40 * Math.PI - 16, 6);
    expect(result.metrics!.shapeDisposalFailures).toBe(0);
  });
  it("rejects native STEP parse/transfer failure with source-linked diagnostics and releases filesystem resources", () => {
    vi.stubGlobal("document", undefined);
    const source = importProjectText(readFileSync("src/persistence/fixtures/schema-v21.pcaddoc", "utf8"));
    const invalid = { ...source, features: source.features.map(feature => ({ ...feature, stepSource: "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=FOO();\nENDSEC;\nEND-ISO-10303-21;" })) };
    const oc = runtime.oc!, open = oc.FS.open, files = oc.FS.readdir("/");
    const result = rebuildDocument(invalid);
    expect(result.success).toBe(false);
    expect(result.meshes).toEqual([]);
    expect(result.errors).toMatchObject([{ source: "feature", sourceId: "imported-bore", message: expect.stringMatching(/STEP/) }]);
    expect(oc.FS.open).toBe(open);
    expect(oc.FS.readdir("/")).toEqual(files);
  });
  it("keeps STEP bytes out of ordinary rebuilds and exports only explicitly selected current bodies before disposal", () => {
    vi.stubGlobal("document", undefined);
    const source = createBoxTemplate(), ordinary = rebuildDocument(source);
    expect(ordinary.stepExportAvailable).toBe(true); expect(ordinary.nativeStepExport).toBeUndefined();
    const output = rebuildDocument(source, { exportStepBodyIds: [ordinary.meshes[0].bodyId] });
    expect(output.success).toBe(true); expect(output.nativeStepExport!.after[0].volume).toBeCloseTo(80000, 6);
    expect(output.metrics!.shapeDisposalAttempts).toBeGreaterThan(0); expect(output.metrics!.shapeDisposalFailures).toBe(0);
    const missing = rebuildDocument(source, { exportStepBodyIds: ["missing"] });
    expect(missing.success).toBe(false); expect(missing.nativeStepExport).toBeUndefined(); expect(missing.errors).toEqual(expect.arrayContaining([expect.objectContaining({ source: "export", message: expect.stringContaining("no longer available") })]));
  });
  it("diagnoses unavailable bindings, fallback shapes, duplicate selection and use outside an isolated worker", () => {
    const native = kernel.createBox(10, 10, 10);
    try {
      expect(() => kernel.exportStep([native])).toThrow(/isolated browser worker/);
      vi.stubGlobal("document", undefined);
      expect(() => kernel.exportStep([{ id: "fallback", kernelHandle: { kind: "box", width: 1, height: 1, depth: 1 } }])).toThrow(/native solids only/);
      expect(() => kernel.exportStep([native, native])).toThrow(/unique native bodies/);
      expect(stepBindingDiagnostic({ ...runtime.oc, STEPControl_Writer_1: undefined })).toMatch(/unavailable/);
    } finally { kernel.disposeShape(native); }
  });
  it("rejects missing native writes and malformed content, restoring FS hooks and disposing export handles on every failure", () => {
    const oc = runtime.oc!, box = new oc.BRepPrimAPI_MakeBox_1(10, 20, 30), shape = box.Shape();
    const files = oc.FS.readdir("/"), open = oc.FS.open, write = oc.FS.write;
    const metrics = getDisposableScopeMetrics();
    try {
      const noWrite = vi.spyOn(oc.STEPControl_Writer.prototype, "Write").mockReturnValue(oc.IFSelect_ReturnStatus.IFSelect_RetDone);
      expect(() => exportNativeStep(oc, [shape])).toThrow(/did not access/); noWrite.mockRestore();
      const originalRead = oc.FS.readFile;
      const badText = vi.spyOn(oc.FS, "readFile").mockImplementation((...args: any[]) => { const data = originalRead.apply(oc.FS, args).slice(); data[0] = 0; return data; });
      expect(() => exportNativeStep(oc, [shape])).toThrow(/malformed/); badText.mockRestore();
      expect(oc.FS.open).toBe(open); expect(oc.FS.write).toBe(write); expect(oc.FS.readdir("/")).toEqual(files);
      const after = getDisposableScopeMetrics(); expect(after.registered - metrics.registered).toBe(after.disposed - metrics.disposed); expect(after.failures - metrics.failures).toBe(0);
    } finally { shape.delete(); box.delete(); }
  });
  it("bounds native writes before allocating oversized files and rejects native reimport volume changes", () => {
    const oc = runtime.oc!, box = new oc.BRepPrimAPI_MakeBox_1(10, 20, 30), shape = box.Shape(), wrong = new oc.BRepPrimAPI_MakeBox_1(1, 1, 1);
    const files = oc.FS.readdir("/"), open = oc.FS.open, write = oc.FS.write;
    try {
      const oversized = vi.spyOn(oc.STEPControl_Writer.prototype, "Write").mockImplementation(() => {
        const stream = oc.FS.open("opaque.step", 33345);
        try { oc.FS.write(stream, new Uint8Array(1), 0, STEP_EXPORT_MAX_BYTES + 1, 0); } finally { oc.FS.close(stream); }
        return oc.IFSelect_ReturnStatus.IFSelect_RetDone;
      });
      expect(() => exportNativeStep(oc, [shape])).toThrow(/32 MiB/); oversized.mockRestore();
      let replacement: any;
      const replaced = vi.spyOn(oc.XSControl_Reader.prototype, "Shape").mockImplementation(() => { replacement = wrong.Shape(); return replacement; });
      expect(() => exportNativeStep(oc, [shape])).toThrow(/exact volume/);
      expect(replacement.isDeleted()).toBe(true); replaced.mockRestore();
      expect(oc.FS.open).toBe(open); expect(oc.FS.write).toBe(write); expect(oc.FS.readdir("/")).toEqual(files);
    } finally { wrong.delete(); shape.delete(); box.delete(); }
  });
});
