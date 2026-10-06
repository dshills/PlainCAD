import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { solidDimensions } from "../cad/inspection/solidDimensions";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { useCadStore } from "../state/useCadStore";
import { beginSolidDimensionEdit, cancelSolidDimensionEdit, useSolidDimensionEdit } from "../ui/commands/solidDimensionCommand";
import { SolidDimensionEditor } from "../ui/panels/SolidDimensionEditor";

vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
vi.mock("../viewer/ExtrudePreview", () => ({ ExtrudePreview: () => <div data-testid="dimension-preview">Mocked worker preview</div> }));
const jobs: Array<{ document: CadDocument; signal: AbortSignal; resolve: (result: RebuildResult) => void }> = [];
// These are deliberately simulated worker responses for UI/transaction guards.
// They are not native modeling evidence; the browser suite proves actual BRep.
function simulatedWorkerResult(document: CadDocument): RebuildResult {
  const result = rebuildDocument(document);
  for (const mesh of result.meshes) {
    mesh.geometrySource = "opencascade";
    mesh.kernelOperation = "extrusion";
    mesh.geometryAssertions = { valid: true, solidCount: 1, volume: 1, surfaceArea: 1 };
  }
  return result;
}
function fixture() {
  const document = createBoxTemplate();
  useCadStore.setState({ ...useCadStore.getInitialState(), history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId, rebuildNow: vi.fn(),
    rebuild: { status: "succeeded", kernelReady: true, result: simulatedWorkerResult(document) } }, true);
  const state = useCadStore.getState();
  const dimension = solidDimensions(state.history.present, state.rebuild.result!, { kind: "feature", id: document.features[0].id, documentId: document.id }, document.rootComponentId)[0];
  beginSolidDimensionEdit(dimension);
  render(<SolidDimensionEditor />);
  return { document: state.history.present, history: state.history, parameterId: document.parameters.depth.id };
}
async function finishJob(index: number) {
  await waitFor(() => expect(jobs.length).toBeGreaterThan(index));
  const job = jobs[index];
  await act(async () => { job.resolve(simulatedWorkerResult(job.document)); });
}
async function finishPreview(index = 0) {
  await finishJob(index);
  await finishJob(index + 1);
  await screen.findByText(/Native preview ready/);
}
beforeEach(() => {
  jobs.length = 0;
  cancelSolidDimensionEdit();
  vi.mocked(previewModeling).mockImplementation((document, signal) => new Promise((resolve) => jobs.push({ document, signal, resolve })));
});
afterEach(() => { cleanup(); cancelSolidDimensionEdit(); vi.clearAllMocks(); });

