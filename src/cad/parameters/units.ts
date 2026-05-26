export type Dimension = "length" | "angle" | "scalar";

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

export function addQuantities(a: Quantity, b: Quantity): Quantity {
  assertCompatible(a, b);
  return { value: a.value + b.value, unit: a.unit, dimension: a.dimension };
}

export function subtractQuantities(a: Quantity, b: Quantity): Quantity {
  assertCompatible(a, b);
  return { value: a.value - b.value, unit: a.unit, dimension: a.dimension };
}

export function multiplyQuantities(a: Quantity, b: Quantity): Quantity {
  if (a.dimension !== "scalar" && b.dimension !== "scalar") {
    throw new Error("Multiplying two unit values is not supported in MVP expressions.");
  }
  if (a.dimension === "scalar") return { value: a.value * b.value, unit: b.unit, dimension: b.dimension };
  return { value: a.value * b.value, unit: a.unit, dimension: a.dimension };
}

export function divideQuantities(a: Quantity, b: Quantity): Quantity {
  if (b.value === 0) throw new Error("Division by zero.");
  if (b.dimension !== "scalar") {
    throw new Error("Dividing by a unit value is not supported in MVP expressions.");
  }
  return { value: a.value / b.value, unit: a.unit, dimension: a.dimension };
}
