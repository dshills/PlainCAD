import { describe, expect, it } from "vitest";
import { createEmptyDocument, upsertParameter } from "../cad/document/CadDocument";
import { validateDocument } from "../cad/document/validate";

describe("document model", () => {
  it("creates a valid empty document", () => {
    const document = createEmptyDocument("Test");
    expect(document.name).toBe("Test");
    expect(validateDocument(document)).toEqual([]);
  });

  it("validates parameter names", () => {
    const document = upsertParameter(createEmptyDocument(), {
      id: "param_bad",
      name: "1bad",
      expression: "10mm",
      value: 10,
      unit: "mm",
    });
    expect(validateDocument(document)[0].message).toContain("Invalid parameter name");
  });
});
