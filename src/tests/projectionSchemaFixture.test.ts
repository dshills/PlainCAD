import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { validateDocument } from "../cad/document/validate";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { materializeSketchProjections } from "../cad/sketch/sketchProjection";

describe("schema 15 linked cover fixture", () => {
  it("roundtrips stable link/member/feature IDs and follows source width instead of copied coordinates", () => {
    const fixture = readFileSync("src/persistence/fixtures/schema-v15.pcaddoc", "utf8");
    expect(JSON.parse(fixture).schemaVersion).toBe(15);
    const document = importProjectText(fixture);
    expect(validateDocument(document)).toEqual([]);
    expect(document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const text = serializeProject(document), reopened = importProjectText(text);
    expect(serializeProject(reopened)).toBe(text);
    expect(reopened.features.map((feature) => feature.id)).toEqual(["base", "cover"]);
    expect(reopened.sketches["cover-section"].projections).toEqual(document.sketches["cover-section"].projections);
    const edited = { ...document, parameters: { ...document.parameters, width: { ...document.parameters.width, expression: "42mm" } } };
    const values = evaluateParameters(edited.parameters).values, source = solveSketch(edited.sketches["source-section"], values);
    const projected = materializeSketchProjections(edited, edited.sketches["cover-section"], new Map([[source.id, source]]), new Map([[source.id, detectProfiles(source)]]), values);
    const solved = solveSketch(projected, values);
    expect(solved.errors).toEqual([]);
    expect(Math.max(...Object.values(solved.points).map((point) => point.x))).toBeCloseTo(42, 8);
    expect(Object.keys(projected.entities)).toEqual(Object.keys(document.sketches["cover-section"].entities));
  });
});
