import type { ComponentAppearance } from "../cad/document/componentAppearance";

export const COMPONENT_FINISHES = {
  steel: { label: "Satin steel", color: "#b9c4cf", roughness: .36, metalness: .92 },
  aluminum: { label: "Blue anodized aluminum", color: "#426991", roughness: .42, metalness: .7 },
  brass: { label: "Brass", color: "#c9a261", roughness: .34, metalness: .87 },
  polymer: { label: "Matte graphite polymer", color: "#343945", roughness: .84, metalness: 0 },
} satisfies Record<ComponentAppearance, { label: string; color: string; roughness: number; metalness: number }>;
