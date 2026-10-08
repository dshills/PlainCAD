import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { useCadStore } from "../state/useCadStore";
import { useWorkbenchState } from "../state/useWorkbenchState";
import { useWorkspaceState } from "../state/useWorkspaceState";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import * as registry from "../ui/commands/commandRegistry";

vi.mock("../viewer/CadViewer", () => ({ CadViewer: () => <div data-testid="cad-viewer" /> }));
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [] }) }));
  useAiDrawer.setState({ open: false, namedPart: undefined });
  useSketchCanvas.setState({ active: undefined });
  useWorkbenchState.setState({ bottomOpen: false, bottomTab: "history" });
  useWorkspaceState.setState({ layout: "workbench", pins: [], sheet: undefined, activePanel: "auto" });
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.getState().setDocument(createEmptyDocument());
  await waitFor(() => expect(useCadStore.getState().rebuild.status).toBe("succeeded"));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["workbench", "focused", "full"] as const)("opens AI inside the %s canvas and retains its draft without document edits", async layout => {
  useWorkspaceState.setState({ layout });
  render(<App />);
  const before = useCadStore.getState();
  expect(screen.queryByLabelText("What would you like to make?")).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Open AI assistant" }));
  const prompt = await screen.findByLabelText("What would you like to make?");
  expect(prompt.closest(".viewer-region")).toBeInTheDocument();
  expect(prompt).toHaveFocus();
  fireEvent.change(prompt, { target: { value: "A wall mounting bracket" } });
  fireEvent.click(screen.getByRole("button", { name: "Close AI assistant" }));
  expect(prompt).not.toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Open AI assistant" })).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Open AI assistant" }));
  expect(screen.getByLabelText("What would you like to make?")).toHaveValue("A wall mounting bracket");
  expect(useCadStore.getState().history).toBe(before.history);
  expect(useCadStore.getState().rebuild).toBe(before.rebuild);
  expect(useWorkbenchState.getState().bottomOpen).toBe(false);
});

it("uses the bottom AI control as a launcher while keeping History open", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  const dock = useWorkbenchState.getState();
  fireEvent.click(screen.getByRole("button", { name: "Toggle AI assistant" }));
  await screen.findByLabelText("What would you like to make?");
  expect(useWorkbenchState.getState().bottomOpen).toBe(dock.bottomOpen);
  expect(useWorkbenchState.getState().bottomTab).toBe(dock.bottomTab);
  expect(screen.getByRole("heading", { name: "Parametric Timeline" })).toBeVisible();
  act(() => useAiDrawer.setState({ open: false }));
  expect(useWorkbenchState.getState().bottomOpen).toBe(true);
});

it("lets collapsed Escape reach the canvas and preserves IME composition on the expanded header", async () => {
  render(<App />);
  const launcher = await screen.findByRole("button", { name: "Open AI assistant" });
  expect(fireEvent.keyDown(launcher, { key: "Escape" })).toBe(true);
  fireEvent.click(launcher);
  await screen.findByLabelText("What would you like to make?");
  expect(fireEvent.keyDown(screen.getByRole("button", { name: "Close AI assistant" }), { key: "Escape", isComposing: true })).toBe(true);
  expect(useAiDrawer.getState().open).toBe(true);
});

it("reports a rejected bottom launcher command while preserving the project", async () => {
  render(<App />);
  const before = useCadStore.getState().history;
  vi.spyOn(registry, "runCommand").mockRejectedValueOnce(new Error("Toggle unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Toggle AI assistant" }));
  await waitFor(() => expect(useCadStore.getState().fileError).toBe("Command failed: Toggle AI assistant. Please try again."));
  expect(useCadStore.getState().history).toBe(before);
  expect(useAiDrawer.getState().open).toBe(false);
});

it.each(["rejected", "thrown"])("reports a %s canvas launcher command without losing the project", async failure => {
  render(<App />);
  const launcher = await screen.findByRole("button", { name: "Open AI assistant" });
  const before = useCadStore.getState().history;
  const command = vi.spyOn(registry, "runCommand");
  if (failure === "rejected") command.mockRejectedValueOnce(new Error("Toggle unavailable"));
  else command.mockImplementationOnce(() => { throw new Error("Toggle unavailable"); });
  fireEvent.click(launcher);
  await waitFor(() => expect(useCadStore.getState().fileError).toBe("Command failed: Toggle AI assistant. Please try again."));
  expect(useCadStore.getState().history).toBe(before);
  expect(useAiDrawer.getState().open).toBe(false);
});
