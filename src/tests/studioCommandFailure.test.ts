import { afterEach, expect, it, vi } from "vitest";
import { runCommand } from "../ui/commands/commandRegistry";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";

vi.mock("../ui/commands/studioCommand", () => { throw new Error("Optional studio chunk is unavailable."); });
afterEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useViewerState.setState(useViewerState.getInitialState(), true);
  vi.restoreAllMocks();
});
it("keeps the current editable project and reports a failed optional studio command load", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  useCadStore.setState(useCadStore.getInitialState(), true);
  const state = useCadStore.getState();
  useViewerState.getState().openDocument(state.history.present, state.documentSession);
  useViewerState.getState().setPresentationMode(state.documentSession, "render");
  await expect(runCommand("view.studioAppearance", { studio: {
    session: state.documentSession, documentId: state.history.present.id, material: "metal",
  } })).resolves.toBeUndefined();
  expect(useCadStore.getState().history).toBe(state.history);
  expect(useCadStore.getState().documentSession).toBe(state.documentSession);
  expect(useCadStore.getState().fileError).toMatch(/Studio controls could not load/);
  expect(useViewerState.getState().studioMaterial).toBe("original");
});
