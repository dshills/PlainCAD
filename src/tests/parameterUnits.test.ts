import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  upsertParameter,
  upsertSketch,
} from "../cad/document/CadDocument";
import {
  evaluateExpressionRef,
  evaluateParameters,
} from "../cad/parameters/expressionEvaluator";
import {
  bindDocumentExpressions,
  renameParameter,
} from "../cad/parameters/expressionBindings";
import { formatParameterQuantity } from "../cad/parameters/parameterUnits";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { sketchPlaneTransform } from "../cad/sketch/planes";

describe("authored units and evaluated presentation", () => {
  it("applies defaults after scalar arithmetic and preserves explicit dimensions", () => {
    expect(
      evaluateExpressionRef(
        { expression: "2 * 3", authoredUnit: "in" },
        { parameters: {} },
      ).quantity?.value,
    ).toBeCloseTo(152.4);
    expect(
      evaluateExpressionRef(
        { expression: "2 * width", authoredUnit: "in" },
        {
          parameters: { width: { value: 10, unit: "mm", dimension: "length" } },
        },
      ).quantity?.value,
    ).toBe(20);
    for (const expression of ["10mm / 2mm", "sin(30deg)", "pow(10mm, 0)"]) {
      expect(
        evaluateExpressionRef(
          { expression, authoredUnit: "in" },
          { parameters: {} },
        ).quantity?.dimension,
      ).toBe("scalar");
    }
    expect(
      evaluateExpressionRef(
        { expression: "90", authoredUnit: "deg" },
        { parameters: {} },
      ).quantity?.value,
    ).toBeCloseTo(Math.PI / 2);
    expect(
      evaluateExpressionRef(
        { expression: "10mm", authoredUnit: "in" },
        { parameters: {} },
      ).quantity?.value,
    ).toBe(10);
    expect(
      evaluateExpressionRef(
        { expression: "1", authoredUnit: "" },
        { parameters: {} },
      ).quantity?.dimension,
    ).toBe("scalar");
    expect(
      evaluateExpressionRef({ expression: "10" }, { parameters: {} }).quantity
        ?.dimension,
    ).toBe("scalar");
    expect(
      evaluateExpressionRef(
        { expression: "width + 10", authoredUnit: "in" },
        {
          parameters: { width: { value: 10, unit: "mm", dimension: "length" } },
        },
      ).error,
    ).toContain("Unit mismatch");
  });
  it("recaptures defaults on an edit, retains scalar context, and never changes captured units on rename", () => {
    let before = upsertParameter(createEmptyDocument(), {
      id: "factor",
      name: "factor",
      expression: "2",
      authoredUnit: "",
      unit: "",
      value: 0,
    });
    before = bindDocumentExpressions(before);
    const authored = bindDocumentExpressions(
      upsertSketch(
        { ...before, unitSettings: { length: "in", angle: "rad" } },
        addPoint(createXySketch(), "10 + factor", "1").sketch,
      ),
      before,
    );
    const id = Object.keys(authored.sketches)[0],
      entity = Object.values(authored.sketches[id].entities)[0];
    expect(entity.type === "point" && entity.x.authoredUnit).toBe("in");
    const changedDefaults = {
      ...authored,
      unitSettings: { length: "mm" as const, angle: "deg" as const },
    };
    const renamed = bindDocumentExpressions(
      renameParameter(changedDefaults, "factor", "scale"),
      changedDefaults,
    );
    const renamedEntity = Object.values(renamed.sketches[id].entities)[0];
    expect(renamedEntity.type === "point" && renamedEntity.x).toMatchObject({
      expression: "10 + scale",
      authoredUnit: "in",
    });
    const result = solveSketch(
      renamed.sketches[id],
      evaluateParameters(renamed.parameters).values,
    );
    expect(result.errors).toEqual([]);
    expect(Object.values(result.points)[0].x).toBeCloseTo(304.8);
    const edited = bindDocumentExpressions(
      upsertParameter(renamed, {
        ...renamed.parameters.scale,
        expression: "4",
      }),
      renamed,
    );
    expect(edited.parameters.scale.authoredUnit).toBe("");
    expect(evaluateParameters(edited.parameters).values.scale.dimension).toBe(
      "scalar",
    );
  });
  it("converts presentation and planes without using persisted value caches", () => {
    const quantity = evaluateParameters({
      width: {
        id: "width",
        name: "width",
        expression: "2",
        authoredUnit: "in",
        value: 9999,
        unit: "mm",
      },
    }).values.width;
    expect(
      formatParameterQuantity(quantity, { length: "mm", angle: "deg" }),
    ).toBe("50.8000 mm");
    expect(
      formatParameterQuantity(quantity, { length: "in", angle: "deg" }),
    ).toBe("2.0000 in");
    expect(
      formatParameterQuantity(
        { value: 25.4 ** 3, unit: "mm^3", dimension: "volume" },
        { length: "in", angle: "deg" },
      ),
    ).toBe("1.0000 in³");
    expect(
      formatParameterQuantity(undefined, { length: "mm", angle: "deg" }),
    ).toBe("Unavailable");
    expect(
      sketchPlaneTransform({
        type: "offset",
        base: "YZ",
        offset: { expression: "2", authoredUnit: "in", unit: "mm" },
      }).origin.x,
    ).toBeCloseTo(50.8);
  });
  it("round-trips units/groups and rejects malformed metadata while preserving legacy scalar intent", () => {
    const doc = upsertParameter(createEmptyDocument(), {
      id: "p",
      name: "p",
      expression: "2",
      authoredUnit: "in",
      unit: "mm",
      value: 0,
      group: "Stock",
    });
    expect(importProjectText(serializeProject(doc)).parameters.p).toMatchObject(
      { expression: "2", authoredUnit: "in", group: "Stock" },
    );
    const legacy = {
      ...doc,
      schemaVersion: 9,
      displayUnits: undefined,
      parameters: { p: { ...doc.parameters.p, authoredUnit: undefined } },
    };
    const migrated = importProjectText(JSON.stringify(legacy));
    expect(migrated.displayUnits).toEqual({ length: "mm", angle: "deg" });
    expect(evaluateParameters(migrated.parameters).values.p.dimension).toBe(
      "scalar",
    );
    for (const patch of [
      { authoredUnit: "kg" },
      { group: [] },
      { group: "x".repeat(81) },
    ]) {
      expect(() =>
        importProjectText(
          JSON.stringify({
            ...doc,
            parameters: { p: { ...doc.parameters.p, ...patch } },
          }),
        ),
      ).toThrow(/Malformed parameter fields|authored unit/);
    }
    expect(() =>
      importProjectText(
        JSON.stringify({
          ...doc,
          displayUnits: { length: "bad", angle: "deg" },
        }),
      ),
    ).toThrow(/display units/);
  });
});
