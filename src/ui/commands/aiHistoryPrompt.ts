import { useCadStore } from "../../state/useCadStore";
import { useAiHistory } from "./aiHistoryState";
import { isCommandEnabledForSnapshot, runCommand, selectCommandEnablement } from "./commandRegistry";

export function aiHistoryIntent(prompt: string): "undo" | "redo" | undefined {
  const text = prompt.trim().toLowerCase().replace(/[.!?]+$/, "").trim();
  if (/^(?:please\s+)?undo(?:\s+(?:that|this|the (?:last |latest )?ai change|(?:last |latest )?ai change))?$/.test(text)) return "undo";
  if (/^(?:please\s+)?redo(?:\s+(?:that|this|the (?:last |latest )?ai change|(?:last |latest )?ai change))?$/.test(text)) return "redo";
  return undefined;
}

/** Called before provider consent/request creation. Modeling prompts return undefined. */
export function handleAiHistoryPrompt(prompt: string) {
  const intent = aiHistoryIntent(prompt);
  if (!intent) return undefined;
  const state = useCadStore.getState();
  const transaction = useAiHistory.getState().transaction;
  const commandId = intent === "undo" ? "ai.undoChange" : "ai.redoChange";
  if (!transaction || !isCommandEnabledForSnapshot(commandId, selectCommandEnablement(state))) {
    return { changed: false, message: `The latest AI change cannot be ${intent === "undo" ? "undone" : "redone"} now. Finish the current task or use project Undo/Redo for intervening edits.` };
  }
  runCommand(commandId, { aiHistory: transaction });
  const changed = useCadStore.getState().history.present !== state.history.present;
  return { changed, message: changed
    ? `${intent === "undo" ? "Undid" : "Redid"} AI change: ${transaction.label}.`
    : "Project history changed. Try again from the current project." };
}
