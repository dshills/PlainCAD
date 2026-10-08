import { create } from "zustand";
import type { CadDocument } from "../../cad/document/schema";
import { useCadStore, type CadStore } from "../../state/useCadStore";

/** Runtime provenance only; normal project history remains authoritative. */
export interface AiHistoryTransaction {
  session: number;
  before: CadDocument;
  after: CadDocument;
  label: string;
}

export const useAiHistory = create<{ transaction?: AiHistoryTransaction }>(() => ({}));

export function recordAiHistoryChange(before: CadDocument, session: number, label: string) {
  const state = useCadStore.getState();
  if (state.documentSession !== session || state.history.present === before ||
      state.history.past.at(-1) !== before) return;
  useAiHistory.setState({ transaction: { session, before, after: state.history.present, label } });
}

export function canUndoAiChange(state: CadStore, transaction = useAiHistory.getState().transaction) {
  return Boolean(transaction && !state.fileBusy && transaction === useAiHistory.getState().transaction &&
    state.documentSession === transaction.session && state.history.present === transaction.after &&
    state.history.past.at(-1) === transaction.before);
}

export function canRedoAiChange(state: CadStore, transaction = useAiHistory.getState().transaction) {
  return Boolean(transaction && !state.fileBusy && transaction === useAiHistory.getState().transaction &&
    state.documentSession === transaction.session && state.history.present === transaction.before &&
    state.history.future[0] === transaction.after);
}

// Opening even the same saved document creates a new session and drops provenance.
const unsubscribe = useCadStore.subscribe((state, previous) => {
  if (state.documentSession !== previous.documentSession)
    useAiHistory.setState({ transaction: undefined });
});

if (import.meta.hot) import.meta.hot.dispose(unsubscribe);
