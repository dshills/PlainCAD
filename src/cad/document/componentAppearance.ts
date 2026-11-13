import { touchDocument } from "./CadDocument";
import type { CadDocument } from "./schema";

export const COMPONENT_APPEARANCES = ["steel", "aluminum", "brass", "polymer"] as const;
export type ComponentAppearance = (typeof COMPONENT_APPEARANCES)[number];

export function isComponentAppearance(value: unknown): value is ComponentAppearance {
  return COMPONENT_APPEARANCES.some(appearance => appearance === value);
}

export function withComponentAppearance(document: CadDocument, componentId: string, appearance?: ComponentAppearance): CadDocument {
  if (!Object.hasOwn(document.components, componentId)) throw new Error("Select a current component.");
  if (appearance !== undefined && !isComponentAppearance(appearance)) throw new Error("Choose a supported finish preset.");
  const component = document.components[componentId];
  if (component.appearance === appearance) return document;
  const { appearance: _previous, ...other } = component;
  return touchDocument({
    ...document,
    components: { ...document.components, [componentId]: appearance ? { ...other, appearance } : other },
  });
}
