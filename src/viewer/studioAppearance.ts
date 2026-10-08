import type { PresentationMode, StudioBackdrop, StudioMaterial } from "../state/viewerState";

/** Display approximations only; no anisotropic brushing texture or CAD material. */
export const STUDIO_MATERIALS = {
  original: { roughness: 0.32, metalness: 0.22 },
  metal: { roughness: 0.48, metalness: 0.65 },
  powder: { roughness: 0.85, metalness: 0 },
} satisfies Record<StudioMaterial, { roughness: number; metalness: number }>;

export function studioBackground(mode: PresentationMode, backdrop: StudioBackdrop, theme: string): string {
  if (mode !== "render" || backdrop === "theme") return theme;
  return { neutral: "#e7e9ed", warm: "#e8dfcf", dark: "#171d29" }[backdrop];
}
