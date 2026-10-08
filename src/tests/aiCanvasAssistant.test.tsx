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

it.each(["workbench", "focused", "full"] as const)("opens AI inside the %s bottom dock and retains its draft without document edits", async layout => {
  useWorkspaceState.setState({ layout });
  render(<App />);
  const before = useCadStore.getState();
  expect(screen.queryByLabelText("What would you like to make?")).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Open AI assistant" }));
  const prompt = await screen.findByLabelText("What would you like to make?");
  expect(prompt.closest(".bottom-dock-body")).toBeInTheDocument();
  expect(prompt.closest(".viewer-region")).toBeNull();
  expect(prompt).toHaveFocus();
  fireEvent.change(prompt, { target: { value: "A wall mounting bracket" } });
  fireEvent.click(screen.getByRole("button", { name: "Close AI assistant" }));
  expect(prompt).not.toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Open AI assistant" })).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Open AI assistant" }));
  expect(screen.getByLabelText("What would you like to make?")).toHaveValue("A wall mounting bracket");
  await waitFor(() => expect(screen.getByLabelText("What would you like to make?")).toHaveFocus());
  expect(useCadStore.getState().history).toBe(before.history);
  expect(useCadStore.getState().rebuild).toBe(before.rebuild);
  expect(useWorkbenchState.getState().bottomOpen).toBe(true);
  expect(useWorkbenchState.getState().bottomTab).toBe("ai");
});

it("switches AI, History and Issues in the same dock while retaining the AI description", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  fireEvent.click(screen.getByRole("button", { name: "Open AI assistant" }));
  const prompt = await screen.findByLabelText("What would you like to make?");
  fireEvent.change(prompt, { target: { value: "A small housing" } });
  expect(useWorkbenchState.getState().bottomTab).toBe("ai");
  expect(screen.queryByRole("heading", { name: "Parametric Timeline" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Issues" }));
  expect(useAiDrawer.getState().open).toBe(false);
  expect(prompt).not.toBeVisible();
  expect(screen.getByRole("heading", { name: "Rebuild" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(screen.getByRole("heading", { name: "Parametric Timeline" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open AI assistant" }));
  expect(screen.getByLabelText("What would you like to make?")).toHaveValue("A small housing");
  expect(screen.getByLabelText("What would you like to make?")).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText("What would you like to make?")).toHaveFocus());
  const handle = screen.getByRole("separator", { name: "Resize bottom dock" });
  const height = useWorkbenchState.getState().bottomHeight;
  fireEvent.keyDown(handle, { key: "ArrowUp" });
  expect(useWorkbenchState.getState().bottomHeight).toBe(height + 8);
  fireEvent.click(screen.getByRole("button", { name: "Close bottom dock" }));
  expect(useAiDrawer.getState().open).toBe(false);
  expect(prompt).not.toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Open AI assistant" })).toHaveFocus());
});

it("keeps one retained AI editor through layout changes and external dock collapse", async () => {
  render(<App />);
  act(() => useAiDrawer.setState({ open: true }));
  const prompt = await screen.findByLabelText("What would you like to make?");
  fireEvent.change(prompt, { target: { value: "An enclosure" } });
  act(() => useWorkspaceState.setState({ layout: "focused" }));
  expect(screen.getByLabelText("What would you like to make?")).toBe(prompt);
  expect(prompt).toHaveValue("An enclosure");
  expect(prompt.closest(".bottom-dock-body")).toBeInTheDocument();
  act(() => useWorkbenchState.setState({ bottomOpen: false }));
  expect(useAiDrawer.getState().open).toBe(false);
  expect(prompt).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open AI assistant" }));
  expect(prompt).toHaveValue("An enclosure");
});

it("lets collapsed Escape reach the canvas and preserves IME composition on the expanded dock", async () => {
  render(<App />);
  const launcher = await screen.findByRole("button", { name: "Open AI assistant" });
  expect(fireEvent.keyDown(launcher, { key: "Escape" })).toBe(true);
  fireEvent.click(launcher);
  await screen.findByLabelText("What would you like to make?");
  expect(fireEvent.keyDown(screen.getByLabelText("What would you like to make?"), { key: "Escape", isComposing: true })).toBe(true);
  expect(useAiDrawer.getState().open).toBe(true);
});

it("reports a rejected dock command while preserving the project", async () => {
  render(<App />);
  const before = useCadStore.getState().history;
  vi.spyOn(registry, "runCommand").mockRejectedValueOnce(new Error("Toggle unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Open AI assistant" }));
  await waitFor(() => expect(useCadStore.getState().fileError).toBe("Command failed: Toggle AI assistant. Please try again."));
  expect(useCadStore.getState().history).toBe(before);
  expect(useAiDrawer.getState().open).toBe(false);
});

it.each(["rejected", "thrown"])("reports a %s dock command without losing the project", async failure => {
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

it("does not leave an empty expanded AI dock after an external tab request", () => {
  render(<App />);
  act(() => useWorkbenchState.getState().showBottom("ai"));
  expect(useWorkbenchState.getState().bottomOpen).toBe(false);
  expect(useAiDrawer.getState().open).toBe(false);
  expect(screen.queryByRole("separator", { name: "Resize bottom dock" })).toBeNull();
});

it("repeated close commands cannot reopen the dock", async () => {
  render(<App />);
  act(() => useAiDrawer.setState({ open: true }));
  await screen.findByLabelText("What would you like to make?");
  await act(async () => {
    await registry.runCommand("ai.close");
    await registry.runCommand("ai.close");
  });
  expect(useAiDrawer.getState().open).toBe(false);
  expect(useWorkbenchState.getState().bottomOpen).toBe(false);
});
