import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { STEP_IMPORT_MAX_BYTES, stepSourceDiagnostic } from "../cad/document/stepImportSource";
import { importProjectText } from "../persistence/projectCodec";
import { serializeProject } from "../persistence/exportProject";

const fixture = (version: number) => readFileSync(`src/persistence/fixtures/schema-v${version}.pcaddoc`, "utf8");

describe("portable STEP source storage", () => {
  it("opens the schema 20 project without changing configurations and keeps the schema 21 import portable", () => {
    const previous = JSON.parse(fixture(20));
    const migrated = importProjectText(fixture(20));
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.configurations?.map(item => item.id)).toEqual(previous.configurations.map((item: { id: string }) => item.id));
    const imported = importProjectText(fixture(21));
    const feature = imported.features[0];
    expect(feature.type).toBe("stepImport");
    expect(importProjectText(serializeProject(imported))).toEqual(imported);
    expect(serializeProject(imported)).not.toMatch(/kernelHandle|geometryAssertions|nativeStepExport/);
  });
  it("rejects over-budget embedded STEP data and malformed source fields before rebuilding", () => {
    const parsed = JSON.parse(fixture(21));
    const original = parsed.features[0];
    expect(stepSourceDiagnostic(original.stepSource.replace("#1 =", "\u0000#1 ="))).toContain("plain-text");
    const oversized = original.stepSource + " ".repeat(STEP_IMPORT_MAX_BYTES);
    expect(() => importProjectText(JSON.stringify({ ...parsed, features: [{ ...original, stepSource: oversized }] }))).toThrow(/512 KiB/);
    expect(() => importProjectText(JSON.stringify({ ...parsed, features: [{ ...original, stepSource: { uri: "file:///other.step" } }] }))).toThrow(/STEP source is empty or missing/);
    const padded = original.stepSource.padEnd(STEP_IMPORT_MAX_BYTES, " ");
    expect(() => importProjectText(JSON.stringify({ ...parsed, features: Array.from({ length: 5 }, (_, index) => ({
      ...original, id: `imported-${index}`, timelineStep: index + 1, stepSource: padded,
    })) }))).toThrow(/2 MiB total embedded STEP source limit/);
  });
});
