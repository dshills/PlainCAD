import type { AiEditContext } from "./plan";

export type RelativeDimensionRequest =
  | { target: string; kind: "scale"; factor: 0.5 | 2 }
  | { target: string; kind: "offset"; direction: 1 | -1; amount: number; unit: "mm" | "deg" | "%" };

/** Whole directives only: explanations, negation and additional instructions
 * never become a local numeric edit by matching an interior phrase. */
export function parseRelativeDimension(prompt: string): RelativeDimensionRequest | undefined {
  const text = prompt.trim().replace(/^(?:please|can you|could you)\s+/i, "")
    .replace(/\s+please[.!?]?$/i, "").replace(/[.!?]$/, "").trim();
  const scale = text.match(/^(halve|double)\s+(?:the\s+)?([A-Za-z_]\w*)$/i);
  if (scale) return { target: scale[2], kind: "scale", factor: scale[1].toLowerCase() === "halve" ? 0.5 : 2 };
  const thick = text.match(/^make\s+(?:it|this|that)\s+(half|twice)\s+as\s+thick$/i);
  if (thick) return { target: "thickness", kind: "scale", factor: thick[1].toLowerCase() === "half" ? 0.5 : 2 };
  const offset = text.match(/^(increase|decrease)\s+(?:the\s+)?([A-Za-z_]\w*)\s+by\s+([+-]?(?:\d+\.?\d*|\.\d+))\s*(mm|deg|%)$/i);
  if (!offset) return undefined;
  return { target: offset[2], kind: "offset", direction: offset[1].toLowerCase() === "increase" ? 1 : -1,
    amount: Number(offset[3]), unit: offset[4].toLowerCase() as "mm" | "deg" | "%" };
}

/** Context values are already resolved in mm/deg by the CAD expression evaluator. */
export function relativeDimensionValue(request: RelativeDimensionRequest, parameter: AiEditContext["parameters"][number]): number {
  if (!Number.isFinite(parameter.value) || Math.abs(parameter.value) > 100000)
    throw new Error(`Resolve a valid current value for ${parameter.name} before changing it.`);
  if (request.kind === "offset") {
    if (!(request.amount > 0) || !Number.isFinite(request.amount))
      throw new Error("Use a positive finite amount with increase or decrease.");
    if (request.unit !== "%" && request.unit !== parameter.unit)
      throw new Error(`Use ${parameter.unit} or % for ${parameter.name}.`);
  }
  const value = request.kind === "scale" ? parameter.value * request.factor
    : parameter.value + request.direction * (request.unit === "%" ? parameter.value * request.amount / 100 : request.amount);
  if (!Number.isFinite(value) || !(value > 0) || value > 100000)
    throw new Error(`${parameter.name} would become ${value}${parameter.unit}. Choose a positive finite value no greater than 100000${parameter.unit}.`);
  if (value === parameter.value)
    throw new Error(`That amount does not change ${parameter.name}. Choose a larger change.`);
  return value;
}
