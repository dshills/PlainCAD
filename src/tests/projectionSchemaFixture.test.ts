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

describe("schema 17 placed projection fixture", () => {
  it("round trips schema 17 differently placed world links with local coordinates and analytic profile identity", () => {
  const text = readFileSync("src/persistence/fixtures/schema-v17.pcaddoc", "utf8"), document = importProjectText(text);
  expect(JSON.parse(text).schemaVersion).toBe(17); expect(document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(validateDocument(document)).toEqual([]); expect(serializeProject(importProjectText(serializeProject(document)))).toBe(serializeProject(document));
  expect(document.sketches["cover-section"].projections![0].coordinateSpace).toBe("world");
  const values = evaluateParameters(document.parameters).values, source = solveSketch(document.sketches["source-section"], values);
  const sketch = materializeSketchProjections(document, document.sketches["cover-section"], new Map([[source.id, source]]), new Map([[source.id, detectProfiles(source)]]), values);
  const solved = solveSketch(sketch, values), points = Object.values(solved.points);
  // Persisted copies deliberately remain stale: links, solved sources and poses
  // must regenerate them rather than trusting saved point values.
  expect(document.sketches["cover-section"].entities["cover-p0"]).toMatchObject({ type: "point", x: { expression: "0mm" } });
  expect(solved.points["cover-p0"]).toMatchObject({ x: 45, y: 13 });
  expect(solved.errors).toEqual([]); expect(detectProfiles(solved).profiles[0].alternateIds).toContain("cover-section:profile:rectangle");
  expect(Math.min(...points.map(p => p.x))).toBeCloseTo(25, 8); expect(Math.max(...points.map(p => p.x))).toBeCloseTo(45, 8);
  expect(Math.min(...points.map(p => p.y))).toBeCloseTo(13, 8); expect(Math.max(...points.map(p => p.y))).toBeCloseTo(43, 8);
});
});
