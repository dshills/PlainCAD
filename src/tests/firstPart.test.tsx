import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { createPartSketch } from "../cad/document/partCreation";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { useCadStore } from "../state/useCadStore";
import { useWorkspaceState } from "../state/useWorkspaceState";
import { runCommand } from "../ui/commands/commandRegistry";
import { finishProjectWorkflow, useProjectWorkflow } from "../ui/commands/projectWorkflowCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { beginPartDescription, useAiDrawer } from "../ui/commands/aiCommand";
import { ProjectStart } from "../ui/workspace/ProjectStart";
import { WorkbenchBreadcrumb } from "../ui/workspace/WorkbenchBreadcrumb";
import { AiDrawer } from "../ui/panels/AiDrawer";
import { aiPlatePlan } from "./fixtures/aiPlan";

const mocks = vi.hoisted(() => ({ providers: vi.fn(), request: vi.fn(), preview: vi.fn() }));
vi.mock("../ai/client", () => ({ fetchAiProviders: mocks.providers, requestAiPlan: mocks.request }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
vi.mock("../viewer/ExtrudePreview", () => ({ ExtrudePreview: () => <div /> }));

beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.getState().setDocument(createEmptyDocument());
  useProjectWorkflow.setState({ active: undefined });
  useSketchCanvas.setState({ active: undefined });
  useAiDrawer.setState({ open: false, namedPart: undefined });
  useWorkspaceState.setState({ layout: "workbench" });
  mocks.providers.mockResolvedValue([{ id: "anthropic", label: "Anthropic", model: "test-model", available: true }]);
  mocks.request.mockResolvedValue(aiPlatePlan);
  mocks.preview.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  useProjectWorkflow.setState({ active: undefined });
  useSketchCanvas.setState({ active: undefined });
  useAiDrawer.setState({ open: false, namedPart: undefined });
  vi.clearAllMocks();
});

it("builds a named part and owned sketch immutably with durable plane/ownership", () => {
  const before = createEmptyDocument();
  const result = createPartSketch(before, " Bracket ", { type: "origin", plane: "XZ" });
  expect(result.component.name).toBe("Bracket");
  expect(Object.keys(before.components)).toHaveLength(1);
  expect(Object.keys(before.sketches)).toHaveLength(0);
  const reopened = importProjectText(serializeProject(result.document));
  expect(reopened.sketches[result.sketch.id].componentId).toBe(result.component.id);
  expect(reopened.sketches[result.sketch.id].plane).toEqual({ type: "origin", plane: "XZ" });
});

it("publishes first-part component and sketch in one Undo edit only after plane confirmation", async () => {
  const before = useCadStore.getState().history.present;
  await runCommand("project.startDrawing", { componentName: "Bracket" });
  const active = useProjectWorkflow.getState().active!;
  expect(useCadStore.getState().history.present).toBe(before);
  finishProjectWorkflow(active, "XZ");
  const state = useCadStore.getState();
  const sketch = Object.values(state.history.present.sketches)[0];
  const componentId = state.activeComponentId;
  expect(sketch.componentId).toBe(componentId);
  expect(state.history.present.components[componentId].name).toBe("Bracket");
  expect(state.history.past).toEqual([before]);
  expect(useSketchCanvas.getState().active?.sketchId).toBe(sketch.id);
  useSketchCanvas.setState({ active: undefined });
  state.undo();
  expect(useCadStore.getState().history.present).toBe(before);
  state.redo();
  expect(useCadStore.getState().history.present.sketches[sketch.id].componentId).toBe(componentId);
});

it.each([" Bracket ", `  ${"A".repeat(120)}  `])(
  "normalizes padded names in both Draw and Describe commands: %s",
  async (rawName) => {
    const normalized = rawName.trim();
    await runCommand("project.startDrawing", { componentName: rawName });
    const drawing = useProjectWorkflow.getState().active!;
    expect(drawing.partName).toBe(normalized);
    finishProjectWorkflow(drawing, "XY");
    const created = useCadStore.getState();
    expect(created.history.present.components[created.activeComponentId].name).toBe(normalized);
    expect(created.history.past).toHaveLength(1);
    useSketchCanvas.setState({ active: undefined });
    created.setDocument(createEmptyDocument());
    const beforeDescription = useCadStore.getState().history;
    await runCommand("project.startDescribing", { componentName: rawName });
    expect(useAiDrawer.getState().namedPart?.name).toBe(normalized);
    expect(useCadStore.getState().history).toBe(beforeDescription);
    expect(Object.keys(beforeDescription.present.components)).toHaveLength(1);
    expect(Object.keys(beforeDescription.present.sketches)).toHaveLength(0);
  },
);

it("repeated Draw starts and duplicate plane callbacks publish only one part and sketch", () => {
  const before = useCadStore.getState().history.present;
  runCommand("project.startDrawing", { componentName: "Bracket" });
  const first = useProjectWorkflow.getState().active!;
  runCommand("project.startDrawing", { componentName: "Bracket" });
  const latest = useProjectWorkflow.getState().active!;
  expect(latest).not.toBe(first);
  expect(useCadStore.getState().history.present).toBe(before);
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(() => finishProjectWorkflow(first, "XY")).toThrow(/changed/);
  finishProjectWorkflow(latest, "XY");
  expect(() => finishProjectWorkflow(latest, "XY")).toThrow(/changed/);
  const published = useCadStore.getState().history;
  expect(published.past).toEqual([before]);
  expect(Object.keys(published.present.components)).toHaveLength(2);
  expect(Object.keys(published.present.sketches)).toHaveLength(1);
});

