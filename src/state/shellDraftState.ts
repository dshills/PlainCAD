import { create } from "zustand";
import { stableBodyIdForFeature } from "../cad/document/ids";
import { isShellSource, rectangularShellDimensions } from "../cad/features/shellFeature";
import { stableFaceId } from "../cad/sketch/planes";
import type { CadStore } from "./useCadStore";
import type { ShellFrame } from "../ui/commands/shellCommand";

export const useShell = create<{ frame?: ShellFrame }>(() => ({}));

export function shellTarget(state: CadStore, edit: boolean) {
  const document = state.history.present, result = state.rebuild.result;
  const selected = state.selection.selectedIds.length === 1 ? state.selection.selectedIds[0] : undefined;
  if (!selected || selected.documentId !== document.id || !state.rebuild.kernelReady ||
      !result?.shellAvailable || result.documentId !== document.id ||
      (state.rebuild.status !== "succeeded" && (state.rebuild.status !== "failed" || !edit))) return;
  if (!edit && !result.success) return;
  const feature = document.features.find(item => selected.kind === "feature" ? item.id === selected.id
    : selected.kind === "body" && stableBodyIdForFeature(item.id) === selected.id);
  const existing = edit && feature?.type === "shell" && !feature.suppressed ? feature : undefined;
  if (edit && !existing) return;
  const source = existing ? document.features.find(item => item.id === existing.sourceFeatureId) : feature;
  if (!isShellSource(source)) return;
  const caps = ["endCap", "startCap"] as const;
  if (existing) return { source, existing, result, openings: [...caps] };
  const mesh = result.meshes.find(item => item.bodyId === stableBodyIdForFeature(source.id));
  if (mesh?.geometrySource !== "opencascade" || mesh.kernelOperation !== "extrusion" ||
      mesh.geometryAssertions?.solidCount !== 1 || !mesh.geometryAssertions.valid) return;
  const profile = result.profiles?.[source.sketchId]?.find(item => item.id === source.profileId || item.alternateIds?.includes(source.profileId));
  if (!profile || !rectangularShellDimensions(profile)) return;
  const openings = caps.filter(cap => result.availableFaces?.some(face => face.id === stableFaceId(source.id, cap)));
  if (openings.length) return { source, existing, result, openings };
}
