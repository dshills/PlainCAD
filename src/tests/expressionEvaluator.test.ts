import { describe, expect, it } from "vitest";
import { evaluateExpression, evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { normalizeQuantity } from "../cad/parameters/units";

describe("expression evaluator", () => {
  it("parses units and arithmetic precedence", () => {
    const result = evaluateExpression("10mm + 2 * 5mm", { parameters: {} });
    expect(result.error).toBeUndefined();
    expect(result.quantity?.value).toBe(20);
    expect(result.quantity?.unit).toBe("mm");
  });

  it("evaluates parameter references", () => {
    const result = evaluateExpression("plate_width - 20mm", {
      parameters: { plate_width: normalizeQuantity(80, "mm") },
    });
    expect(result.quantity?.value).toBe(60);
  });

  it("reports unit mismatch", () => {
    const result = evaluateExpression("10mm + 2deg", { parameters: {} });
    expect(result.error).toContain("Unit mismatch");
  });

  it("reports division by zero", () => {
    const result = evaluateExpression("10mm / 0", { parameters: {} });
    expect(result.error).toContain("Division by zero");
  });

  it("orders dependencies and detects cycles", () => {
    const ok = evaluateParameters({
      a: { id: "a", name: "a", expression: "b + 1mm", value: 0, unit: "mm" },
      b: { id: "b", name: "b", expression: "9mm", value: 0, unit: "mm" },
    });
    expect(ok.parameters.a.value).toBe(10);

    const bad = evaluateParameters({
      a: { id: "a", name: "a", expression: "b + 1mm", value: 0, unit: "mm" },
      b: { id: "b", name: "b", expression: "a + 1mm", value: 0, unit: "mm" },
    });
    expect(bad.errors.some((error) => error.message.includes("Circular"))).toBe(true);
  });
});
