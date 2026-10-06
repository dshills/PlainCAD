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
import * as registry from "../ui/commands/commandRegistry";
import { App } from "../app/App";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { useCadStore } from "../state/useCadStore";
import {
  readWorkspacePreferences,
  useWorkspaceState,
} from "../state/useWorkspaceState";
import {
  boundedDockSize,
  readWorkbenchPreferences,
  useWorkbenchState,
  WORKBENCH_STORAGE_KEY,
} from "../state/useWorkbenchState";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
vi.mock("../viewer/CadViewer", () => ({
  CadViewer: () => <div data-testid="cad-viewer" />,
}));
const originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
const values = new Map<string, string>();
beforeEach(async () => {
  values.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
  useWorkspaceState.setState({
    ...readWorkspacePreferences(),
    activePanel: "auto",
    pins: [],
    sheet: undefined,
  });
  useWorkbenchState.setState({
    ...readWorkbenchPreferences(),
    rightTab: "task",
    bottomOpen: false,
    bottomTab: "history",
    mobileDock: "left",
  });
  useAiDrawer.setState({ open: false });
  useSketchCanvas.setState({ active: undefined });
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.getState().setDocument(createEmptyDocument());
  await waitFor(() =>
    expect(useCadStore.getState().rebuild.status).toBe("succeeded"),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalStorage)
    Object.defineProperty(window, "localStorage", originalStorage);
});
it("defaults to stable docks and keeps layout, tab switches and resizing out of document history", () => {
  render(<App />);
  expect(readWorkspacePreferences().layout).toBe("workbench");
  const before = useCadStore.getState();
  const left = screen.getByRole("complementary", { name: "Parts browser" });
  const right = screen.getByRole("complementary", {
    name: "Workspace details",
  });
  fireEvent.click(within(left).getByRole("button", { name: "Parameters" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Parameter" }));
  const input = screen.getByLabelText("Parameter param_1 expression");
  fireEvent.change(input, { target: { value: "22mm" } });
  const afterAdd = useCadStore.getState();
  fireEvent.click(within(left).getByRole("button", { name: "Project" }));
  expect(input).not.toBeVisible();
  fireEvent.click(within(left).getByRole("button", { name: "Parameters" }));
  expect(screen.getByLabelText("Parameter param_1 expression")).toBe(input);
  expect(input).toHaveValue("22mm");
  fireEvent.click(within(right).getByRole("button", { name: "Properties" }));
  fireEvent.change(screen.getByLabelText("Task panel"), {
    target: { value: "views" },
  });
  expect(screen.getByRole("heading", { name: "Views" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Inspector" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(
    screen.getByRole("separator", { name: "Resize left dock" }),
    { key: "ArrowRight" },
  );
  expect(useWorkbenchState.getState().leftWidth).toBe(264);
  expect(readWorkbenchPreferences().leftWidth).toBe(264);
  expect(useCadStore.getState().history).toBe(afterAdd.history);
  expect(useCadStore.getState().rebuild).toBe(afterAdd.rebuild);
  expect(afterAdd.history.past.length).toBe(before.history.past.length + 1);
  expect(JSON.stringify(afterAdd.history.present)).not.toContain("leftWidth");
  fireEvent.click(screen.getByRole("button", { name: "Close Parts" }));
  expect(screen.getByRole("button", { name: "Parts" })).toHaveFocus();
  expect(left).not.toBeVisible();
});
it("switches bottom surfaces, closes AI once, and restores its keyboard return target", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ providers: [] }) }),
  );
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI drawer" }));
  await waitFor(() =>
    expect(screen.getByLabelText("What would you like to make?")).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close AI drawer" }));
  expect(useAiDrawer.getState().open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(
    screen.getByRole("heading", { name: "Parametric Timeline" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Issues" }));
  expect(screen.getByRole("heading", { name: "Rebuild" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Parametric Timeline" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open AI drawer" }));
  fireEvent.keyDown(screen.getByLabelText("What would you like to make?"), {
    key: "Escape",
  });
  expect(screen.getByRole("button", { name: "Open AI drawer" })).toHaveFocus();
});
it("bounds persisted sizes and rejects unsafe or unknown layout data", () => {
  values.set(
    WORKBENCH_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      leftWidth: 10000,
      rightWidth: -5,
      bottomHeight: "300",
      leftOpen: false,
      leftTab: "bogus",
    }),
  );
  expect(readWorkbenchPreferences()).toMatchObject({
    leftWidth: 400,
    rightWidth: 280,
    bottomHeight: 224,
    leftTab: "project",
    leftOpen: false,
  });
  expect(boundedDockSize("leftWidth", Infinity)).toBe(256);
  values.set(WORKBENCH_STORAGE_KEY, "bad");
  expect(readWorkbenchPreferences().leftOpen).toBe(true);
  values.set(
    WORKBENCH_STORAGE_KEY,
    JSON.stringify({ version: 99, leftWidth: 400 }),
  );
  expect(readWorkbenchPreferences().leftWidth).toBe(256);
  act(() => useWorkbenchState.getState().configure({ leftWidth: 900 }));
  expect(readWorkbenchPreferences().leftWidth).toBe(400);
  expect(values.get(WORKBENCH_STORAGE_KEY)).not.toContain("bottomOpen");
});

it("keeps auto panel reset transient and reports both sync/async command failures", async () => {
  render(<App />);
  const stored = values.get(WORKBENCH_STORAGE_KEY);
  act(() => useWorkspaceState.getState().setPanel("auto"));
  expect(useWorkbenchState.getState().rightTab).toBe("task");
  expect(values.get(WORKBENCH_STORAGE_KEY)).toBe(stored);
  const command = vi.spyOn(registry, "runCommand");
  command.mockImplementationOnce(() => {
    throw new Error("Storage write failed");
  });
  fireEvent.click(screen.getByRole("button", { name: "Save project" }));
  await waitFor(() =>
    expect(
      screen.getByText(/Command failed:/).closest("[role=alert]"),
    ).toHaveTextContent("Command failed: Save project. Storage write failed"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  command.mockRejectedValueOnce(new Error("Download failed"));
  fireEvent.click(screen.getByRole("button", { name: "Save project" }));
  await waitFor(() =>
    expect(
      screen.getByText(/Command failed:/).closest("[role=alert]"),
    ).toHaveTextContent("Command failed: Save project. Download failed"),
  );
});
