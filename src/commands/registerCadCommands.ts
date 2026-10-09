import { useCadStore } from "../state/useCadStore";
import { CAD_COMMANDS } from "./cadCommands";
import { applyCadCommand } from "./cadCommandOperations";
import { bindCommand, type JsonValue } from "./registry";

/** Register once alongside existing business command enablement. */
export function registerCadCommands(canEdit: (id: string) => boolean): () => void {
  const dispose = CAD_COMMANDS.map(descriptor => bindCommand(descriptor, {
    id: "domain",
    label: () => descriptor.label,
    available: () => canEdit(descriptor.id) ? undefined : "Finish the current task before editing the project.",
    invoke: args => {
      const before = useCadStore.getState().history.present;
      const applied = applyCadCommand(before, { command: descriptor.id, arguments: args[0] as JsonValue });
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
