export type Dimension = "length" | "area" | "volume" | "angle" | "scalar";

export interface Quantity {
  value: number;
  unit: string;
  dimension: Dimension;
}

const LENGTH_TO_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

const ANGLE_TO_RAD: Record<string, number> = {
  rad: 1,
  deg: Math.PI / 180,
};

const EPSILON = 1e-10;

export function unitDimension(unit: string): Dimension {
  if (!unit) return "scalar";
  if (unit in LENGTH_TO_MM) return "length";
  if (unit in ANGLE_TO_RAD) return "angle";
  throw new Error(`Unknown unit ${unit}.`);
}

export function normalizeQuantity(value: number, unit: string): Quantity {
  const dimension = unitDimension(unit);
  if (dimension === "length") return { value: value * LENGTH_TO_MM[unit], unit: "mm", dimension };
  if (dimension === "angle") return { value: value * ANGLE_TO_RAD[unit], unit: "rad", dimension };
  return { value, unit: "", dimension };
}

export function assertCompatible(a: Quantity, b: Quantity) {
  if (a.dimension !== b.dimension) {
    throw new Error(`Unit mismatch between ${a.unit || "scalar"} and ${b.unit || "scalar"}.`);
  }
}

export function makeScalar(value: number): Quantity {
  return { value, unit: "", dimension: "scalar" };
}

export function makeAngleRadians(value: number): Quantity {
  return { value, unit: "rad", dimension: "angle" };
}

export function addQuantities(a: Quantity, b: Quantity): Quantity {
  assertCompatible(a, b);
  return { value: a.value + b.value, unit: a.unit, dimension: a.dimension };
}

export function subtractQuantities(a: Quantity, b: Quantity): Quantity {
  assertCompatible(a, b);
  return { value: a.value - b.value, unit: a.unit, dimension: a.dimension };
}

export function multiplyQuantities(a: Quantity, b: Quantity): Quantity {
  if (a.dimension === "scalar") return { value: a.value * b.value, unit: b.unit, dimension: b.dimension };
  if (b.dimension === "scalar") return { value: a.value * b.value, unit: a.unit, dimension: a.dimension };
  if (a.dimension === "length" && b.dimension === "length") return { value: a.value * b.value, unit: "mm^2", dimension: "area" };
  if (
    (a.dimension === "area" && b.dimension === "length") ||
    (a.dimension === "length" && b.dimension === "area")
  ) {
    return { value: a.value * b.value, unit: "mm^3", dimension: "volume" };
  }
  throw new Error(`Cannot multiply ${a.dimension} by ${b.dimension}.`);
}

export function powQuantity(a: Quantity, exponent: Quantity): Quantity {
  if (exponent.dimension !== "scalar") throw new Error("pow exponent must be scalar.");
  if (nearlyEqual(exponent.value, 0)) return makeScalar(1);
  if (nearlyEqual(exponent.value, 1)) return a;
  if (a.dimension === "scalar") return makeScalar(a.value ** exponent.value);
  if (a.dimension === "length" && nearlyEqual(exponent.value, 2)) return { value: a.value ** 2, unit: "mm^2", dimension: "area" };
  if (a.dimension === "length" && nearlyEqual(exponent.value, 3)) return { value: a.value ** 3, unit: "mm^3", dimension: "volume" };
  if (a.dimension === "area" && nearlyEqual(exponent.value, 0.5)) return { value: Math.sqrt(a.value), unit: "mm", dimension: "length" };
  throw new Error(`Unsupported dimensional exponent for ${a.dimension}.`);
}

export function sqrtQuantity(a: Quantity): Quantity {
  const value = a.value < 0 && nearlyEqual(a.value, 0) ? 0 : a.value;
  if (value < 0) throw new Error("sqrt argument must be non-negative.");
  if (a.dimension === "scalar") return makeScalar(Math.sqrt(value));
  if (a.dimension === "area") return { value: Math.sqrt(value), unit: "mm", dimension: "length" };
  throw new Error(`sqrt does not support ${a.dimension}.`);
}

export function absQuantity(a: Quantity): Quantity {
  return { ...a, value: Math.abs(a.value) };
}

export function minQuantity(values: Quantity[]): Quantity {
  if (values.length === 0) throw new Error("min requires at least one argument.");
  return values.reduce((best, value) => (value.value < best.value ? value : best));
}

export function maxQuantity(values: Quantity[]): Quantity {
  if (values.length === 0) throw new Error("max requires at least one argument.");
  return values.reduce((best, value) => (value.value > best.value ? value : best));
}

export function assertAllCompatible(values: Quantity[]) {
  for (let index = 1; index < values.length; index += 1) assertCompatible(values[0], values[index]);
}

export function assertScalar(value: Quantity, label: string) {
  if (value.dimension !== "scalar") throw new Error(`${label} must be scalar.`);
}

export function assertAngle(value: Quantity, label: string) {
  if (value.dimension !== "angle") throw new Error(`${label} must be an angle.`);
}

export function divideQuantities(a: Quantity, b: Quantity): Quantity {
  if (b.value === 0) throw new Error("Division by zero.");
  if (b.dimension === "scalar") return { value: a.value / b.value, unit: a.unit, dimension: a.dimension };
  if (a.dimension === b.dimension) return makeScalar(a.value / b.value);
  if (a.dimension === "area" && b.dimension === "length") return { value: a.value / b.value, unit: "mm", dimension: "length" };
  if (a.dimension === "volume" && b.dimension === "area") return { value: a.value / b.value, unit: "mm", dimension: "length" };
  if (a.dimension === "volume" && b.dimension === "length") return { value: a.value / b.value, unit: "mm^2", dimension: "area" };
  throw new Error(`Cannot divide ${a.dimension} by ${b.dimension}.`);
}

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < EPSILON;
}
