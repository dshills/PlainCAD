import { canUndoAiChange, recordAiHistoryChange } from "../ui/commands/aiHistoryState";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderSketchRefinementPanel } from "../ui/panels/ProviderSketchRefinementPanel";
import { SketchRefinementPanel } from "../ui/panels/SketchRefinementPanel";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useSketchRefinement } from "../ui/commands/sketchRefinementCommand";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { withCanvasDimension } from "../cad/sketch/canvasDimensions";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { aiSketchContext, type AiSketchProposal } from "../ai/sketchEditPlan";
import { prepareAiSketchRequest } from "../ai/sketchAiClient";
import type { AiMessage } from "../ai/conversation";
import type { RebuildResult } from "../cad/worker/workerProtocol";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), providers: vi.fn(), request: vi.fn() }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: mocks.preview }));
vi.mock("../ai/client", () => ({ fetchAiProviders: mocks.providers, requestJson: mocks.request }));
const resize: AiSketchProposal = { summary: "Resize the current rectangle", warnings: [], actions: [{ kind: "rectangle", width: "60mm", height: "40mm" }] };
function fixture(bound = false) {
  let sketch = addCornerRectangle(createXySketch("Editable"), "24mm", "16mm");
  let document = createEmptyDocument();
  if (bound) {
    const lineId = Object.values(sketch.entities).find((entity) => entity.type === "line")!.id;
    sketch = withCanvasDimension(sketch, { type: "length", refs: [lineId], expression: "width" });
    document = { ...document, parameters: { width: { id: "width_parameter", name: "width", expression: "24mm", unit: "mm", value: 24 } } };
  }
  useCadStore.getState().setDocument(upsertSketch(document, sketch));
  const state = useCadStore.getState();
  useCadStore.setState({ rebuild: { ...state.rebuild, kernelReady: true } });
  useSketchCanvas.setState({ active: { documentId: state.history.present.id, session: state.documentSession, sketchId: sketch.id }, selection: undefined });
  return sketch;
}
beforeEach(() => {
  useAiDrawer.setState({ open: true });
  useCadStore.setState(useCadStore.getInitialState(), true);
  useSketchRefinement.setState({ frame: undefined });
  fixture(); mocks.preview.mockReset(); mocks.preview.mockImplementation(rebuildDocument);
  mocks.providers.mockReset(); mocks.providers.mockResolvedValue([
    { id: "anthropic", label: "Anthropic", available: true, model: "configured-anthropic" },
    { id: "openai", label: "OpenAI", available: true, model: "configured-openai" },
    { id: "google", label: "Google", available: true, model: "configured-google" },
  ]);
  mocks.request.mockReset(); mocks.request.mockResolvedValue({ proposal: resize });
});
afterEach(() => vi.restoreAllMocks());
async function allow() {
  await waitFor(() => expect(screen.getByText("Configured model: configured-anthropic")).toBeVisible());
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "Make the rectangle 60 x 40 mm" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
it("keeps local refinement default, and requires explicit provider context consent before any sketch request", async () => {
  render(<SketchRefinementPanel />);
  expect(screen.getByLabelText("Sketch refinement method")).toHaveValue("local");
  expect(mocks.providers).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Sketch refinement method"), { target: { value: "provider" } });
  await waitFor(() => expect(screen.getByText("Configured model: configured-anthropic")).toBeVisible());
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "Make the rectangle 60 x 40 mm" } });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Generate AI sketch preview" })).toBeDisabled();
  expect(mocks.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  expect(mocks.request.mock.calls[0][0]).toBe("/api/ai/sketch");
  const body = mocks.request.mock.calls[0][2];
  expect(body).toMatchObject({ provider: "anthropic", model: "configured-anthropic", sketchContext: { bindingPolicy: "preserve" } });
  expect(body.sketchContext).not.toHaveProperty("features"); expect(body.sketchContext).not.toHaveProperty("meshes");
  expect(useCadStore.getState().history.past).toHaveLength(0);
  const original = useCadStore.getState().history.present;
  fireEvent.click(screen.getByRole("button", { name: "Apply AI sketch refinement" }));
  expect(useCadStore.getState().history.past).toHaveLength(1);
  await waitFor(() => expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("applied in one undo step"));
  expect(screen.getByLabelText("Provider sketch request")).toHaveFocus();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  act(() => useCadStore.getState().undo());
  expect(useCadStore.getState().history.present).toBe(original);
});

