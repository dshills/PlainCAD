import { TessellationOptions } from "./KernelAdapter";

export type TessellationLodProfile = "interaction" | "default" | "export";

export interface TessellationCacheKeyInput {
  documentRevision: string | number;
  outputId: string;
  options: TessellationOptions;
  normalMode?: "smooth" | "flat";
  lodProfile?: TessellationLodProfile;
}

export const TESSELLATION_LOD: Record<TessellationLodProfile, TessellationOptions> = {
  interaction: { linearDeflection: 1, angularDeflection: 0.35 },
  default: { linearDeflection: 0.5, angularDeflection: 0.2 },
  export: { linearDeflection: 0.1, angularDeflection: 0.05 },
};

export function tessellationCacheKey(input: TessellationCacheKeyInput): string {
  return [
    input.documentRevision,
    input.outputId,
    roundTolerance(input.options.linearDeflection),
    roundTolerance(input.options.angularDeflection),
    input.normalMode ?? "smooth",
    input.lodProfile ?? "default",
  ].join(":");
}

function roundTolerance(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "invalid";
}
