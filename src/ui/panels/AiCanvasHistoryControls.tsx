import { useAiHistory } from "../commands/aiHistoryState";
import { runCommand } from "../commands/commandRegistry";
import { useCommandEnablement } from "../commands/useCommandEnablement";

/** Project history and the guarded AI affordance have deliberately distinct labels. */
export function AiCanvasHistoryControls() {
  const availability = useCommandEnablement();
  const transaction = useAiHistory(state => state.transaction);
  return (
    <div className="ai-canvas-history" role="group" aria-label="Canvas project history">
      <button type="button" disabled={!availability.undo} onClick={() => runCommand("history.undo")}>Undo last project action</button>
      <button type="button" disabled={!availability.redo} onClick={() => runCommand("history.redo")}>Redo last project action</button>
      {transaction && <>
        <button type="button" disabled={!availability.undoAiChange} onClick={() => runCommand("ai.undoChange", { aiHistory: transaction })}>Undo latest AI change</button>
        <button type="button" disabled={!availability.redoAiChange} onClick={() => runCommand("ai.redoChange", { aiHistory: transaction })}>Redo latest AI change</button>
      </>}
    </div>
  );
}