it("repeated Describe starts only replace the pending named request without publishing CAD", () => {
  const before = useCadStore.getState().history;
  runCommand("project.startDescribing", { componentName: "First name" });
  const first = useAiDrawer.getState().namedPart!;
  runCommand("project.startDescribing", { componentName: "Latest name" });
  const latest = useAiDrawer.getState().namedPart!;
  expect(latest).not.toBe(first);
  expect(latest.name).toBe("Latest name");
  expect(useCadStore.getState().history).toBe(before);
  expect(Object.keys(before.present.components)).toHaveLength(1);
  expect(Object.keys(before.present.sketches)).toHaveLength(0);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.preview).not.toHaveBeenCalled();
});

it("does not publish or activate a partial part when the store updater receives a changed snapshot", async () => {
  await runCommand("project.startDrawing", { componentName: "Bracket" });
  const active = useProjectWorkflow.getState().active!;
  const state = useCadStore.getState();
  const incoming = { ...state.history.present, name: "Changed externally" };
  let returned: typeof incoming | undefined;
  const update = vi.spyOn(state, "updateDocument").mockImplementation((mutator) => {
    returned = mutator(incoming);
    useCadStore.setState({ history: { ...state.history, present: returned } });
  });
  try {
    expect(() => finishProjectWorkflow(active, "XY")).toThrow(/could not be created/);
    expect(returned).toBe(incoming);
    expect(Object.keys(useCadStore.getState().history.present.components)).toHaveLength(1);
    expect(Object.keys(useCadStore.getState().history.present.sketches)).toHaveLength(0);
    expect(useCadStore.getState().history.past).toHaveLength(0);
    expect(useCadStore.getState().activeComponentId).toBe(incoming.rootComponentId);
    expect(useSketchCanvas.getState().active).toBeUndefined();
  } finally {
    update.mockRestore();
  }
});

it("canceled or replaced first-part choices cannot leave an unused part or sketch", async () => {
  await runCommand("project.startDrawing", { componentName: "Canceled" });
  const active = useProjectWorkflow.getState().active!;
  useProjectWorkflow.setState({ active: undefined });
  expect(() => finishProjectWorkflow(active, "XY")).toThrow(/changed/);
  await runCommand("project.startDrawing", { componentName: "Replaced" });
  const stale = useProjectWorkflow.getState().active!;
  useCadStore.getState().setDocument({ ...useCadStore.getState().history.present });
  expect(() => finishProjectWorkflow(stale, "XY")).toThrow(/changed/);
  expect(Object.keys(useCadStore.getState().history.present.components)).toHaveLength(1);
  expect(Object.keys(useCadStore.getState().history.present.sketches)).toHaveLength(0);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("requires a name in either first-part route and sends it through shared commands", () => {
  render(<ProjectStart context={{}} />);
  const name = screen.getByLabelText("Part name");
  expect(name).toHaveAttribute("maxlength", "120");
  fireEvent.change(name, { target: { value: " " } });
  expect(screen.getByRole("button", { name: "Draw a shape" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Describe a part with AI" })).toBeDisabled();
  fireEvent.change(name, { target: { value: "Bracket" } });
  fireEvent.click(screen.getByRole("button", { name: "Draw a shape" }));
  expect(useProjectWorkflow.getState().active?.partName).toBe("Bracket");
  cleanup();
  useProjectWorkflow.setState({ active: undefined });
  render(<ProjectStart context={{}} />);
  expect(screen.getByLabelText("Part name")).toHaveValue("Bracket");
  act(() => useCadStore.getState().setDocument(createEmptyDocument()));
  expect(screen.getByLabelText("Part name")).toHaveValue("Part 1");
});

it("keeps the drawing's edit target visible after selecting an entity", async () => {
  await runCommand("project.startDrawing", { componentName: "Bracket" });
  finishProjectWorkflow(useProjectWorkflow.getState().active!, "XY");
  const document = useCadStore.getState().history.present;
  useCadStore.getState().select({ kind: "sketchEntity", id: "entity", documentId: document.id });
  render(<WorkbenchBreadcrumb />);
  expect(screen.getByRole("navigation", { name: "Project location" })).toHaveTextContent("BracketSketch 1");
});

it("starts named New part AI without creating project data and retains that name in the proposal", async () => {
  useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, kernelReady: true } });
  const before = useCadStore.getState().history;
  beginPartDescription("Bracket");
  render(<AiDrawer />);
  expect(screen.getByRole("button", { name: "New part" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("What would you like to make?")).toHaveValue('Make a part named "Bracket". ');
  fireEvent.change(screen.getByLabelText("What would you like to make?"), { target: { value: "A 60 by 40 plate, 5 mm thick" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate preview" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
  const proposal = mocks.preview.mock.calls[0][0];
  expect(Object.values(proposal.components).map((component) => (component as { name: string }).name)).toContain("Bracket");
  expect(useCadStore.getState().history).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Cancel AI proposal" }));
  expect(useCadStore.getState().history).toBe(before);
  act(() => useAiDrawer.setState({ open: false }));
  expect(useAiDrawer.getState().namedPart).toBeUndefined();
});
