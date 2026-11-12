import { useCadStore } from "../state/useCadStore";
import { nativeCommandFaces } from "./nativeCommandFaces";
import { CAD_COMMANDS } from "./cadCommands";
import { applyCadCommand } from "./cadCommandOperations";
import { bindCommand, type JsonValue } from "./registry";

function nativePlanReason(id: string) {
  if (id === "cad.feature.pocket") return "Use plan.preview to validate an inward pocket before applying it.";
  if (id === "cad.feature.shell") return "Use plan.preview to validate Shell before applying it.";
}

/** Register once alongside existing business command enablement. */
export function registerCadCommands(canEdit: (id: string) => boolean): () => void {
  const dispose = CAD_COMMANDS.map(descriptor => bindCommand(descriptor, {
    id: "domain",
    label: () => descriptor.label,
    available: () => nativePlanReason(descriptor.id) ?? (
      !canEdit(descriptor.id) ? "Finish the current task before editing the project." :
        descriptor.id === "cad.sketch.createOnFace" && !nativeCommandFaces(useCadStore.getState()).length ? "Wait for a current supported native planar face." : undefined),
    invoke: args => {
      const required = nativePlanReason(descriptor.id);
      if (required) throw new Error(required);
      const state = useCadStore.getState();
      const before = state.history.present;
      const input = args[0] as JsonValue;
      if (descriptor.id === "cad.feature.update" && input && typeof input === "object" && !Array.isArray(input) &&
          before.features.some(feature => feature.type === "shell" && feature.id === input.featureId) &&
          (Object.hasOwn(input, "wallThickness") || Object.hasOwn(input, "opening") || input.suppressed === false))
        throw new Error("Use plan.preview to validate changes to Shell geometry before applying them.");
      const result = state.rebuild.result;
      const native = state.rebuild.status === "succeeded" && state.rebuild.kernelReady && result?.success && result.documentId === before.id ? result : undefined;
      const applied = applyCadCommand(before, { command: descriptor.id, arguments: input }, { native });
      if (descriptor.id === "cad.sketch.createOnFace") {
        const id = applied.result.id;
        const plane = id ? applied.document.sketches[id]?.plane : undefined;
        if (plane?.type !== "face" || !nativeCommandFaces(state).some(face => face.id === plane.stableFaceId && face.featureId === plane.featureId))
          throw new Error("Choose a currently proved native planar face. Wait for the rebuild or refresh the face list.");
      }
      useCadStore.getState().setFileError(undefined);
      useCadStore.getState().updateDocument(current => {
        if (current !== before) throw new Error("Project changed before command commit. Refresh the project and retry.");
        return applied.document;
      });
      const current = useCadStore.getState();
      if (current.fileError) throw new Error(current.fileError);
      if (current.history.present === before && applied.document !== before) throw new Error("CAD command was not committed.");
      return { ...applied.result, aliases: applied.aliases };
    },
  }));
  return () => dispose.forEach(remove => remove());
}
