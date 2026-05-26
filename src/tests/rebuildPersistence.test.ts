import { describe, expect, it } from "vitest";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createMountingPlateTemplate } from "../templates/templates";
import { upsertParameter } from "../cad/document/CadDocument";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { exportMeshesToStl } from "../cad/kernel/stlExport";

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
