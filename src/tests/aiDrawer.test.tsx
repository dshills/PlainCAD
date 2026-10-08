import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiDrawer } from "../ui/panels/AiDrawer";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { useCadStore } from "../state/useCadStore";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { buildAiPlan } from "../ai/buildPlan";
import { aiPlatePlan } from "./fixtures/aiPlan";
import { separatePartsPlan } from "./fixtures/aiTargetsPlan";
import * as clarificationTargets from "../ai/clarificationTargets";
import { useOperationDrop } from "../ui/commands/operationDropCommand";
import {
  beginExtrudeCreation,
  useExtrudeDraft,
} from "../ui/commands/extrudeCommand";
import {
  beginModelingCreation,
  useModelingDraft,
} from "../ui/commands/modelingDraftCommand";
import {
  currentGeometryHighlight,
  useGeometryHighlight,
} from "../state/useGeometryHighlight";
const mocks = vi.hoisted(() => ({
  providers: vi.fn(),
  request: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("../ai/client", () => ({
  fetchAiProviders: mocks.providers,
  requestAiPlan: mocks.request,
}));
vi.mock("../cad/worker/extrudePreviewClient", () => ({
  previewModeling: mocks.preview,
}));
vi.mock("../viewer/ExtrudePreview", () => ({
  ExtrudePreview: () => <div>Preview display</div>,
}));
// Controlled accepted source; native geometry is verified by the browser suites.
function acceptSource() {
  const state = useCadStore.getState();
  useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true,
    result: { documentId: state.history.present.id, success: true, meshes: [], bodies: [], errors: [], warnings: [], durationMs: 0 } } });
}
beforeEach(() => {
  useOperationDrop.setState({ frame: undefined });
  useExtrudeDraft.setState({ draft: undefined });
  useModelingDraft.setState({ draft: undefined });
  useGeometryHighlight.setState({ highlight: undefined });
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.getState().setDocument(createEmptyDocument());
  acceptSource();
  useAiDrawer.setState({ open: true });
  mocks.providers.mockResolvedValue(
    ["anthropic", "openai", "google"].map((id) => ({
      id,
      label: id,
      model: "test-model",
      available: true,
    })),
  );
  mocks.request.mockResolvedValue(aiPlatePlan);
});
afterEach(() => {
  useOperationDrop.setState({ frame: undefined });
  useExtrudeDraft.setState({ draft: undefined });
  useModelingDraft.setState({ draft: undefined });
  useGeometryHighlight.setState({ highlight: undefined });
  useAiDrawer.setState({ open: false });
  vi.clearAllMocks();
});
it("aborts a pending native preview on same-ID project replacement and ignores late fallback geometry", async () => {
  let job:
    | {
        document: CadDocument;
        signal: AbortSignal;
        resolve: (result: RebuildResult) => void;
      }
    | undefined;
  mocks.preview.mockImplementation(
    (document: CadDocument, signal: AbortSignal) =>
      new Promise<RebuildResult>((resolve) => {
        job = { document, signal, resolve };
      }),
  );
  render(<AiDrawer />);
  fireEvent.change(screen.getByLabelText("What would you like to make?"), {
    target: { value: "A plate" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Generate preview" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await waitFor(() => expect(job).toBeDefined());
  act(() =>
    useCadStore.getState().setDocument(useCadStore.getState().history.present),
  );
  expect(job!.signal.aborted).toBe(true);
  await act(async () => job!.resolve(rebuildDocument(job!.document)));
  expect(
    screen.getByRole("button", { name: "Apply AI component" }),
  ).toBeDisabled();
  expect(useCadStore.getState().history.present.features).toHaveLength(0);
  expect(useCadStore.getState().history.past).toHaveLength(0);
});
it("aborts a provider request when closed and does not start a worker for its late response", async () => {
  let signal: AbortSignal | undefined,
    resolve: (value: typeof aiPlatePlan) => void = () => {};
  mocks.request.mockImplementation(
    (_provider, _model, _prompt, _history, requestSignal) =>
      new Promise((done) => {
        signal = requestSignal;
        resolve = done;
      }),
  );
  render(<AiDrawer />);
  fireEvent.change(screen.getByLabelText("What would you like to make?"), {
    target: { value: "A plate" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Generate preview" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await waitFor(() => expect(signal).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Close AI drawer" }));
  expect(signal!.aborted).toBe(true);
  await act(async () => resolve(aiPlatePlan));
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Open AI drawer" }),
  ).toHaveAttribute("aria-expanded", "false");
});
it("reports unconfigured providers and keeps generation disabled", async () => {
  mocks.providers.mockResolvedValue(
    ["anthropic", "openai", "google"].map((id) => ({
      id,
      label: id,
      model: "test-model",
      available: false,
    })),
  );
  render(<AiDrawer />);
  await screen.findByText(/No AI keys are configured/);
  fireEvent.change(screen.getByLabelText("What would you like to make?"), {
    target: { value: "A plate" },
  });
  expect(
    screen.getByRole("button", { name: "Generate preview" }),
  ).toBeDisabled();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("shares button and keyboard availability when the model or provider configuration is invalid", async () => {
  render(<AiDrawer />);
  const input = screen.getByLabelText("What would you like to make?");
  fireEvent.change(input, { target: { value: "A plate" } });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Generate preview" }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("AI model"), {
    target: { value: "" },
  });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(
    screen.getByRole("button", { name: "Generate preview" }),
  ).toBeDisabled();
  expect(mocks.request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("AI model"), {
    target: { value: "test-model" },
  });
  mocks.providers.mockRejectedValue(new Error("Configuration is unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh providers" }));
  await screen.findByText("Configuration is unavailable");
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  expect(mocks.request).not.toHaveBeenCalled();
});
it("preserves a custom model on refresh and reopening the drawer", async () => {
  render(<AiDrawer />);
  const model = screen.getByLabelText("AI model");
  await waitFor(() => expect(model).toHaveValue("test-model"));
  fireEvent.change(model, { target: { value: "custom-model" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh providers" }));
  await waitFor(() => expect(mocks.providers).toHaveBeenCalledTimes(2));
  expect(model).toHaveValue("custom-model");
  fireEvent.click(screen.getByRole("button", { name: "Close AI drawer" }));
  fireEvent.click(screen.getByRole("button", { name: "Open AI drawer" }));
  await waitFor(() => expect(mocks.providers).toHaveBeenCalledTimes(3));
  expect(screen.getByLabelText("AI model")).toHaveValue("custom-model");
});

function selectedPlate() {
  const staged = buildAiPlan(createEmptyDocument(), aiPlatePlan);
  useCadStore.getState().setDocument(staged.document);
  useCadStore.getState().activateComponent(staged.componentId);
  const feature = staged.document.features.find(
    (f) => f.type === "extrude" && f.operation === "newBody",
  )!;
  useCadStore.getState().select({
    kind: "feature",
    id: feature.id,
    documentId: staged.document.id,
  });
  acceptSource();
  return { staged, feature };
}
it("scope buttons clarify an existing-part request before any provider call", async () => {
  render(<AiDrawer />);
  await waitFor(() =>
    expect(screen.getByLabelText("AI model")).toHaveValue("test-model"),
  );
  expect(screen.getByRole("button", { name: "New part" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.change(screen.getByLabelText("What would you like to make?"), {
    target: { value: "Make this thicker" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  expect(screen.getByLabelText("AI clarification")).toHaveTextContent(
    "choose This part or Selected feature",
  );
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.preview).not.toHaveBeenCalled();
});
it("previews a selected extrusion's exact thickness locally even without configured providers", async () => {
  const { feature } = selectedPlate();
  mocks.providers.mockResolvedValue([
    {
      id: "anthropic",
      label: "Anthropic",
      model: "test-model",
      available: false,
    },
  ]);
  mocks.preview.mockImplementation(() => new Promise(() => {}));
  render(<AiDrawer />);
  fireEvent.click(screen.getByRole("button", { name: "Selected feature" }));
  fireEvent.change(screen.getByLabelText("What would you like to make?"), {
    target: { value: "Make this thicker to 8 mm" },
  });
  expect(screen.getByLabelText("AI edit target")).toHaveTextContent(
    `${feature.name} → distance`,
  );
  await screen.findByText(/No AI keys are configured/);
  expect(
    screen.getByRole("button", { name: "Generate preview" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
  const edited = mocks.preview.mock.calls[0][0] as CadDocument;
  expect(edited.features.find((f) => f.id === feature.id)).toMatchObject({
    distance: { expression: "8mm", unit: "mm" },
  });
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Apply AI feature edits" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel AI proposal" }));
  expect((mocks.preview.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
});
it("asks for a dimension when thickness is locked and previews only the user's chosen field", async () => {
  const { staged } = selectedPlate();
  const thickness = Object.values(staged.document.parameters).find((p) =>
    p.name.endsWith("_thickness"),
  )!;
  useCadStore.getState().updateDocument((d) => ({
    ...d,
    parameters: {
      ...d.parameters,
      [thickness.name]: { ...thickness, locked: true },
    },
  }));
  acceptSource();
  const width = Object.values(staged.document.parameters).find((p) =>
    p.name.endsWith("_width"),
  )!;
  const before = useCadStore.getState().history.present;
  mocks.preview.mockImplementation(() => new Promise(() => {}));
  render(<AiDrawer />);
  await waitFor(() =>
    expect(screen.getByLabelText("AI model")).toHaveValue("test-model"),
  );
  fireEvent.click(screen.getByRole("button", { name: "This part" }));
  fireEvent.change(screen.getByLabelText("What would you like to make?"), {
    target: { value: "Make this thicker to 8 mm" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  expect(screen.getByLabelText("AI clarification")).toHaveTextContent(
    "Which dimension",
  );
  expect(mocks.request).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", {
      name: `Change ${thickness.name} (${thickness.value}mm)`,
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Change width (60mm)",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
  const edited = mocks.preview.mock.calls[0][0] as CadDocument;
  expect(edited.parameters[width.name].expression).toBe("8mm");
  expect(edited.parameters[thickness.name]).toEqual(
    before.parameters[thickness.name],
  );
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects a provider changing another field after resolving a selected-feature request", async () => {
  selectedPlate();
  mocks.request.mockResolvedValue({
    name: "Wrong target",
    summary: "Wrong field",
    warnings: [],
    steps: [],
    parameters: [{ name: "diameter", value: 8, unit: "mm" }],
  });
  render(<AiDrawer />);
  await waitFor(() =>
    expect(screen.getByLabelText("AI model")).toHaveValue("test-model"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Selected feature" }));
  fireEvent.change(screen.getByLabelText("What would you like to make?"), {
    target: { value: "Make this thicker" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await screen.findByText(/This request can change only distance/);
  expect(
    mocks.request.mock.calls[0][5].parameters.map(
      (p: { name: string }) => p.name,
    ),
  ).toEqual(["distance"]);
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("shows distinct candidate geometry without changing scope, selection or history and clears stale highlights", async () => {
  const staged = buildAiPlan(createEmptyDocument(), separatePartsPlan);
  useCadStore.getState().setDocument(staged.document);
  useCadStore.getState().activateComponent(staged.componentId);
  const result = rebuildDocument(staged.document);
  useCadStore.setState({
    rebuild: { result, status: "succeeded", kernelReady: true },
  });
  useCadStore.getState().select({
    kind: "feature",
    id: staged.document.features[0].id,
    documentId: staged.document.id,
  });
  const before = useCadStore.getState();
  render(<AiDrawer />);
  fireEvent.click(screen.getByRole("button", { name: "This part" }));
  fireEvent.change(screen.getByLabelText("What would you like to make?"), {
    target: { value: "Make this thicker to 8mm" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  const width = screen.getByRole("button", { name: "Show geometry for width" });
  fireEvent.click(width);
  expect(currentGeometryHighlight(useCadStore.getState())?.bodyIds).toEqual([
    result.meshes[0].bodyId,
  ]);
  expect(width).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(
    screen.getByRole("button", { name: "Show geometry for depth" }),
  );
  expect(currentGeometryHighlight(useCadStore.getState())?.bodyIds).toEqual([
    result.meshes[1].bodyId,
  ]);
  expect(useCadStore.getState().selection).toBe(before.selection);
  expect(useCadStore.getState().history).toBe(before.history);
  expect(screen.getByRole("button", { name: "This part" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.preview).not.toHaveBeenCalled();
  act(() =>
    useCadStore.setState({
      rebuild: { ...useCadStore.getState().rebuild, status: "queued" },
    }),
  );
  expect(currentGeometryHighlight(useCadStore.getState())).toBeUndefined();
  expect(
    screen.getByRole("button", { name: "Show geometry for depth" }),
  ).toBeDisabled();
  act(() =>
    useCadStore.setState({
      rebuild: { ...useCadStore.getState().rebuild, status: "succeeded" },
    }),
  );
  expect(currentGeometryHighlight(useCadStore.getState())).toBeUndefined();
  fireEvent.click(
    screen.getByRole("button", { name: "Show geometry for depth" }),
  );
  expect(currentGeometryHighlight(useCadStore.getState())?.bodyIds).toEqual([
    result.meshes[1].bodyId,
  ]);
  act(() => useCadStore.setState({ fileBusy: true }));
  expect(currentGeometryHighlight(useCadStore.getState())).toBeUndefined();
  act(() => useCadStore.setState({ fileBusy: false }));
  expect(currentGeometryHighlight(useCadStore.getState())).toBeUndefined();
  fireEvent.click(
    screen.getByRole("button", { name: "Show geometry for depth" }),
  );
  act(() =>
    useCadStore.getState().select({
      kind: "body",
      id: result.meshes[0].bodyId,
      documentId: staged.document.id,
    }),
  );
  expect(currentGeometryHighlight(useCadStore.getState())).toBeUndefined();
  fireEvent.click(
    screen.getByRole("button", { name: "Show geometry for depth" }),
  );
  act(() =>
    useCadStore.getState().select({
      kind: "body",
      id: result.meshes[1].bodyId,
      documentId: staged.document.id,
    }),
  );
  expect(currentGeometryHighlight(useCadStore.getState())).toBeUndefined();
});

it("keeps bounded dimension choice and an actionable message when related-geometry tracing fails", async () => {
  const { staged } = selectedPlate();
  const thickness = Object.values(staged.document.parameters).find((p) =>
    p.name.endsWith("_thickness"),
  )!;
  useCadStore.getState().updateDocument((d) => ({
    ...d,
    parameters: {
      ...d.parameters,
      [thickness.name]: { ...thickness, locked: true },
    },
  }));
  acceptSource();
  const trace = vi
    .spyOn(clarificationTargets, "aiClarificationTargets")
    .mockImplementation(() => {
      throw new Error("Dependency trace unavailable");
    });
  try {
    render(<AiDrawer />);
    fireEvent.click(screen.getByRole("button", { name: "This part" }));
    fireEvent.change(screen.getByLabelText("What would you like to make?"), {
      target: { value: "Make this thicker to 8mm" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
    expect(screen.getByLabelText("AI clarification")).toHaveTextContent(
      "Related geometry is unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Show geometry for width" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Change thickness (5mm)" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Change width (60mm)" }),
    );
    expect(screen.getByLabelText("AI edit target")).toHaveTextContent(
      "ai_1_width",
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  } finally {
    trace.mockRestore();
  }
});

it("clears read-only AI hints and disables generation throughout an operation picker and both target-bound native forms", async () => {
  const staged = buildAiPlan(createEmptyDocument(), separatePartsPlan);
  useCadStore.getState().setDocument(staged.document);
  useCadStore.getState().activateComponent(staged.componentId);
  const result = rebuildDocument(staged.document);
  useCadStore.setState({
    rebuild: { result, status: "succeeded", kernelReady: true },
  });
  const state = useCadStore.getState();
  render(<AiDrawer />);
  fireEvent.click(screen.getByRole("button", { name: "This part" }));
  fireEvent.change(screen.getByLabelText("What would you like to make?"), {
    target: { value: "Make this thicker to 8mm" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Show geometry for depth" }),
  );
  expect(currentGeometryHighlight(useCadStore.getState())?.bodyIds).toEqual([
    result.meshes[1].bodyId,
  ]);
  // Runtime task-lifecycle fixture; native target validity is covered in Chromium.
  act(() =>
    useOperationDrop.setState({
      frame: {
        id: "picker",
        operation: "extrude",
        document: staged.document,
        result,
        session: state.documentSession,
        componentId: staged.componentId,
      },
    }),
  );
  expect(currentGeometryHighlight(useCadStore.getState())).toBeUndefined();
  expect(
    screen.getByRole("button", { name: "Show geometry for depth" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Generate preview" }),
  ).toBeDisabled();
  const first = staged.document.features[0];
  if (first.type !== "extrude") throw new Error("Fixture requires extrusion");
  act(() => {
    beginExtrudeCreation(first.sketchId, {
      profileId: result.profiles![first.sketchId][0].id,
      snapshot: result,
    });
    useOperationDrop.setState({ frame: undefined });
  });
  expect(useExtrudeDraft.getState().draft?.targetSnapshot).toBe(result);
  expect(
    screen.getByRole("button", { name: "Generate preview" }),
  ).toBeDisabled();
  act(() => {
    beginModelingCreation(
      {
        ...first,
        type: "fillet",
        targetEdgeRefs: [],
        radius: { expression: "1mm", unit: "mm" },
      },
      result,
    );
    useExtrudeDraft.setState({ draft: undefined });
  });
  expect(
    screen.getByRole("button", { name: "Generate preview" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Show geometry for depth" }),
  ).toBeDisabled();
  act(() => useModelingDraft.setState({ draft: undefined }));
  expect(
    screen.getByRole("button", { name: "Generate preview" }),
  ).toBeEnabled();
  expect(currentGeometryHighlight(useCadStore.getState())).toBeUndefined();
  expect(useCadStore.getState().history).toBe(state.history);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.preview).not.toHaveBeenCalled();
});

it("waits for the current accepted source before generating a new native proposal", async () => {
  render(<AiDrawer />);
  fireEvent.change(screen.getByLabelText("What would you like to make?"), { target: { value: "Make a plate" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate preview" })).toBeEnabled());
  act(() => useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, status: "queued" } }));
  const generate = screen.getByRole("button", { name: "Generate preview" });
  expect(generate).toBeDisabled();
  expect(screen.getByLabelText("AI source readiness")).toHaveTextContent("Waiting for the current native rebuild");
  fireEvent.keyDown(screen.getByLabelText("What would you like to make?"), { key: "Enter", ctrlKey: true });
  expect(mocks.request).not.toHaveBeenCalled();
  act(() => useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, status: "succeeded" } }));
  expect(generate).toBeEnabled();
  expect(screen.queryByLabelText("AI source readiness")).toBeNull();
});
