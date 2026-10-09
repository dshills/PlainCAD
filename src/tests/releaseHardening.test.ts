import { describe, expect, it } from "vitest";
import { upsertParameter } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createBoxTemplate } from "../templates/templates";

const BOX_DEFAULT_WIDTH = 80;
const BOX_EDITED_WIDTH = 90;

describe("release hardening workflows", () => {
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
});
