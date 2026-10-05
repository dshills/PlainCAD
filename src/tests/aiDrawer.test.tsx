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
import { aiPlatePlan } from "./fixtures/aiPlan";
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
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.getState().setDocument(createEmptyDocument());
  useCadStore.setState({
    rebuild: { ...useCadStore.getState().rebuild, kernelReady: true },
  });
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
