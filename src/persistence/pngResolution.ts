export const PNG_RESOLUTIONS = {
  hd: { width: 1920, height: 1080 },
  uhd: { width: 3840, height: 2160 },
} as const;

export type PngResolution = "viewport" | keyof typeof PNG_RESOLUTIONS;

export function isPngResolution(value: unknown): value is PngResolution {
  return value === "viewport" || value === "hd" || value === "uhd";
}