it("requires explicit edit target; shared parameter Apply retains the feature formula and saves one history step", async () => {
  const { document, history, parameterId } = fixture();
  const field = screen.getByLabelText("Dimension expression");
  const apply = screen.getByRole("button", { name: "Apply dimension" });
  expect(field).toBeDisabled();
  expect(field).toHaveValue("depth");
  expect(apply).toBeDisabled();
  expect(jobs).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Dimension edit target"), { target: { value: parameterId } });
  expect(field).toHaveValue("20mm");
  fireEvent.change(field, { target: { value: "25mm" } });
  expect(screen.getByText(/Shared uses of this parameter/)).toBeVisible();
  await finishPreview();
  expect(useCadStore.getState().history).toBe(history);
  expect(useCadStore.getState().history.present).toBe(document);
  fireEvent.click(apply);
  expect(useSolidDimensionEdit.getState().frame).toBeUndefined();
  const state = useCadStore.getState();
  expect(state.history.past).toHaveLength(1);
  expect(state.history.present.parameters.depth).toMatchObject({ id: parameterId, expression: "25mm" });
  const feature = state.history.present.features[0];
  if (feature.type !== "extrude") throw new Error("Expected box extrusion");
  expect(feature.distance).toMatchObject({ expression: "depth", parameterRefs: { depth: parameterId } });
});
it("explicit feature replacement retains shared parameters and rebinds the replacement formula", async () => {
  const { parameterId } = fixture();
  fireEvent.change(screen.getByLabelText("Dimension edit target"), { target: { value: "feature" } });
  fireEvent.change(screen.getByLabelText("Dimension expression"), { target: { value: "depth + 5mm" } });
  await finishPreview();
  fireEvent.click(screen.getByRole("button", { name: "Apply dimension" }));
  const document = useCadStore.getState().history.present;
  expect(document.parameters.depth.expression).toBe("20mm");
  const feature = document.features[0];
  if (feature.type !== "extrude") throw new Error("Expected box extrusion");
  expect(feature.distance).toMatchObject({ expression: "depth + 5mm", parameterRefs: { depth: parameterId } });
  expect(useCadStore.getState().history.past).toHaveLength(1);
});
it("rejects invalid and unchanged inputs before invoking a worker", async () => {
  const { history } = fixture();
  fireEvent.change(screen.getByLabelText("Dimension edit target"), { target: { value: "feature" } });
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("changed value");
  for (const expression of ["0mm", "missing_parameter", "5deg"]) {
    fireEvent.change(screen.getByLabelText("Dimension expression"), { target: { value: expression } });
    await waitFor(() => expect(screen.getByRole("alert")).not.toHaveTextContent("changed value"));
    expect(screen.getByRole("button", { name: "Apply dimension" })).toBeDisabled();
  }
  expect(jobs).toHaveLength(0);
  expect(useCadStore.getState().history).toBe(history);
});
it("Cancel aborts pending preview and a late mocked response cannot save geometry", async () => {
  const { history } = fixture();
  fireEvent.change(screen.getByLabelText("Dimension edit target"), { target: { value: "feature" } });
  fireEvent.change(screen.getByLabelText("Dimension expression"), { target: { value: "25mm" } });
  await waitFor(() => expect(jobs).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(jobs[0].signal.aborted).toBe(true);
  await finishJob(0);
  // This mock deliberately ignores abort; guard still rejects the old frame.
  if (jobs.length > 1) await finishJob(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useCadStore.getState().history).toBe(history);
});
it("latest input wins even when the worker ignores abort and responds out of order", async () => {
  const { history } = fixture();
  fireEvent.change(screen.getByLabelText("Dimension edit target"), { target: { value: "feature" } });
  const input = screen.getByLabelText("Dimension expression");
  fireEvent.change(input, { target: { value: "30mm" } });
  await waitFor(() => expect(jobs).toHaveLength(1));
  fireEvent.change(input, { target: { value: "25mm" } });
  await waitFor(() => expect(jobs).toHaveLength(2));
  expect(jobs[0].signal.aborted).toBe(true);
  await finishJob(1);
  await finishJob(2);
  await screen.findByText(/Native preview ready/);
  await finishJob(0);
  if (jobs.length > 3) await finishJob(3);
  expect(input).toHaveValue("25mm");
  expect(screen.getByRole("button", { name: "Apply dimension" })).toBeEnabled();
  expect(useCadStore.getState().history).toBe(history);
  fireEvent.click(screen.getByRole("button", { name: "Apply dimension" }));
  const feature = useCadStore.getState().history.present.features[0];
  if (feature.type !== "extrude") throw new Error("Expected box extrusion");
  expect(feature.distance.expression).toBe("25mm");
});
it("same-ID document replacement invalidates the reviewed preview and prevents Apply", async () => {
  const { document } = fixture();
  fireEvent.change(screen.getByLabelText("Dimension edit target"), { target: { value: "feature" } });
  fireEvent.change(screen.getByLabelText("Dimension expression"), { target: { value: "25mm" } });
  await finishPreview();
  const replacement = { ...document, name: "Replaced same-ID project" };
  act(() => useCadStore.setState({ history: { past: [], present: replacement, future: [] } }));
  expect(screen.getByRole("status")).toHaveTextContent("Project changed");
  expect(screen.getByRole("button", { name: "Apply dimension" })).toBeDisabled();
  expect(screen.getByLabelText("Dimension expression")).toBeDisabled();
  expect(useCadStore.getState().history.present).toBe(replacement);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("replacement of the reviewed rebuild result disables Apply even when document identity is unchanged", async () => {
  fixture();
  fireEvent.change(screen.getByLabelText("Dimension edit target"), { target: { value: "feature" } });
  fireEvent.change(screen.getByLabelText("Dimension expression"), { target: { value: "25mm" } });
  await finishPreview();
  const state = useCadStore.getState(), history = state.history;
  act(() => useCadStore.setState({ rebuild: { ...state.rebuild, result: { ...state.rebuild.result! } } }));
  expect(screen.getByRole("button", { name: "Apply dimension" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Project changed");
  expect(useCadStore.getState().history).toBe(history);
});
