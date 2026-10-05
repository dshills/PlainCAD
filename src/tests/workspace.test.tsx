import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../app/App";
import {
  useWorkspaceState,
  WORKSPACE_STORAGE_KEY,
  readWorkspacePreferences,
} from "../state/useWorkspaceState";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useProjectWorkflow } from "../ui/commands/projectWorkflowCommand";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { createEmptyDocument } from "../cad/document/CadDocument";
vi.mock("../viewer/CadViewer", () => ({
  CadViewer: () => <div data-testid="cad-viewer" />,
}));
const originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
beforeEach(async () => {
  values.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  useWorkspaceState.setState({
    ...readWorkspacePreferences(),
    activePanel: "auto",
    sheet: undefined,
    persistenceError: undefined,
  });
  useSketchCanvas.setState({ active: undefined });
  useProjectWorkflow.setState({ active: undefined });
  useAiDrawer.setState({ open: false });
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.getState().setDocument(createEmptyDocument());
  await waitFor(() =>
    expect(useCadStore.getState().rebuild.status).toBe("succeeded"),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalStorage)
    Object.defineProperty(window, "localStorage", originalStorage);
  else Reflect.deleteProperty(window, "localStorage");
});
it("starts focused with clear entry choices and no empty panel or timeline wall; all tools retains shared enablement", () => {
  render(<App />);
  expect(screen.getByLabelText("Workspace layout")).toHaveValue("focused");
  const start = screen.getByRole("region", { name: "Start a part" });
  expect(
    within(start).getByRole("button", { name: "Draw a shape" }),
  ).toBeEnabled();
  expect(
    within(start).getByRole("button", { name: "Describe a part with AI" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("heading", { name: "Dependencies" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Parametric Timeline" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All tools" }));
  const palette = screen.getByRole("dialog", { name: "Command Palette" });
  expect(
    within(palette).getByRole("button", { name: /Export STL/ }),
  ).toBeDisabled();
  expect(
    within(palette).getByRole("button", { name: /Create XY Sketch/ }),
  ).toBeEnabled();
});
it("keeps parameter drafts mounted while changing panels/layout and pins without changing the document or rebuild", () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Task panel"), {
    target: { value: "parameters" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add Parameter" }));
  const input = screen.getByLabelText("Parameter param_1 expression");
  fireEvent.change(input, { target: { value: "22mm" } });
  const before = useCadStore.getState();
  fireEvent.change(screen.getByLabelText("Task panel"), {
    target: { value: "views" },
  });
  fireEvent.change(screen.getByLabelText("Workspace layout"), {
    target: { value: "full" },
  });
  expect(screen.getByLabelText("Parameter param_1 expression")).toBe(input);
  expect(input).toHaveValue("22mm");
  fireEvent.click(screen.getByRole("button", { name: "Pin Parameters panel" }));
  fireEvent.change(screen.getByLabelText("Workspace layout"), {
    target: { value: "focused" },
  });
  expect(screen.getByRole("heading", { name: "Parameters" })).toBeVisible();
  expect(useCadStore.getState().history).toBe(before.history);
  expect(useCadStore.getState().rebuild).toBe(before.rebuild);
  expect(readWorkspacePreferences()).toMatchObject({
    layout: "focused",
    pins: ["parameters"],
  });
  fireEvent.click(screen.getByRole("button", { name: "Pin Parameters panel" }));
  expect(screen.getByLabelText("Task panel")).toHaveFocus();
  expect(input).toHaveValue("22mm");
  expect(input).not.toBeVisible();
});
it("opens Parts deliberately, restores focus when closed and starts the existing drawing workflow", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Parts" }));
  expect(screen.getByRole("heading", { name: "Browser" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close Parts" }));
  expect(screen.getByRole("button", { name: "Parts" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Draw a shape" }));
  expect(screen.getByRole("region", { name: "Create Sketch" })).toBeVisible();
});
it("validates local preferences and keeps runtime task selection outside saved preferences", () => {
  storage.setItem(
    WORKSPACE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      layout: "full",
      pins: ["parameters", "parameters", "bad", 5],
      partsOpen: true,
      historyOpen: "true",
      activePanel: "issues",
    }),
  );
  expect(readWorkspacePreferences()).toEqual({
    layout: "full",
    pins: ["parameters"],
    partsOpen: true,
    historyOpen: false,
  });
  act(() => useWorkspaceState.getState().setLayout("full"));
  const stored = values.get(WORKSPACE_STORAGE_KEY);
  act(() => useWorkspaceState.getState().setPanel("views"));
  expect(values.get(WORKSPACE_STORAGE_KEY)).toBe(stored);
  expect(stored).not.toContain("activePanel");
  expect(stored).not.toContain("sheet");
  for (const value of [
    "bad",
    JSON.stringify({ version: 99, layout: "full" }),
    "x".repeat(8193),
  ]) {
    storage.setItem(WORKSPACE_STORAGE_KEY, value);
    expect(readWorkspacePreferences().layout).toBe("focused");
  }
});
it("remains usable with blocked storage and clears the notice after a successful write", () => {
  const write = vi.spyOn(storage, "setItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  act(() => useWorkspaceState.getState().setLayout("full"));
  expect(useWorkspaceState.getState().layout).toBe("full");
  expect(useWorkspaceState.getState().persistenceError).toMatch(/this session/);
  write.mockRestore();
  act(() => useWorkspaceState.getState().setLayout("focused"));
  expect(useWorkspaceState.getState().persistenceError).toBeUndefined();
  expect(values.get(WORKSPACE_STORAGE_KEY)).not.toContain("activePanel");
});
