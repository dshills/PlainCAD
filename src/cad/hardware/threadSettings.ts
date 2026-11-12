import type { ExpressionRef, ThreadFeature } from "../document/schema";
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";
import type { Quantity } from "../parameters/units";
import { fastenerSize } from "./fastenerCatalog";

export const MAX_THREAD_TURNS = 12;

export interface ThreadDimensions {
  /** Radius of the full upstream cylindrical face. */
  radius: number;
  pitch: number;
  length: number;
  offset: number;
  innerRadius: number;
  outerRadius: number;
  innerHalfWidth: number;
  outerHalfWidth: number;
}

export function resolveThreadDimensions(feature: ThreadFeature, parameters: Record<string, Quantity>): ThreadDimensions {
  const size = fastenerSize(feature.size);
  if (!size) throw new Error("Choose a supported metric or Unified inch thread size.");
  const read = (ref: ExpressionRef, label: string) => {
    const result = evaluateExpressionRef(ref, { parameters });
    if (result.error || result.quantity?.dimension !== "length" || !Number.isFinite(result.quantity.value))
      throw new Error(result.error ?? `Thread ${label} requires a length.`);
    return result.quantity.value;
  };
  const length = read(feature.threadLength, "length");
  const offset = read(feature.threadOffset, "offset");
  const scale = size.unit === "in" ? 25.4 : 1;
  const pitch = size.pitch * scale;
  if (length < pitch - 1e-9 || length > MAX_THREAD_TURNS * pitch + 1e-9 || offset < 0)
    throw new Error(`Use a thread length of 1–${MAX_THREAD_TURNS} pitches and a nonnegative offset.`);

  const major = size.diameter * scale / 2;
  const internal = feature.side === "internal";
  const radius = internal ? size.tapDrill * scale / 2 : major;
  const innerRadius = internal ? radius : major - Math.sqrt(3) * 17 / 48 * pitch;
  const outerRadius = major;
  const innerHalfWidth = internal ? pitch / 16 + (outerRadius - innerRadius) / Math.sqrt(3) : pitch / 12;
  const outerHalfWidth = internal ? pitch / 16 : innerHalfWidth + (outerRadius - innerRadius) / Math.sqrt(3);
  return { radius, pitch, length, offset, innerRadius, outerRadius, innerHalfWidth, outerHalfWidth };
}
