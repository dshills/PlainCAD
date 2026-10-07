import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, createExtrudeFeature } from "../cad/document/CadDocument";
import { useCadStore } from "../state/useCadStore";
import { useProjectWorkflow } from "../ui/commands/projectWorkflowCommand";
import { ProjectStart } from "../ui/workspace/ProjectStart";
import { useExtrudeDraft } from "../ui/commands/extrudeCommand";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../ui/commands/commandRegistry", async (importOriginal) => ({
  ...await importOriginal<typeof import("../ui/commands/commandRegistry")>(),
  runCommand: mocks.run,
}));

beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.getState().setDocument(createEmptyDocument());
  useProjectWorkflow.setState(useProjectWorkflow.getInitialState(), true);
  useExtrudeDraft.setState({ draft: undefined });
  mocks.run.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  useExtrudeDraft.setState({ draft: undefined });
});

function openMenu() {
  const summary = screen.getByText("New part", { exact: true });
  fireEvent.click(summary);
  return { summary, menu: summary.closest("details")! };
}

it("starts collapsed and allows cancel without editing the project", () => {
  const history = useCadStore.getState().history;
  render(<ProjectStart context={{}} />);
  expect(screen.queryByRole("region", { name: "Start a part" })).toBeNull();
  const { summary, menu } = openMenu();
  expect(menu.open).toBe(true);
  expect(screen.getByRole("region", { name: "Start a part" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Part name"), { target: { value: "Unpublished part" } });
  fireEvent.keyDown(screen.getByLabelText("Part name"), { key: "Escape" });
  expect(menu.open).toBe(false);
  expect(summary).toHaveFocus();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(useCadStore.getState().history).toBe(history);
});

it("lets closed-menu Escape reach the workspace and dismisses an open menu first", () => {
  let workspaceEscapes = 0;
  render(<div onKeyDown={(event) => { if (event.key === "Escape") workspaceEscapes++; }}><ProjectStart context={{}} /></div>);
  const summary = screen.getByText("New part", { exact: true });
  fireEvent.keyDown(summary, { key: "Escape" });
  expect(workspaceEscapes).toBe(1);
  fireEvent.click(summary);
  fireEvent.keyDown(screen.getByLabelText("Part name"), { key: "Escape" });
  expect(workspaceEscapes).toBe(1);
  expect(summary.closest("details")!.open).toBe(false);
});

it("dismisses on outside pointer interaction and preserves keyboard access", () => {
  render(<><ProjectStart context={{}} /><button>Workspace action</button></>);
  const { menu } = openMenu();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Workspace action" }));
  expect(menu.open).toBe(false);
  fireEvent.click(screen.getByText("New part", { exact: true }));
  expect(menu.open).toBe(true);
  fireEvent.focusIn(screen.getByRole("button", { name: "Workspace action" }));
  expect(menu.open).toBe(false);
});

it("closes after dispatching a named start and does not publish geometry itself", async () => {
  const before = useCadStore.getState().history;
  render(<ProjectStart context={{}} />);
  const { menu } = openMenu();
  fireEvent.change(screen.getByLabelText("Part name"), { target: { value: "Bracket" } });
  fireEvent.click(screen.getByRole("button", { name: "Draw a shape" }));
  await waitFor(() => expect(menu.open).toBe(false));
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("project.startDrawing", { componentName: "Bracket" });
  expect(useCadStore.getState().history).toBe(before);
});

it("invalidates open names and errors across a same-ID project replacement", async () => {
  const document = useCadStore.getState().history.present;
  mocks.run.mockRejectedValueOnce(new Error("Example start failure"));
  render(<ProjectStart context={{}} />);
  const { menu } = openMenu();
  fireEvent.change(screen.getByLabelText("Part name"), { target: { value: "Previous project part" } });
  fireEvent.click(screen.getByRole("button", { name: "Draw a shape" }));
  await screen.findByRole("alert");
  expect(menu.open).toBe(true);
  act(() => useCadStore.getState().setDocument(document));
  expect(menu.open).toBe(false);
  openMenu();
  expect(screen.getByLabelText("Part name")).toHaveValue("Part 1");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("dismisses after opening a file picker without changing the saved part-name request", async () => {
  const context = {};
  render(<ProjectStart context={context} />);
  const { menu } = openMenu();
  fireEvent.change(screen.getByLabelText("Part name"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Open an existing project" }));
  await waitFor(() => expect(menu.open).toBe(false));
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("file.openProject", context);
  expect(useProjectWorkflow.getState().startName).toBeUndefined();
});

it("reports a rejected example command while keeping the menu available to retry", async () => {
  mocks.run.mockRejectedValueOnce(new Error("Example could not load"));
  render(<ProjectStart context={{}} />);
  const { menu } = openMenu();
  screen.getByText("Start from example").closest("details")!.open = true;
  fireEvent.click(screen.getByRole("button", { name: "Load parametric box template" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Example could not load");
  expect(menu.open).toBe(true);
  expect(useProjectWorkflow.getState().startName).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Load parametric box template" }));
  await waitFor(() => expect(menu.open).toBe(false));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("blocks named New part starts until an ordinary extrusion preview finishes", () => {
  const state = useCadStore.getState();
  const feature = createExtrudeFeature({
    name: "Pending extrusion", sketchId: "preview-sketch", profileId: "preview-profile",
    operation: "newBody", direction: "positive", distance: { expression: "10mm", unit: "mm" },
  });
  useExtrudeDraft.setState({ draft: {
    document: state.history.present, session: state.documentSession,
    componentId: state.activeComponentId, sketchId: feature.sketchId, feature,
  } });
  expect(useExtrudeDraft.getState().draft?.targetSnapshot).toBeUndefined();
  render(<ProjectStart context={{}} />);
  openMenu();
  const draw = screen.getByRole("button", { name: "Draw a shape" });
  expect(draw).toBeDisabled();
  expect(screen.getByRole("button", { name: "Describe a part with AI" })).toBeDisabled();
  fireEvent.click(draw);
  expect(mocks.run).not.toHaveBeenCalled();
  act(() => useExtrudeDraft.setState({ draft: undefined }));
  expect(draw).toBeEnabled();
  expect(useCadStore.getState().history.present).toBe(state.history.present);
});
