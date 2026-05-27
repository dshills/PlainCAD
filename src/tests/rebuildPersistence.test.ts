import { describe, expect, it } from "vitest";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createMountingPlateTemplate } from "../templates/templates";
import { upsertParameter } from "../cad/document/CadDocument";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { exportMeshesToStl } from "../cad/kernel/stlExport";
import { analyzeMountingPlateDocument } from "../templates/mountingPlateAnalysis";
import { MOUNTING_PLATE_SKETCH_NAME } from "../templates/mountingPlateConstants";

describe("rebuild, persistence, and export", () => {
  it("rebuilds mounting plate and changes bounds when width changes", () => {
    let document = createMountingPlateTemplate();
    const first = rebuildDocument(document);
    expect(first.success).toBe(true);
    expect(first.bodies).toHaveLength(1);
    expect(first.meshes[0].positions.length).toBeGreaterThan(0);

    document = upsertParameter(document, {
      ...document.parameters.plate_width,
      expression: "100mm",
    });
    const second = rebuildDocument(document);
    expect(second.success).toBe(true);
    expect(second.meshes[0].bounds.max[0] - second.meshes[0].bounds.min[0]).toBe(100);
  });

  it("keeps mounting plate hole positions and thickness driven by parameters", () => {
    let document = createMountingPlateTemplate();
    document = upsertParameter(document, { ...document.parameters.plate_width, expression: "100mm" });
    document = upsertParameter(document, { ...document.parameters.plate_height, expression: "60mm" });
    document = upsertParameter(document, { ...document.parameters.plate_thickness, expression: "8mm" });
    document = upsertParameter(document, { ...document.parameters.hole_diameter, expression: "6mm" });
    document = upsertParameter(document, { ...document.parameters.hole_offset_x, expression: "12mm" });
    document = upsertParameter(document, { ...document.parameters.hole_offset_y, expression: "9mm" });

    const analysis = analyzeMountingPlateDocument(document);
    expect(analysis.valid).toBe(true);
    expect(analysis.dimensions).toEqual({ width: 100, height: 60, thickness: 8, holeDiameter: 6 });
    expect(analysis.holes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: -38, y: -21, radius: 3 }),
        expect.objectContaining({ x: 38, y: -21, radius: 3 }),
        expect.objectContaining({ x: 38, y: 21, radius: 3 }),
        expect.objectContaining({ x: -38, y: 21, radius: 3 }),
      ]),
    );

    const result = rebuildDocument(document);
    expect(result.success).toBe(true);
    expect(result.meshes[0].bounds.max[2]).toBe(8);
  });

  it("reports invalid mounting plate hole layouts", () => {
    let document = createMountingPlateTemplate();
    document = upsertParameter(document, { ...document.parameters.hole_offset_x, expression: "0mm" });
    const analysis = analyzeMountingPlateDocument(document);
    expect(analysis.valid).toBe(false);
    expect(analysis.errors).toContain("hole_offset_x must keep corner mounting holes inside their left/right half of the plate.");
  });

  it("requires the named mounting plate sketch for workflow analysis", () => {
    const document = createMountingPlateTemplate();
    const sketch = Object.values(document.sketches)[0];
    expect(sketch.name).toBe(MOUNTING_PLATE_SKETCH_NAME);
    const renamed = {
      ...document,
      sketches: {
        [sketch.id]: { ...sketch, name: "Other Sketch" },
      },
    };
    const analysis = analyzeMountingPlateDocument(renamed);
    expect(analysis.valid).toBe(false);
    expect(analysis.errors).toContain("Mounting plate sketch is missing.");
  });

  it("requires all mounting plate workflow parameters", () => {
    const document = createMountingPlateTemplate();
    const { hole_offset_x: _removed, ...parameters } = document.parameters;
    const analysis = analyzeMountingPlateDocument({ ...document, parameters });
    expect(analysis.valid).toBe(false);
    expect(analysis.errors).toContain("Missing or invalid mounting plate parameter hole_offset_x.");
  });

  it("round trips project JSON", () => {
    const document = createMountingPlateTemplate();
    const imported = importProjectText(serializeProject(document));
    expect(imported.name).toBe(document.name);
    expect(rebuildDocument(imported).success).toBe(true);
  });

  it("exports STL smoke output", () => {
    const result = rebuildDocument(createMountingPlateTemplate());
    const stl = new TextDecoder().decode(exportMeshesToStl(result.meshes));
    expect(stl).toContain("solid");
    expect(stl).toContain("facet normal");
  });
});
