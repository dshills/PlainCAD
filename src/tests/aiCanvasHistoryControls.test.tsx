import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { AiCanvasHistoryControls } from "../ui/panels/AiCanvasHistoryControls";
import { useCadStore } from "../state/useCadStore";
import { recordAiHistoryChange, useAiHistory } from "../ui/commands/aiHistoryState";
import { useExtrudeDraft } from "../ui/commands/extrudeCommand";
import { useAiCanvasPreview } from "../state/aiCanvasPreview";

beforeEach(() => {
  useCadStore.setState({ ...useCadStore.getInitialState(), rebuildNow: vi.fn() }, true);
  useAiHistory.setState({ transaction: undefined });
  useExtrudeDraft.setState({ draft: undefined });
  useAiCanvasPreview.setState({ preview: undefined });
});

it("distinguishes the latest project action from the AI action and protects intervening manual edits", () => {
  const state = useCadStore.getState(), before = state.history.present;
  state.updateDocument(document => ({ ...document, name: "AI housing" }));
  recordAiHistoryChange(before, state.documentSession, "Create housing");
  const afterAi = useCadStore.getState().history.present;
  render(<AiCanvasHistoryControls />);
  expect(screen.getByRole("button", { name: "Undo latest AI change" })).toBeEnabled();
  act(() => useCadStore.getState().updateDocument(document => ({ ...document, name: "Manual rename" })));
  expect(screen.getByRole("button", { name: "Undo latest AI change" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Undo last project action" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo last project action" }));
  expect(useCadStore.getState().history.present).toBe(afterAi);
  expect(screen.getByRole("button", { name: "Undo latest AI change" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo latest AI change" }));
  expect(useCadStore.getState().history.present).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Redo latest AI change" }));
  expect(useCadStore.getState().history.present).toBe(afterAi);
  expect(useCadStore.getState().history.past).toHaveLength(1);
});