it("handles local history intent before provider consent without changing an active sketch", async () => {
  mocks.providers.mockResolvedValue([]);
  render(<ProviderSketchRefinementPanel />);
  const before = useCadStore.getState().history;
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "undo that" } });
  expect(screen.getByRole("button", { name: "Generate AI sketch preview" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("The latest AI change cannot be"));
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(useCadStore.getState().history).toBe(before);
});
it("shows clarification without Apply or worker calls, and carries bounded complete follow-up turns", async () => {
  mocks.request.mockResolvedValueOnce({ proposal: { summary: "Which width do you want?", warnings: [], actions: [] } }).mockResolvedValueOnce({ proposal: resize });
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("needs clarification"));
  expect(screen.getByText("Which width do you want?")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Apply AI sketch refinement" })).toBeNull();
  expect(mocks.preview).not.toHaveBeenCalled(); expect(useSketchRefinement.getState().frame).toBeUndefined();
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "60 mm width and 40 mm height" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  expect(mocks.request.mock.calls[1][2].history).toHaveLength(2);
  expect(mocks.request.mock.calls[1][2].history[1].content).toContain("Which width");
});
it("cancels a late provider response after same-ID document replacement and requires fresh consent", async () => {
  let resolve: ((value: unknown) => void) | undefined;
  mocks.request.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  const original = useCadStore.getState().history.present;
  act(() => useCadStore.getState().setDocument({ ...original }));
  await act(async () => resolve?.({ proposal: resize }));
  expect(mocks.preview).not.toHaveBeenCalled(); expect(useSketchRefinement.getState().frame).toBeUndefined();
  expect(screen.queryByRole("button", { name: "Apply AI sketch refinement" })).toBeNull();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("cancels a native preview when consent is revoked and ignores its late proof", async () => {
  let resolve: ((result: RebuildResult) => void) | undefined;
  mocks.preview.mockImplementation(() => new Promise<RebuildResult>((done) => { resolve = done; }));
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
  const staged = mocks.preview.mock.calls[0][0], result = await rebuildDocument(staged);
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async () => resolve?.(result));
  expect(screen.queryByRole("button", { name: "Apply AI sketch refinement" })).toBeNull();
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(useSketchRefinement.getState().frame).toBeUndefined();
});
it("requires explicit shared parameter choice, preserves the formula and discloses shared effects", async () => {
  const sketch = fixture(true);
  mocks.request.mockResolvedValue({ proposal: { summary: "Change shared width", warnings: ["Other parts using width will rebuild"], actions: [{ kind: "parameter", id: "width_parameter", expression: "36mm" }] } });
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("explicitly"));
  expect(mocks.preview).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("AI sketch binding policy"), { target: { value: "parameter:width_parameter" } });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  expect(screen.getByLabelText("AI proposed sketch changes")).toHaveTextContent("Shared parameter width");
  expect(screen.getByText(/may rebuild other sketches and parts/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Apply AI sketch refinement" }));
  const document = useCadStore.getState().history.present;
  expect(document.parameters.width.expression).toBe("36mm");
  expect(document.sketches[sketch.id].dimensions[0].expression.expression).toBe("width");
  expect(useCadStore.getState().history.past).toHaveLength(1);
});
it("switching configured provider clears conversation and requires new sharing consent", async () => {
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.change(screen.getByLabelText("Sketch AI provider"), { target: { value: "google" } });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByText("Configured model: configured-google")).toBeVisible();
  expect(screen.getByRole("button", { name: "Generate AI sketch preview" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  expect(mocks.request.mock.calls[0][2]).toMatchObject({ provider: "google", model: "configured-google", history: [] });
});
it("trims whole older conversation turns against the actual context request budget and rejects hostile provider actions", async () => {
  const state = useCadStore.getState(), sketchId = useSketchCanvas.getState().active!.sketchId;
  const context = aiSketchContext(state.history.present, sketchId, [], "preserve");
  const history = Array.from({ length: 4 }, (_, index) => [{ role: "user" as const, content: `${index}${"a".repeat(10000)}` }, { role: "assistant" as const, content: `${index}${"b".repeat(10000)}` }]).flat() as AiMessage[];
  const prepared = prepareAiSketchRequest("openai", "configured-openai", "Resize", history, context);
  expect(prepared.body.history).toEqual(history.slice(-2)); expect(prepared.omittedTurns).toBe(3);
  expect(new TextEncoder().encode(JSON.stringify(prepared.body)).byteLength).toBeLessThanOrEqual(32000);
  mocks.request.mockResolvedValue({ proposal: { summary: "Run code", warnings: [], actions: [{ kind: "script", code: "alert(1)" }] } });
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("unsupported"));
  expect(mocks.preview).not.toHaveBeenCalled(); expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("times out a provider request immediately and ignores a later reply without requiring its promise to settle", async () => {
  let resolve: ((value: unknown) => void) | undefined;
  let expire: (() => void) | undefined;
  const schedule = globalThis.setTimeout.bind(globalThis);
  vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => {
    if (delay === 120000) expire = () => { if (typeof handler === "function") handler(...args); };
    return schedule(handler, delay, ...args);
  });
  mocks.request.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  expect(expire).toBeDefined();
  act(() => expire?.());
  expect(screen.getByRole("alert")).toHaveTextContent("timed out");
  expect(useSketchRefinement.getState().frame).toBeUndefined();
  expect(screen.getByRole("button", { name: "Generate AI sketch preview" })).toBeEnabled();
  await act(async () => resolve?.({ proposal: resize }));
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Apply AI sketch refinement" })).toBeNull();
});
it("requires explicit dimension-formula replacement and leaves its shared project parameter intact", async () => {
  const sketch = fixture(true);
  mocks.request.mockResolvedValue({ proposal: { summary: "Change this dimension", warnings: [], actions: [{ kind: "dimension", id: sketch.dimensions[0].id, expression: "30mm" }] } });
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("parameter-bound"));
  fireEvent.change(screen.getByLabelText("AI sketch binding policy"), { target: { value: "replace" } });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  expect(mocks.request.mock.calls[1][2].sketchContext.bindingPolicy).toBe("replace");
  fireEvent.click(screen.getByRole("button", { name: "Apply AI sketch refinement" }));
  const document = useCadStore.getState().history.present;
  expect(document.parameters.width.expression).toBe("24mm");
  expect(document.sketches[sketch.id].dimensions[0].expression.expression).toBe("30mm");
});
it("returns focus to the request on Escape and Cancel after preview, without editing the project", async () => {
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  const apply = screen.getByRole("button", { name: "Apply AI sketch refinement" });
  apply.focus(); fireEvent.keyDown(apply, { key: "Escape" });
  expect(screen.getByLabelText("Provider sketch request")).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Apply AI sketch refinement" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Cancel AI sketch refinement" }));
  expect(screen.getByLabelText("Provider sketch request")).toHaveFocus();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("makes exact bounded context reviewable before consent", async () => {
  render(<ProviderSketchRefinementPanel />);
  await waitFor(() => expect(screen.getByText("Configured model: configured-anthropic")).toBeVisible());
  fireEvent.click(screen.getByText("Review data sent to the provider"));
  const shared = JSON.parse(screen.getByLabelText("Bounded sketch context").textContent!);
  expect(shared).toMatchObject({ bindingPolicy: "preserve", selectedIds: [] });
  expect(shared.geometry.length).toBeGreaterThan(0);
  expect(shared).not.toHaveProperty("features");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("reports unavailable provider configuration without leaving a loading message", async () => {
  mocks.providers.mockRejectedValue(new Error("Local server unavailable"));
  render(<ProviderSketchRefinementPanel />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Local server unavailable"));
  expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("configuration is unavailable");
  expect(screen.getByRole("option", { name: "Provider configuration unavailable" })).toBeInTheDocument();
  expect(screen.queryByText("Checking providers…")).toBeNull();
  expect(screen.getByRole("button", { name: "Generate AI sketch preview" })).toBeDisabled();
});
it("normalizes configured model and prompt before validating and sending them", () => {
  const state = useCadStore.getState(), sketchId = useSketchCanvas.getState().active!.sketchId;
  const context = aiSketchContext(state.history.present, sketchId, [], "preserve");
  expect(prepareAiSketchRequest("openai", " configured-model ", " Resize ", [], context).body).toMatchObject({ model: "configured-model", prompt: "Resize" });
});

it("expires sharing consent when the source changes before the first provider request", async () => {
  render(<ProviderSketchRefinementPanel />); await allow();
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(mocks.request).not.toHaveBeenCalled();
  act(() => useCadStore.getState().setDocument({ ...useCadStore.getState().history.present }));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Generate AI sketch preview" })).toBeDisabled();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("cancels a pending provider request when Escape is pressed on the method selector", async () => {
  let resolve: ((value: unknown) => void) | undefined;
  mocks.request.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<SketchRefinementPanel />);
  const method = screen.getByLabelText("Sketch refinement method");
  fireEvent.change(method, { target: { value: "provider" } });
  await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  expect(useSketchRefinement.getState().frame).toBeDefined();
  const providerMethod = screen.getByLabelText("Sketch refinement method");
  providerMethod.focus(); fireEvent.keyDown(providerMethod, { key: "Escape" });
  expect(useSketchRefinement.getState().frame).toBeUndefined();
  expect(screen.getByLabelText("Provider sketch request")).toHaveFocus();
  expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("canceled");
  await act(async () => resolve?.({ proposal: resize }));
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Apply AI sketch refinement" })).toBeNull();
});

it("retains complete turns after its own Apply and requires fresh consent for updated sketch context", async () => {
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Apply AI sketch refinement" }));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "Now make it 70 x 40 mm" } });
  expect(screen.getByRole("button", { name: "Generate AI sketch preview" })).toBeDisabled();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  expect(mocks.request.mock.calls[1][2].history).toHaveLength(2);
  expect(mocks.request.mock.calls[1][2].history[0].content).toContain("60 x 40");
  expect(mocks.request.mock.calls[1][2].sketchContext).not.toEqual(mocks.request.mock.calls[0][2].sketchContext);
});
it("clarifies short repair requests without a current failure or provider consent", async () => {
  render(<ProviderSketchRefinementPanel />);
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "fix that" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("Which issue should I fix");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("uses the current failed native request and bounded diagnostic for repair without applying automatically", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("Native downstream body is invalid"));
  render(<ProviderSketchRefinementPanel />); await allow();
  const original = useCadStore.getState().history.present;
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Native downstream body is invalid"));
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "repair this" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  expect(mocks.request.mock.calls[1][2].prompt).toContain("Make the rectangle 60 x 40 mm");
  expect(mocks.request.mock.calls[1][2].prompt).toContain("Native downstream body is invalid");
  expect(useCadStore.getState().history.present).toBe(original);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("forgets failed repair context after external sketch replacement", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("Bad native profile"));
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Bad native profile"));
  act(() => useCadStore.getState().setDocument({ ...useCadStore.getState().history.present }));
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "fix that" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("Which issue should I fix");
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("expires repair context and sharing consent when the canvas assistant is hidden", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("Bad native profile"));
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Bad native profile"));
  act(() => useAiDrawer.setState({ open: false }));
  act(() => useAiDrawer.setState({ open: true }));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "repair this" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("Which issue should I fix");
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("reports successful Apply separately when a changed canvas prevents retaining the conversation", async () => {
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  const original = useCadStore.getState().history.present;
  const unsubscribe = useCadStore.subscribe(state => {
    if (state.history.present !== original) useSketchCanvas.setState({ active: undefined });
  });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Apply AI sketch refinement" }));
    expect(useCadStore.getState().history.present).not.toBe(original);
    expect(useCadStore.getState().history.past).toHaveLength(1);
    expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("applied in one undo step");
    expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("conversation was reset");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  } finally { unsubscribe(); }
});

it("repeated repair uses the original request and latest diagnostic without nesting diagnostics", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("First invalid face")).mockRejectedValueOnce(new Error("Second invalid profile"));
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("First invalid face"));
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "fix that" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Second invalid profile"));
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "repair this" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI sketch refinement" })).toBeEnabled());
  expect(mocks.request.mock.calls[2][2].prompt).toContain("Make the rectangle 60 x 40 mm");
  expect(mocks.request.mock.calls[2][2].prompt).toContain("Second invalid profile");
  expect(mocks.request.mock.calls[2][2].prompt).not.toContain("First invalid face");
});

it("replaces a failed repair context when the provider successfully asks for clarification", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("Invalid original native body"));
  mocks.request.mockResolvedValueOnce({ proposal: resize }).mockResolvedValueOnce({ proposal: { summary: "Which rectangle dimension should change?", warnings: [], actions: [] } });
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid original native body"));
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "repair this" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("needs clarification"));
  expect(screen.getByText("Which rectangle dimension should change?")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "fix that" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("There is no current failed AI proposal");
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("blocks keyboard history and repair shortcuts during a file operation", async () => {
  render(<ProviderSketchRefinementPanel />);
  await waitFor(() => expect(screen.getByText("Configured model: configured-anthropic")).toBeVisible());
  act(() => {
    const state = useCadStore.getState(), original = state.history.present;
    state.updateDocument(document => ({ ...document, name: "Applied AI edit" }));
    recordAiHistoryChange(original, state.documentSession, "Applied AI edit");
    useSketchCanvas.setState({ active: undefined });
  });
  expect(canUndoAiChange(useCadStore.getState())).toBe(true);
  act(() => useCadStore.setState({ fileBusy: true }));
  const history = useCadStore.getState().history;
  const prompt = screen.getByLabelText("Provider sketch request");
  for (const text of ["undo that", "fix that"]) {
    fireEvent.change(prompt, { target: { value: text } });
    const status = screen.getByLabelText("Provider sketch refinement status").textContent;
    expect(screen.getByRole("button", { name: "Generate AI sketch preview" })).toBeDisabled();
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });
    expect(screen.getByLabelText("Provider sketch refinement status").textContent).toBe(status);
    expect(useCadStore.getState().history).toBe(history);
  }
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.preview).not.toHaveBeenCalled();
});

it("does not reuse an earlier failure after a new provider request times out", async () => {
  let expire: (() => void) | undefined;
  const schedule = globalThis.setTimeout.bind(globalThis);
  vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => {
    if (delay === 120000) {
      expire = () => { if (typeof handler === "function") handler(...args); };
      return schedule(() => {}, 0);
    }
    return schedule(handler, delay, ...args);
  });
  mocks.preview.mockRejectedValueOnce(new Error("Previous invalid native body"));
  mocks.request.mockResolvedValueOnce({ proposal: resize }).mockImplementationOnce(() => new Promise(() => {}));
  render(<ProviderSketchRefinementPanel />); await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Previous invalid native body"));
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "Now make the height 45mm" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(expire).toBeDefined();
  await act(async () => { expire?.(); await Promise.resolve(); });
  expect(screen.getByRole("alert")).toHaveTextContent("timed out");
  fireEvent.change(screen.getByLabelText("Provider sketch request"), { target: { value: "fix that" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Generate AI sketch preview" }));
    await Promise.resolve();
  });
  expect(screen.getByLabelText("Provider sketch refinement status")).toHaveTextContent("There is no current failed AI proposal");
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
