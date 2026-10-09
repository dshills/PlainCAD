import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MacrosPanel } from "../ui/panels/MacrosPanel";
import { registerMacroCommands, useMacroStore } from "../commands/macroStore";
import { configureCommandRuntime, executeCommand, type CommandRequest, type JsonValue } from "../commands/registry";
import { useCadStore } from "../state/useCadStore";
import { useCommandPlan } from "../state/commandPlanState";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
let release = () => {};
const originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
afterEach(() => { cleanup(); useCommandPlan.setState({ status: "idle", frame: undefined, progress: undefined, error: undefined }); useSketchCanvas.setState({ active: undefined }); useCadStore.setState(useCadStore.getInitialState(), true); if (originalStorage) Object.defineProperty(window, "localStorage", originalStorage); release(); configureCommandRuntime(() => 0, invoke => invoke()); });
it("records a named workflow and previews typed adjustments without applying changes", async () => {
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) } });
  useMacroStore.setState({ saved: [], recording: undefined, draft: undefined, message: undefined, storageError: undefined, storageBlocked: false });
  let listener: (event: { request: CommandRequest; result: JsonValue }) => void = () => {};
  const previewPlan = vi.fn(async () => ({ planId: "ready", status: "ready" }));
  configureCommandRuntime(() => useCadStore.getState().documentSession, invoke => invoke());
  release = registerMacroCommands({ canRecord: () => true, currentSession: () => useCadStore.getState().documentSession, commands: () => ["cad.sketch.rectangle"], previewPlan, subscribeExecutions: fn => { listener = fn; return () => {}; } });
  useMacroStore.setState({ saved: [], recording: undefined, draft: undefined });
  render(<MacrosPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Record workflow" }));
  await screen.findByText("Recording · 0 modeling steps");
  act(() => listener({ request: { command: "cad.sketch.rectangle", arguments: { sketchId: "sketch", width: "30", height: "20" } }, result: { entityId: "rectangle" } }));
  expect(screen.getByText("Recording · 1 modeling steps")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  const name = await screen.findByLabelText("Workflow name");
  fireEvent.change(name, { target: { value: "Test plate" } });
  fireEvent.change(screen.getByLabelText("Argument"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Input name"), { target: { value: "plateWidth" } });
  fireEvent.click(screen.getByRole("button", { name: "Add adjustable input" }));
  await waitFor(() => expect(useMacroStore.getState().draft?.variables[0]?.name).toBe("plateWidth"));
  fireEvent.click(screen.getByRole("button", { name: "Save recorded workflow" }));
  await waitFor(() => expect(useMacroStore.getState().saved).toHaveLength(1));
  fireEvent.change(screen.getByLabelText("Saved workflow"), { target: { value: useMacroStore.getState().saved[0].id } });
  fireEvent.change(await screen.findByLabelText("plateWidth"), { target: { value: "60" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview workflow" }));
  await waitFor(() => expect(previewPlan).toHaveBeenCalledWith({ label: "Test plate", steps: [{ command: "cad.sketch.rectangle", arguments: { sketchId: "sketch", width: "60", height: "20" } }] }));
  expect(screen.getByText(/Apply accepts all steps as one Undo/)).toBeInTheDocument();
});

it("keeps buttons synchronized with registry guards as CAD, plan and drawing state change", async () => {
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) } });
  useMacroStore.setState({ saved: [], recording: undefined, draft: undefined, message: undefined, storageError: undefined, storageBlocked: false });
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, status: "queued" } });
  useCommandPlan.setState({ status: "idle", frame: undefined });
  useSketchCanvas.setState({ active: undefined });
  configureCommandRuntime(() => useCadStore.getState().documentSession, invoke => invoke());
  const previewPlan = vi.fn(async () => ({ planId: "ready", status: "ready" }));
  release = registerMacroCommands({
    canRecord: () => !useCadStore.getState().fileBusy,
    canPreview: () => !useCadStore.getState().fileBusy && !useSketchCanvas.getState().active && useCadStore.getState().rebuild.status === "succeeded" && useCommandPlan.getState().status === "idle",
    currentSession: () => useCadStore.getState().documentSession, commands: () => ["cad.sketch.rectangle"], previewPlan, subscribeExecutions: () => () => {},
  });
  const save = await executeCommand({ command: "macro.save", session: useCadStore.getState().documentSession, arguments: { macro: { version: 1, id: "availability", name: "Plate", variables: [], steps: [{ command: "cad.sketch.rectangle", arguments: { sketchId: "sketch", width: "20", height: "10" } }] } } });
  expect(save.ok).toBe(true);
  render(<MacrosPanel />);
  fireEvent.change(screen.getByLabelText("Saved workflow"), { target: { value: "availability" } });
  const record = screen.getByRole("button", { name: "Record workflow" }), preview = screen.getByRole("button", { name: "Preview workflow" });
  expect(record).toBeEnabled(); expect(preview).toBeDisabled();
  act(() => useCadStore.setState({ fileBusy: true }));
  expect(record).toBeDisabled(); expect(preview).toBeDisabled();
  act(() => useCadStore.setState({ fileBusy: false, rebuild: { ...useCadStore.getState().rebuild, status: "succeeded" } }));
  expect(record).toBeEnabled(); expect(preview).toBeEnabled();
  act(() => useCommandPlan.setState({ status: "previewing" }));
  expect(preview).toBeDisabled();
  act(() => useCommandPlan.setState({ status: "idle" }));
  expect(preview).toBeEnabled();
  act(() => useSketchCanvas.setState({ active: { documentId: useCadStore.getState().history.present.id, session: useCadStore.getState().documentSession, sketchId: "sketch", requestedTool: "rectangle" } }));
  expect(record).toBeEnabled(); expect(preview).toBeDisabled();
  act(() => useSketchCanvas.setState({ active: undefined }));
  expect(preview).toBeEnabled();
  expect(previewPlan).not.toHaveBeenCalled();
});
