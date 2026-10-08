import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import { useFileJobs } from "../persistence/fileJobs";
import { FabricationPanel } from "../ui/panels/FabricationPanel";
import { beginSaveOrExport, canBeginSaveOrExport, useGuidedExport } from "../ui/commands/guidedExportCommand";
import { captureExportHub, handoffExportHub } from "../ui/commands/exportHubCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { runCommand } from "../ui/commands/commandRegistry";
vi.mock("../ui/commands/commandRegistry", async original => ({ ...(await original<typeof import("../ui/commands/commandRegistry")>()), runCommand: vi.fn() }));
const command = vi.mocked(runCommand);
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("Worker", class {}); vi.stubGlobal("indexedDB", {});
  useFileJobs.getState().cancel(); useFileJobs.setState({ exportOpen: false }); useGuidedExport.setState({ task: undefined }); useSketchCanvas.setState({ active: undefined });
  const document = createBoxTemplate(), result = rebuildDocument(document);
  useCadStore.setState({ ...useCadStore.getInitialState(), documentSession: 90, activeComponentId: document.rootComponentId, history: { past: [], present: document, future: [] }, rebuild: { status: "succeeded", kernelReady: true, result } }, true);
});
afterEach(() => { cleanup(); useFileJobs.getState().cancel(); useFileJobs.setState({ exportOpen: false }); useSketchCanvas.setState({ active: undefined }); vi.unstubAllGlobals(); });
function open(goal: RegExp) { beginSaveOrExport(); render(<FabricationPanel />); fireEvent.click(screen.getByRole("radio", { name: goal })); }
it("shows five plain output goals and distinguishes unavailable native STEP", () => {
  open(/Other CAD/); expect(screen.getAllByRole("radio")).toHaveLength(5);
  expect(screen.getByRole("button", { name: "Choose parts for STEP" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("valid OpenCascade solids");
  expect(screen.getByText(/does not keep PlainCAD/)).toBeVisible();
});
it("closes the hub before handing selected native solids to the STEP command", async () => {
  const result = useCadStore.getState().rebuild.result!;
  useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: { ...result, stepExportAvailable: true, meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade", geometryAssertions: { valid: true, volume: 24000, solidCount: 1, surfaceArea: 10000 } })) } } });
  let openDuringCommand: boolean | undefined;
  command.mockImplementation(() => { openDuringCommand = useFileJobs.getState().exportOpen; });
  open(/Other CAD/); fireEvent.click(screen.getByRole("button", { name: "Choose parts for STEP" }));
  expect(command).toHaveBeenCalledExactlyOnceWith("file.exportStep"); expect(openDuringCommand).toBe(false); expect(useCadStore.getState().fileError).toBeUndefined(); expect(screen.queryByRole("dialog")).toBeNull();
});
it("describes and hands off a selected part image without claiming a download", () => {
  const state = useCadStore.getState(); state.select({ kind: "body", id: state.rebuild.result!.bodies[0].id, documentId: state.history.present.id });
  open(/Image \(\.png\)/); fireEvent.change(screen.getByRole("combobox", { name: "Image content" }), { target: { value: "body" } });
  expect(screen.getByRole("status")).toHaveTextContent("Ready to capture the selected part");
  fireEvent.click(screen.getByRole("button", { name: "Download PNG" })); expect(command).toHaveBeenCalledExactlyOnceWith("file.exportBodyPng");
});
it("offers an honest selected-sketch handoff and keeps existing drawing sessions blocked", () => {
  const state = useCadStore.getState(), sketch = Object.values(state.history.present.sketches)[0]; state.select({ kind: "sketch", id: sketch.id, documentId: state.history.present.id });
  open(/Image \(\.png\)/); fireEvent.change(screen.getByRole("combobox", { name: "Image content" }), { target: { value: "sketch" } });
  expect(screen.getByRole("status")).toHaveTextContent("does not download an image");
  fireEvent.click(screen.getByRole("button", { name: "Open sketch image" })); expect(command).toHaveBeenCalledExactlyOnceWith("sketch.editCanvas");
  act(() => useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: sketch.id } }));
  expect(canBeginSaveOrExport()).toBe(false); act(() => beginSaveOrExport()); expect(useFileJobs.getState().exportOpen).toBe(false);
});
it("reviewing library backup opens its guarded command rather than downloading the current project", () => {
  open(/Library backup/); expect(screen.getByText(/saved library copies rather than/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Review library backup" })); expect(command).toHaveBeenCalledExactlyOnceWith("partLibrary");
});
it("invalidates handoff when the current rebuild or captured selection changes", async () => {
  open(/Image \(\.png\)/); const snapshot = captureExportHub();
  act(() => useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, result: { ...useCadStore.getState().rebuild.result! } } }));
  expect(screen.getByRole("button", { name: "Download PNG" })).toBeDisabled();
  await act(async () => handoffExportHub(snapshot, "image")); expect(command).not.toHaveBeenCalled();
  expect(useCadStore.getState().fileError).toMatch(/changed/);
});
it("checks project currency again after close subscribers run", async () => {
  beginSaveOrExport(); const snapshot = captureExportHub();
  const unsubscribe = useFileJobs.subscribe((state, previous) => { if (previous.exportOpen && !state.exportOpen) useCadStore.setState({ documentSession: 91 }); });
  try { await handoffExportHub(snapshot, "image"); } finally { unsubscribe(); }
  expect(command).not.toHaveBeenCalled(); expect(useCadStore.getState().fileError).toMatch(/while switching/);
});
it("keeps missing image selections disabled with a concrete next action", () => {
  open(/Image \(\.png\)/); fireEvent.change(screen.getByRole("combobox", { name: "Image content" }), { target: { value: "body" } });
  expect(screen.getByRole("button", { name: "Download PNG" })).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("Select a rebuilt part");
});

it("reacts to captured selection changes while the hub stays open", () => {
  open(/Image \(\.png\)/);
  act(() => { const state = useCadStore.getState(); state.select({ kind: "body", id: state.rebuild.result!.bodies[0].id, documentId: state.history.present.id }); });
  expect(screen.getByRole("button", { name: "Download PNG" })).toBeDisabled();
  expect(screen.getByText(/Model or selection changed/)).toBeVisible();
});

it("reports a running file operation accurately instead of claiming a model change", async () => {
  beginSaveOrExport(); const snapshot = captureExportHub(); useCadStore.setState({ fileBusy: true });
  await handoffExportHub(snapshot, "image");
  expect(command).not.toHaveBeenCalled(); expect(useCadStore.getState().fileError).toMatch(/Another file task is running/);
});

it("keeps the same selected scope available when selection objects are recreated", () => {
  const state = useCadStore.getState(); state.select({ kind: "body", id: state.rebuild.result!.bodies[0].id, documentId: state.history.present.id });
  open(/Image \(\.png\)/);
  act(() => useCadStore.setState({ selection: { selectedIds: [{ ...useCadStore.getState().selection.selectedIds[0] }] } }));
  expect(screen.getByRole("button", { name: "Download PNG" })).toBeEnabled();
});
