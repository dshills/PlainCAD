import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspacePanels } from "../ui/workspace/WorkspacePanels";
import { useWorkspaceState } from "../state/useWorkspaceState";
import { useWorkbenchState } from "../state/useWorkbenchState";
import { useCommandPlan } from "../state/commandPlanState";
import { useCadStore } from "../state/useCadStore";
import { clearAiCanvasPreview, useAiCanvasPreview } from "../state/aiCanvasPreview";
import { describeCommands, executeCommand } from "../commands/registry";
function available(id: string) { return describeCommands().find(command => command.id === id)?.bindings[0]?.available; }
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCommandPlan.setState({ status: "idle", frame: undefined, error: undefined });
  clearAiCanvasPreview();
  useWorkspaceState.setState({ layout: "workbench", activePanel: "views" });
  useWorkbenchState.setState({ rightOpen: true, rightTab: "properties", mobileDock: "none" });
});
afterEach(() => { cleanup(); useCommandPlan.setState({ status: "idle", frame: undefined, error: undefined }); clearAiCanvasPreview(); });
it("retains the existing details dock and its local draft through plan review and dismissal", async () => {
  render(<WorkspacePanels />);
  const input = await screen.findByRole("textbox", { name: "New view name" });
  fireEvent.change(input, { target: { value: "Inspection pose draft" } });
  act(() => useCommandPlan.setState({ status: "failed", error: "The candidate operation is unsupported." }));
  expect(screen.getByRole("alert")).toHaveTextContent("unsupported");
  expect(input).toBeInTheDocument();
  expect(input).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss command plan" }));
  act(() => useWorkbenchState.getState().showRight("properties"));
  expect(await screen.findByRole("textbox", { name: "New view name" })).toBe(input);
  expect(input).toHaveValue("Inspection pose draft");
});
it("shares real command availability for busy files, absent Apply proof and foreign AI proposals", async () => {
  expect(available("plan.preview")).toBe(true);
  expect(available("plan.apply")).toBe(false);
  useCadStore.setState({ fileBusy: true });
  expect(available("plan.preview")).toBe(false);
  useCadStore.setState({ fileBusy: false });
  const state = useCadStore.getState();
  const foreign = { document: state.history.present, session: state.documentSession, beforeResult: state.rebuild.result, result: state.rebuild.result!, bodyIds: [] };
  useAiCanvasPreview.setState({ preview: foreign });
  expect(available("plan.preview")).toBe(false);
  expect(await executeCommand({ command: "plan.preview", session: state.documentSession, arguments: { steps: [{ command: "cad.sketch.create", arguments: { name: "Blocked sketch", plane: "XY" } }] } })).toMatchObject({ ok: false, error: { code: "unavailable" } });
  expect(useAiCanvasPreview.getState().preview).toBe(foreign);
});
