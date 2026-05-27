import { describe, expect, it } from "vitest";
import { upsertParameter } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { normalizeQuantity } from "../cad/parameters/units";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { addCenterRectangle, addCircleAt, createXySketch } from "../cad/sketch/SketchModel";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { createBoxTemplate, createMountingPlateTemplate } from "../templates/templates";

const BOX_DEFAULT_WIDTH = 80;
const BOX_EDITED_WIDTH = 90;
const IMPORTED_PLATE_HEIGHT = 70;

function timed<T>(operation: () => T) {
  const started = performance.now();
  const value = operation();
  return { value, durationMs: performance.now() - started };
}

describe("release hardening workflows", () => {
  it("records release performance metrics with optional strict budgets", () => {
    const parameters = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => {
        const name = `p${index}`;
        return [
          name,
          {
            id: name,
            name,
            expression: index === 0 ? "1mm" : `p${index - 1} + 1mm`,
            value: 0,
            unit: "mm",
          },
        ];
      }),
    );

    const { value: result, durationMs: parameterEvaluationMs } = timed(() => evaluateParameters(parameters));

    expect(result.errors).toEqual([]);
    expect(result.parameters.p39.value).toBe(40);

    let sketch = addCenterRectangle(createXySketch(), "plate_width", "plate_height");
    for (const [x, y] of [
      ["-hole_offset_x", "-hole_offset_y"],
      ["hole_offset_x", "-hole_offset_y"],
      ["hole_offset_x", "hole_offset_y"],
      ["-hole_offset_x", "hole_offset_y"],
    ] as const) {
      sketch = addCircleAt(sketch, x, y, "hole_diameter / 2");
    }

    const sketchParameters = {
      plate_width: normalizeQuantity(80, "mm"),
      plate_height: normalizeQuantity(50, "mm"),
      hole_offset_x: normalizeQuantity(30, "mm"),
      hole_offset_y: normalizeQuantity(18, "mm"),
      hole_diameter: normalizeQuantity(5, "mm"),
    };
    const { value: solved, durationMs: sketchSolveMs } = timed(() => solveSketch(sketch, sketchParameters));
    const profiles = detectProfiles(solved);

    expect(solved.errors).toEqual([]);
    expect(profiles.errors).toEqual([]);
    expect(profiles.profiles[0].innerLoops).toHaveLength(4);

    const document = createMountingPlateTemplate();
    const { value: rebuildResult, durationMs: mountingPlateRebuildMs } = timed(() => rebuildDocument(document));

    expect(rebuildResult.success).toBe(true);
    expect(rebuildResult.meshes).toHaveLength(1);
    const metrics = { parameterEvaluationMs, sketchSolveMs, mountingPlateRebuildMs };
    expect(metrics).toEqual(
      expect.objectContaining({
        parameterEvaluationMs: expect.any(Number),
        sketchSolveMs: expect.any(Number),
        mountingPlateRebuildMs: expect.any(Number),
      }),
    );
    expect(Object.values(metrics).every((durationMs) => Number.isFinite(durationMs) && durationMs >= 0)).toBe(true);
  });

  it("passes the parametric box edit and rebuild workflow", () => {
    let document = createBoxTemplate();
    let result = rebuildDocument(document);
    expect(result.success).toBe(true);
    expect(result.meshes.length).toBeGreaterThan(0);
    expect(result.meshes[0].bounds.max[0] - result.meshes[0].bounds.min[0]).toBeCloseTo(BOX_DEFAULT_WIDTH, 5);

    document = upsertParameter(document, { ...document.parameters.width, expression: `${BOX_EDITED_WIDTH}mm` });
    result = rebuildDocument(document);

    expect(result.success).toBe(true);
    expect(result.meshes.length).toBeGreaterThan(0);
    expect(result.meshes[0].bounds.max[0] - result.meshes[0].bounds.min[0]).toBeCloseTo(BOX_EDITED_WIDTH, 5);
  });

  it("passes imported mounting plate edit and rebuild workflow", () => {
    let imported = importProjectText(serializeProject(createMountingPlateTemplate()));
    imported = upsertParameter(imported, { ...imported.parameters.plate_height, expression: `${IMPORTED_PLATE_HEIGHT}mm` });
    const result = rebuildDocument(imported);

    expect(result.success).toBe(true);
    expect(result.meshes.length).toBeGreaterThan(0);
    expect(result.meshes[0].bounds.max[1] - result.meshes[0].bounds.min[1]).toBeCloseTo(IMPORTED_PLATE_HEIGHT, 5);
  });
});
