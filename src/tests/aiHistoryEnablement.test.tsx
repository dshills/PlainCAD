import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useCadStore } from "../state/useCadStore";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { recordAiHistoryChange, useAiHistory } from "../ui/commands/aiHistoryState";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";

function HistoryControls() {
  const enabled = useCommandEnablement();
  return <button disabled={!enabled.undoAiChange}>Undo latest AI change</button>;
}

it("updates shared command availability when AI provenance is recorded or cleared without another CAD edit", () => {
  useCadStore.setState({ ...useCadStore.getInitialState(), rebuildNow: vi.fn() }, true);
  useAiHistory.setState({ transaction: undefined });
  useCadStore.getState().setDocument(createEmptyDocument());
  const state = useCadStore.getState(), before = state.history.present;
  render(<HistoryControls />);
  act(() => state.updateDocument(document => ({ ...document, name: "AI change" })));
  expect(screen.getByRole("button")).toBeDisabled();
  act(() => recordAiHistoryChange(before, state.documentSession, "Create component"));
  expect(screen.getByRole("button")).toBeEnabled();
  act(() => useAiHistory.setState({ transaction: undefined }));
  expect(screen.getByRole("button")).toBeDisabled();
});
