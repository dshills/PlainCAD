import { describe, expect, it } from "vitest";
import { collectExpressionDependencies, evaluateExpression, evaluateParameters } from "../cad/parameters/expressionEvaluator";
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

  it("evaluates CAD math functions with dimensional rules", () => {
    expect(evaluateExpression("sin(90deg)", { parameters: {} }).quantity?.value).toBeCloseTo(1);
    expect(evaluateExpression("asin(1)", { parameters: {} }).quantity?.unit).toBe("rad");
    expect(evaluateExpression("sqrt(100mm * 100mm)", { parameters: {} }).quantity?.value).toBe(100);
    expect(evaluateExpression("abs(-5mm)", { parameters: {} }).quantity?.value).toBe(5);
    expect(evaluateExpression("min(10mm, 0.5in)", { parameters: {} }).quantity?.value).toBe(10);
    expect(evaluateExpression("max(10mm, 0.5in)", { parameters: {} }).quantity?.value).toBeCloseTo(12.7);
    expect(evaluateExpression("pow(2mm, 3)", { parameters: {} }).quantity?.dimension).toBe("volume");
    expect(evaluateExpression("pow(2mm, 1)", { parameters: {} }).quantity?.dimension).toBe("length");
    expect(evaluateExpression("pow(2mm, 0)", { parameters: {} }).quantity?.dimension).toBe("scalar");
  });

  it("rejects invalid function dimensions and expression limits", () => {
    expect(evaluateExpression("sin(1)", { parameters: {} }).error).toContain("must be an angle");
    expect(evaluateExpression("asin(2)", { parameters: {} }).error).toContain("between -1 and 1");
    expect(evaluateExpression("sqrt(-1)", { parameters: {} }).error).toContain("non-negative");
    expect(evaluateExpression("min(1mm, 1deg)", { parameters: {} }).error).toContain("Unit mismatch");
    expect(evaluateExpression(`${"(".repeat(40)}1${")".repeat(40)}`, { parameters: {} }).error).toContain("depth limit");
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

    const multiHop = evaluateParameters({
      a: { id: "a", name: "a", expression: "b + 1mm", value: 0, unit: "mm" },
      b: { id: "b", name: "b", expression: "c + 1mm", value: 0, unit: "mm" },
      c: { id: "c", name: "c", expression: "a + 1mm", value: 0, unit: "mm" },
    });
    expect(multiHop.errors.some((error) => error.message.includes("Circular"))).toBe(true);
  });

  it("discovers dependencies without tripping over dry-run arithmetic", () => {
    const evaluated = evaluateParameters({
      ratio: { id: "ratio", name: "ratio", expression: "2", value: 0, unit: "" },
      width: { id: "width", name: "width", expression: "100mm / ratio", value: 0, unit: "mm" },
    });

    expect(evaluated.errors).toEqual([]);
    expect(evaluated.parameters.width.value).toBe(50);
  });

  it("collects dependencies without evaluating restricted function domains", () => {
    expect(collectExpressionDependencies("sqrt(offset - 5mm) + sin(angle)")).toEqual(["offset", "angle"]);
    expect(collectExpressionDependencies("mm + 5mm")).toEqual(["mm"]);
  });

  it("reports tokenizer errors during parameter evaluation", () => {
    const evaluated = evaluateParameters({
      bad: { id: "bad", name: "bad", expression: "1 @ 2", value: 0, unit: "" },
    });

    expect(evaluated.errors[0]?.message).toContain("Invalid token");
  });
});
