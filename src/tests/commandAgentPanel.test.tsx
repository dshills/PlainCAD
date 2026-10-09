import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { useCadStore } from "../state/useCadStore";
import { useCommandPlan } from "../state/commandPlanState";
import { bindCommand, configureCommandRuntime } from "../commands/registry";
const mocks = vi.hoisted(() => ({ request: vi.fn(), capture: vi.fn(), preview: vi.fn(), cancel: vi.fn(), mark: vi.fn() }));
vi.mock("../ai/client", () => ({ fetchAiProviders: async () => [{ id: "anthropic", label: "Anthropic", available: true, model: "test-model" }] }));
vi.mock("../ai/commandAgentClient", () => ({ captureCommandAgentContext: mocks.capture, requestCommandAgentProposal: mocks.request }));
vi.mock("../commands/commandPlans", () => ({ previewCommandPlan: mocks.preview, cancelCommandPlan: mocks.cancel, markAiCommandPlan: mocks.mark }));
import { CommandAgentPanel } from "../ui/panels/CommandAgentPanel";
afterEach(() => { vi.clearAllMocks(); useCommandPlan.setState({ status: "idle", frame: undefined }); });
it("requires consent and drops a provider response when the accepted project changes", async () => {
  const document = createEmptyDocument("Before");
  useCadStore.getState().setDocument(document);
  mocks.capture.mockResolvedValue({ session: useCadStore.getState().documentSession, document });
  let reply: ((value: unknown) => void) | undefined;
  mocks.request.mockImplementation(() => new Promise(resolve => { reply = resolve; }));
  render(<CommandAgentPanel active />);
  await waitFor(() => expect(screen.getByLabelText("Command agent model")).toHaveValue("test-model"));
  fireEvent.change(screen.getByLabelText("Describe command agent changes"), { target: { value: "Create a part" } });
  expect(screen.getByRole("button", { name: "Generate command preview" })).toBeDisabled();
  expect(mocks.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate command preview" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
  const signal = mocks.request.mock.calls[0][5] as AbortSignal;
  act(() => useCadStore.getState().setDocument(createEmptyDocument("After")));
  expect(signal.aborted).toBe(true);
  await act(async () => { reply!({ kind: "plan", label: "Late plan", summary: "Late", warnings: [], steps: [{ command: "cad.parameter.add", arguments: { name: "width", expression: "40mm" } }] }); });
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.mark).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});
it("preserves idle status on Escape and handles Escape only for an owned pending request", async () => {
  const document = createEmptyDocument("Escape ownership");
  useCadStore.getState().setDocument(document);
  mocks.capture.mockResolvedValue({ session: useCadStore.getState().documentSession, document });
  let reply: ((value: unknown) => void) | undefined;
  mocks.request.mockImplementation(() => new Promise(resolve => { reply = resolve; }));
  const outer = vi.fn();
  render(<div onKeyDown={outer}><CommandAgentPanel active /></div>);
  await waitFor(() => expect(screen.getByLabelText("Command agent model")).toHaveValue("test-model"));
  const input = screen.getByLabelText("Describe command agent changes");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(outer).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Command agent status")).toHaveTextContent("Describe a creation or edit");
  fireEvent.change(input, { target: { value: "Create a part" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate command preview" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
  const signal = mocks.request.mock.calls[0][5] as AbortSignal;
  fireEvent.keyDown(input, { key: "Escape" });
  expect(signal.aborted).toBe(true);
  expect(outer).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Command agent status")).toHaveTextContent("Proposal canceled");
  await act(async () => { reply!({ kind: "clarification", label: "Late", summary: "Late clarification", warnings: [], steps: [] }); });
  expect(screen.queryByText("Late clarification")).not.toBeInTheDocument();
});
it.each(["unchecked", "hidden"] as const)("does not send an old project's conversation after sharing is %s and the project changes", async mode => {
  useCadStore.getState().setDocument(createEmptyDocument("Old project"));
  mocks.capture.mockImplementation(async () => ({ session: useCadStore.getState().documentSession, document: useCadStore.getState().history.present }));
  const clarification = { kind: "clarification", label: "Old question", summary: "Which size for the old project?", warnings: [], steps: [] };
  mocks.request.mockResolvedValueOnce(clarification).mockResolvedValueOnce({ ...clarification, label: "New question", summary: "Which size for this new project?" });
  const view = render(<CommandAgentPanel active />);
  await waitFor(() => expect(screen.getByLabelText("Command agent model")).toHaveValue("test-model"));
  fireEvent.change(screen.getByLabelText("Describe command agent changes"), { target: { value: "Old project request" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate command preview" }));
  await screen.findByText(clarification.summary);
  if (mode === "unchecked") fireEvent.click(screen.getByRole("checkbox"));
  else view.rerender(<CommandAgentPanel active={false} />);
  act(() => useCadStore.getState().setDocument(createEmptyDocument("New project")));
  expect(screen.queryByText(clarification.summary)).not.toBeInTheDocument();
  if (mode === "hidden") view.rerender(<CommandAgentPanel active />);
  await waitFor(() => expect(screen.getByLabelText("Command agent model")).toHaveValue("test-model"));
  fireEvent.change(screen.getByLabelText("Describe command agent changes"), { target: { value: "New project request" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate command preview" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  expect(mocks.request.mock.calls[1][3]).toEqual([]);
  expect(mocks.request.mock.calls[1][4].document.name).toBe("New project");
});
it("preserves a same-project conversation when the command mode is hidden and shown", async () => {
  useCadStore.getState().setDocument(createEmptyDocument("Same project"));
  mocks.capture.mockImplementation(async () => ({ session: useCadStore.getState().documentSession, document: useCadStore.getState().history.present }));
  const clarification = { kind: "clarification", label: "Dimensions", summary: "What width?", warnings: [], steps: [] };
  mocks.request.mockResolvedValue(clarification);
  const view = render(<CommandAgentPanel active />);
  await waitFor(() => expect(screen.getByLabelText("Command agent model")).toHaveValue("test-model"));
  fireEvent.change(screen.getByLabelText("Describe command agent changes"), { target: { value: "Create a part" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate command preview" }));
  await screen.findByText("What width?");
  view.rerender(<CommandAgentPanel active={false} />);
  view.rerender(<CommandAgentPanel active />);
  await waitFor(() => expect(screen.getByLabelText("Command agent model")).toHaveValue("test-model"));
  fireEvent.change(screen.getByLabelText("Describe command agent changes"), { target: { value: "40 mm" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Generate command preview" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  expect(mocks.request.mock.calls[1][3]).toEqual([{ role: "user", content: "Create a part" }, { role: "assistant", content: JSON.stringify(clarification) }]);
});

it("marks AI provenance only after a successful registry preview matches the owned frame", async () => {
  const document = createEmptyDocument("AI provenance");
  useCadStore.getState().setDocument(document);
  const accepted = useCadStore.getState().history.present;
  const session = useCadStore.getState().documentSession;
  configureCommandRuntime(() => useCadStore.getState().documentSession);
  mocks.capture.mockResolvedValue({ session, document });
  mocks.request.mockResolvedValue({ kind: "plan", label: "Add width", summary: "Add an editable width parameter.", warnings: [], steps: [{ command: "cad.parameter.add", arguments: { name: "width", expression: "40mm" } }] });
  let finishPreview: ((value: unknown) => void) | undefined;
  const dispose = bindCommand({ id: "plan.preview", label: "Preview plan", kind: "domain", input: {} }, {
    id: "domain", label: () => "Preview plan", available: () => undefined,
    invoke: args => {
      expect(args[0]).toMatchObject({ label: "Add width", steps: [{ command: "cad.parameter.add" }] });
      useCommandPlan.setState({ status: "previewing", frame: { id: "unit-ai-plan", label: "Add width", source: accepted, session, componentId: useCadStore.getState().activeComponentId, selection: [], results: [], bodyIds: [], steps: 1 } });
      return new Promise(resolve => { finishPreview = resolve; });
    },
  });
  try {
    render(<CommandAgentPanel active />);
    await waitFor(() => expect(screen.getByLabelText("Command agent model")).toHaveValue("test-model"));
    fireEvent.change(screen.getByLabelText("Describe command agent changes"), { target: { value: "Add a width of 40 mm" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Generate command preview" }));
    await waitFor(() => expect(finishPreview).toBeDefined());
    expect(mocks.mark).not.toHaveBeenCalled();
    await act(async () => {
      useCommandPlan.setState({ status: "ready" });
      finishPreview!({ planId: "unit-ai-plan", status: "ready" });
    });
    await screen.findByRole("button", { name: "Apply command plan" });
    expect(mocks.mark).toHaveBeenCalledExactlyOnceWith("unit-ai-plan");
    expect(useCadStore.getState().history.present).toBe(accepted);
  } finally { dispose(); }
});
