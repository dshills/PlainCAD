import type { CadDocument, UnitSettings } from "../document/schema";
import type { Quantity } from "./units";

export const LENGTH_UNITS = ["mm", "cm", "m", "in", "ft"] as const;
export const ANGLE_UNITS = ["deg", "rad"] as const;
export const AUTHORED_UNITS = ["", ...LENGTH_UNITS, ...ANGLE_UNITS] as const;
export function validAuthoredUnit(unit: unknown): boolean {
  return (
    typeof unit === "string" &&
    (AUTHORED_UNITS as readonly string[]).includes(unit)
  );
}
export function validUnitSettings(value: unknown): value is UnitSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as UnitSettings;
  return (
    (LENGTH_UNITS as readonly string[]).includes(v.length) &&
    (ANGLE_UNITS as readonly string[]).includes(v.angle) &&
    (v.mass === undefined || ["g", "kg", "lb"].includes(v.mass))
  );
}
export function displayUnits(document: CadDocument): UnitSettings {
  return document.displayUnits ?? document.unitSettings;
}
const MM_PER_UNIT = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
export function formatParameterQuantity(
  quantity: Quantity | undefined,
  units: UnitSettings,
): string {
  if (!quantity || !Number.isFinite(quantity.value)) return "Unavailable";
  let value = quantity.value,
    suffix = "";
  if (["length", "area", "volume"].includes(quantity.dimension)) {
    const power =
      quantity.dimension === "length"
        ? 1
        : quantity.dimension === "area"
          ? 2
          : 3;
    value /= MM_PER_UNIT[units.length] ** power;
    suffix = `${units.length}${power === 2 ? "²" : power === 3 ? "³" : ""}`;
  } else if (quantity.dimension === "angle") {
    if (units.angle === "deg") value *= 180 / Math.PI;
    suffix = units.angle;
  }
  if (!Number.isFinite(value)) return "Unavailable";
  const rounded = Number(value.toFixed(4));
  return `${(rounded === 0 ? 0 : rounded).toFixed(4)}${suffix ? ` ${suffix}` : ""}`;
}
