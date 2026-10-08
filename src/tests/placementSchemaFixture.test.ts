import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { validateDocument } from "../cad/document/validate";
import { rebuildDocument } from "../cad/features/rebuildGraph";

describe("schema 16 real placement fixture", () => {
  it("round trips independent posed component identities and drives changed positioned bounds", () => {
    const text = readFileSync("src/persistence/fixtures/schema-v16.pcaddoc", "utf8"), document = importProjectText(text);
    expect(document.schemaVersion).toBe(16);
    expect(validateDocument(document)).toEqual([]);
    expect(document.features.map(feature => feature.id)).toEqual(["first-solid", "second-solid"]);
    expect(document.components["first-component"].placement).toEqual({ translation: [30, -7, 4], rotation: [0, 0, Math.PI / 2] });
    expect(document.components["second-component"].placement).toEqual({ translation: [7, 11, -3], rotation: [Math.PI / 2, Math.PI / 2, Math.PI / 2] });
    const exported = serializeProject(document), reopened = importProjectText(exported);
    expect(serializeProject(reopened)).toBe(exported);
    const baseline = rebuildDocument(reopened);
    expect(baseline.errors).toEqual([]);
    expect(baseline.meshes.map(mesh => [mesh.bodyId, mesh.bounds])).toEqual([
      ["body:first-solid", { min: [20, -7, 4], max: [30, 13, 9] }],
      ["body:second-solid", { min: [7, 11, -23], max: [12, 21, -3] }],
    ]);
    const edited = rebuildDocument({ ...reopened, parameters: { ...reopened.parameters, width: { ...reopened.parameters.width, expression: "24mm" } } });
    expect(edited.errors).toEqual([]);
    expect(edited.meshes.map(mesh => mesh.bounds)).toEqual([
      { min: [20, -7, 4], max: [30, 17, 9] },
      { min: [7, 11, -27], max: [12, 21, -3] },
    ]);
    expect(reopened.components).toEqual(document.components);
  });
});
