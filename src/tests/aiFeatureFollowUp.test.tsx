import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { useCadStore } from "../state/useCadStore";
import { AiFeatureAdditionPanel } from "../ui/panels/AiFeatureAdditionPanel";
const mocks = vi.hoisted(() => ({ providers: vi.fn(), request: vi.fn(), preview: vi.fn(), lost: false }));
vi.mock("../ai/client", () => ({ fetchAiProviders: mocks.providers }));
vi.mock("../ai/featureAddAiClient", () => ({
  prepareAiFeatureAddRequest: (provider: string, model: string, prompt: string, messages: unknown[], context: unknown) => ({ provider, model, prompt, history: messages, context }),
  requestAiFeatureAddProposal: mocks.request,
}));
vi.mock("../ai/featureAddPlan", () => ({ buildAiFeatureAddition: (document: unknown) => ({ document, features: [{ id: "hole", name: "Hole", type: "hole" }] }) }));
vi.mock("../ui/commands/useCommandEnablement", () => ({ useCommandEnablement: () => ({ editProject: true }) }));
vi.mock("../ui/panels/AiCanvasPreviewControls", () => ({ AiCanvasPreviewControls: () => null }));
vi.mock("../ui/commands/facePocketCommand", () => ({ facePocketFaces: () => mocks.lost ? [] : [{ id: "cap", label: "Plate cap", bodyId: "body" }] }));
vi.mock("../state/aiCanvasPreview", async () => {
  const { create } = await import("zustand");
  const useAiCanvasPreview = create<{ preview?: unknown }>(() => ({}));
  return { useAiCanvasPreview, clearAiCanvasPreview: () => useAiCanvasPreview.setState({ preview: undefined }), currentAiCanvasPreview: () => true,
    publishAiCanvasPreview: (preview: unknown) => { useAiCanvasPreview.setState({ preview }); return true; } };
});
vi.mock("../ui/commands/aiFeatureAdditionCommand", async () => {
  const { create } = await import("zustand"), { useCadStore } = await import("../state/useCadStore");
  const useAiFeatureAddition = create<{ frame?: unknown }>(() => ({}));
  return { useAiFeatureAddition,
    captureAiFeatureAddition: (faceId: string) => {
      const state = useCadStore.getState();
      if (faceId !== "cap" || mocks.lost || state.rebuild.status !== "succeeded") throw new Error("Choose a current supported native face.");
      return { document: state.history.present, result: state.rebuild.result, session: state.documentSession, componentId: state.activeComponentId, selection: JSON.stringify(state.selection.selectedIds), choice: { id: "cap", bodyId: "body" } };
    },
    currentAiFeatureAddition: (frame: { document: unknown; result: unknown }) => frame.document === useCadStore.getState().history.present && frame.result === useCadStore.getState().rebuild.result && !mocks.lost,
    featureAdditionContext: (frame: { document: unknown }) => ({ document: frame.document }), previewAiFeatureAddition: mocks.preview,
    applyAiFeatureAddition: () => {
      const state = useCadStore.getState();
      state.updateDocument(document => ({ ...document, name: "Cut plate" }));
      useAiFeatureAddition.setState({ frame: undefined });
    },
  };
});
function ready() { const state = useCadStore.getState(); useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: { documentId: state.history.present.id, success: true, meshes: [], bodies: [], errors: [], warnings: [], durationMs: 0 } } }); }
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true); useCadStore.getState().setDocument(createEmptyDocument()); ready();
  mocks.lost = false; mocks.providers.mockReset(); mocks.providers.mockResolvedValue([{ id: "anthropic", label: "Anthropic", available: true, model: "model" }]);
  mocks.request.mockReset(); mocks.request.mockResolvedValue({ summary: "Add a hole", warnings: [], actions: [{ kind: "holes" }] });
  mocks.preview.mockReset(); mocks.preview.mockResolvedValue({ result: { meshes: [] }, before: 1000, volume: 990 });
});
async function allow() {
  render(<AiFeatureAdditionPanel />);
  await waitFor(() => expect(screen.getByText("Configured model: model")).toBeVisible());
  fireEvent.change(screen.getByLabelText("Feature target face"), { target: { value: "cap" } });
  fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "Add a mounting hole" } });
  fireEvent.click(screen.getByRole("checkbox"));
}
async function generate() { fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" })); await waitFor(() => expect(screen.getByRole("button", { name: "Apply AI feature plan" })).toBeEnabled()); }
it("retains turns on the identical rebuilt face and requires fresh consent", async () => {
  await allow(); await generate();
  fireEvent.click(screen.getByRole("button", { name: "Apply AI feature plan" }));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for rebuilt native geometry");
  act(() => { const state = useCadStore.getState(); useCadStore.setState({ rebuild: { ...state.rebuild, status: "rebuilding" } }); });
  expect(screen.getByRole("status")).not.toHaveTextContent("same native face is ready");
  act(ready);
  expect(screen.getByRole("status")).toHaveTextContent("same native face is ready");
  fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "Now add a pocket" } });
  expect(screen.getByRole("button", { name: "Generate AI feature preview" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox")); await generate();
  expect(mocks.request.mock.calls[1][3]).toHaveLength(2);
  expect(mocks.request.mock.calls[1][4]).not.toEqual(mocks.request.mock.calls[0][4]);
});
it("does not guess a replacement face after Apply", async () => {
  await allow(); await generate();
  fireEvent.click(screen.getByRole("button", { name: "Apply AI feature plan" }));
  mocks.lost = true; act(ready);
  expect(screen.getByRole("status")).toHaveTextContent("target face is no longer supported");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("clarifies fix that without a failure before sharing consent", async () => {
  render(<AiFeatureAdditionPanel />);
  fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "fix that" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
  expect(screen.getByRole("status")).toHaveTextContent("Which issue should I fix");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("repairs the original request with its latest failure without automatically applying", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("First invalid cut")).mockRejectedValueOnce(new Error("Second invalid cut"));
  await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("First invalid cut"));
  fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "fix that" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Second invalid cut"));
  fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "repair this" } }); await generate();
  expect(mocks.request.mock.calls[2][2]).toContain("Add a mounting hole");
  expect(mocks.request.mock.calls[2][2]).toContain("Second invalid cut");
  expect(mocks.request.mock.calls[2][2]).not.toContain("First invalid cut");
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("expires failed repair context and consent after an external part edit", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("Invalid old face cut"));
  await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid old face cut"));
  act(() => useCadStore.getState().updateDocument(document => ({ ...document, name: "Manual edit" })));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "fix that" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
  expect(screen.getByRole("status")).toHaveTextContent("Which issue should I fix");
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("forgets an old cut failure after a successful clarification response", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("Invalid original native cut"));
  mocks.request.mockResolvedValueOnce({ summary: "Add a hole", warnings: [], actions: [{ kind: "holes" }] }).mockResolvedValueOnce({ summary: "Where should the mounting hole go?", warnings: [], actions: [] });
  await allow();
  fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid original native cut"));
  fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "repair this" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("needs clarification"));
  expect(screen.getByText("Where should the mounting hole go?")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "fix that" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
  expect(screen.getByRole("status")).toHaveTextContent("There is no current failed AI proposal");
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("does not reuse an old native failure after a new provider request times out", async () => {
  let expire: (() => void) | undefined;
  const schedule = globalThis.setTimeout.bind(globalThis);
  const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => {
    if (delay === 120000) {
      expire = () => { if (typeof handler === "function") handler(...args); };
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }
    return schedule(handler, delay, ...args);
  });
  try {
    mocks.preview.mockRejectedValueOnce(new Error("Invalid original native cut"));
    await allow();
    fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid original native cut"));
    mocks.request.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "Add a different pocket" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    expect(expire).toBeTypeOf("function");
    await act(async () => { expire!(); });
    expect(screen.getByRole("alert")).toHaveTextContent("Feature request timed out");
    expect(mocks.request.mock.calls[1][5].aborted).toBe(true);
    fireEvent.change(screen.getByLabelText("Feature request"), { target: { value: "fix that" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Generate AI feature preview" })); });
    expect(screen.getByRole("status")).toHaveTextContent("There is no current failed AI proposal");
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Apply AI feature plan" })).not.toBeInTheDocument();
    expect(useCadStore.getState().history.past).toHaveLength(0);
  } finally {
    timer.mockRestore();
  }
});
