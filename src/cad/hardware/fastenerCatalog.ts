export type HolePresetKind = "clearance" | "tapDrill";
export interface HolePreset {
  size: string;
  kind: HolePresetKind;
}

interface FastenerSize {
  id: string;
  label: string;
  unit: "mm" | "in";
  diameter: number;
  pitch: number;
  clearance: number;
  tapDrill: number;
  head: readonly [diameter: number, height: number, socketAcrossFlats: number, socketDepth: number];
}

// Selected ISO metric coarse and Unified inch sizes. Inch pitch is one over TPI.
// Metric clearance uses ISO 273 medium. Inch clearance and socket dimensions
// use the normal fit and nominal envelope in the Unbrako engineering guide.
function metric(diameter: number, pitch: number, clearance: number, tapDrill: number, head: FastenerSize["head"]): FastenerSize {
  return { id: `m${diameter}`, label: `M${diameter} × ${pitch}`, unit: "mm", diameter, pitch, clearance, tapDrill, head };
}
function inch(id: string, size: string, diameter: number, tpi: number, series: "UNC" | "UNF", clearance: number, tapDrill: number, head: FastenerSize["head"]): FastenerSize {
  return { id, label: `${size}-${tpi} ${series}`, unit: "in", diameter, pitch: 1 / tpi, clearance, tapDrill, head };
}
export const FASTENER_SIZES: readonly FastenerSize[] = [
  metric(2, .4, 2.4, 1.6, [3.8, 2, 1.5, 1]),
  metric(2.5, .45, 2.9, 2.05, [4.5, 2.5, 2, 1.25]),
  metric(3, .5, 3.4, 2.5, [5.5, 3, 2.5, 1.5]),
  metric(4, .7, 4.5, 3.3, [7, 4, 3, 2]),
  metric(5, .8, 5.5, 4.2, [8.5, 5, 4, 2.5]),
  metric(6, 1, 6.6, 5, [10, 6, 5, 3]),
  metric(8, 1.25, 9, 6.8, [13, 8, 6, 4]),
  metric(10, 1.5, 11, 8.5, [16, 10, 8, 5]),
  inch("4-40", "#4", .112, 40, "UNC", .136, .089, [.183, .112, .09375, .051]),
  inch("6-32", "#6", .138, 32, "UNC", .1695, .1065, [.226, .138, .109375, .064]),
  inch("8-32", "#8", .164, 32, "UNC", .1935, .136, [.27, .164, .140625, .077]),
  inch("10-24", "#10", .19, 24, "UNC", .221, .1495, [.312, .19, .15625, .09]),
  inch("10-32", "#10", .19, 32, "UNF", .221, .159, [.312, .19, .15625, .09]),
  inch("1/4-20", "1/4", .25, 20, "UNC", .28125, .201, [.375, .25, .1875, .12]),
  inch("1/4-28", "1/4", .25, 28, "UNF", .28125, .213, [.375, .25, .1875, .12]),
  inch("5/16-18", "5/16", .3125, 18, "UNC", .34375, .257, [.469, .3125, .25, .151]),
];

export function fastenerSize(id: unknown) {
  return FASTENER_SIZES.find(size => size.id === id);
}

export function isHolePreset(value: unknown): value is HolePreset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const preset = value as Partial<HolePreset>;
  return Object.keys(value).length === 2 && Boolean(fastenerSize(preset.size)) &&
    (preset.kind === "clearance" || preset.kind === "tapDrill");
}

export function holePresetDiameter(preset: HolePreset) {
  const size = fastenerSize(preset.size);
  if (!size || !isHolePreset(preset)) throw new Error("Choose a supported fastener hole preset.");
  return `${size[preset.kind]}${size.unit}`;
}

export function holePresetLabel(preset: HolePreset) {
  const size = fastenerSize(preset.size)!;
  return `${size.label} ${preset.kind === "clearance" ? "clearance" : "tap drill"}`;
}
