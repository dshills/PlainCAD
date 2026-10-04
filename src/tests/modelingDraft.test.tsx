import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { useCadStore } from "../state/useCadStore";
import {
  assertNativeModelingPreview,
  useModelingDraft,
} from "../ui/commands/modelingDraftCommand";
import { runCommand } from "../ui/commands/commandRegistry";
import { ModelingCreationPanel } from "../ui/panels/ModelingCreationPanel";
vi.mock("../cad/worker/extrudePreviewClient", () => ({
  previewModeling: vi.fn(),
}));
vi.mock("../viewer/ExtrudePreview", () => ({ ExtrudePreview: () => <div /> }));
const jobs: Array<{
  document: CadDocument;
  signal: AbortSignal;
  resolve: (result: RebuildResult) => void;
}> = [];
function response(document: CadDocument) {
  // Only the dialog's request lifecycle is simulated here; Chromium proves geometry.
  const result = rebuildDocument({
    ...document,
    features: document.features.map((original) => ({
      ...original,
      type: "extrude",
      sketchId: "sketchId" in original ? original.sketchId : "",
      profileId: "profileId" in original ? original.profileId : "",
      direction: "positive",
      distance: { expression: "10mm", unit: "mm" },
      operation: "newBody" as const,
    })),
  });
  result.meshes.forEach((mesh) => {
    mesh.geometrySource = "opencascade";
    mesh.kernelOperation = "revolve";
    mesh.geometryAssertions = {
      valid: true,
      volume: 600,
      surfaceArea: 100,
      solidCount: 1,
    };
  });
  return result;
}
beforeEach(() => {
  jobs.length = 0;
  vi.mocked(previewModeling).mockImplementation(
    (document, signal) =>
      new Promise((resolve) => jobs.push({ document, signal, resolve })),
  );
  const sketch = addCornerRectangle(createXySketch(), "10mm", "6mm"),
    document = upsertSketch(createEmptyDocument(), sketch);
  useCadStore.setState(
    {
      ...useCadStore.getInitialState(),
      history: { past: [], present: document, future: [] },
      activeComponentId: document.rootComponentId,
      rebuild: {
        status: "succeeded",
        kernelReady: false,
        result: rebuildDocument(document),
      },
    },
    true,
  );
  runCommand("feature.revolve");
});
afterEach(() => {
  cleanup();
  useModelingDraft.setState({ draft: undefined });
});
it("cancels pending native modeling without changing history or rebuild state", async () => {
  const before = useCadStore.getState();
  render(<ModelingCreationPanel />);
  await waitFor(() => expect(jobs).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(jobs[0].signal.aborted).toBe(true);
  await act(async () => jobs[0].resolve(response(jobs[0].document)));
  expect(useCadStore.getState().history).toBe(before.history);
  expect(useCadStore.getState().rebuild).toBe(before.rebuild);
});
it("rejects older settings and replacement projects, and applies only the current ready draft once", async () => {
  const before = useCadStore.getState().history.present;
  render(<ModelingCreationPanel />);
  await waitFor(() => expect(jobs).toHaveLength(1));
  fireEvent.change(screen.getByLabelText("Revolve angle"), {
    target: { value: "90deg" },
  });
  await waitFor(() => expect(jobs).toHaveLength(2));
  expect(jobs[0].signal.aborted).toBe(true);
  await act(async () => jobs[0].resolve(response(jobs[0].document)));
  expect(screen.getByRole("button", { name: "Apply revolve" })).toBeDisabled();
  await act(async () => jobs[1].resolve(response(jobs[1].document)));
  fireEvent.click(screen.getByRole("button", { name: "Apply revolve" }));
  expect(useCadStore.getState().history.past).toEqual([before]);
  expect(useCadStore.getState().history.present.features[0]).toMatchObject({
    type: "revolve",
    angle: { expression: "90deg" },
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => runCommand("feature.revolve"));
  await waitFor(() => expect(jobs).toHaveLength(3));
  await act(async () => jobs[2].resolve(response(jobs[2].document)));
  expect(screen.getByRole("button", { name: "Apply revolve" })).toBeEnabled();
  act(() =>
    useCadStore.getState().setDocument(useCadStore.getState().history.present),
  );
  expect(screen.getByRole("button", { name: "Apply revolve" })).toBeDisabled();
});

it("rejects fallback, failed and wrongly tagged modeling previews", () => {
  const draft = useModelingDraft.getState().draft!;
  const result = response({ ...draft.document, features: [draft.feature] });
  expect(() =>
    assertNativeModelingPreview(result, draft.document.id, draft.feature),
  ).not.toThrow();
  result.meshes[0].kernelOperation = "extrusion";
  expect(() =>
    assertNativeModelingPreview(result, draft.document.id, draft.feature),
  ).toThrow("requested modeling operation");
  result.meshes[0].geometrySource = "fallback";
  expect(() =>
    assertNativeModelingPreview(result, draft.document.id, draft.feature),
  ).toThrow("valid native");
  result.success = false;
  result.errors = [
    {
      id: "test",
      source: "feature",
      sourceId: draft.feature.id,
      message: "Revolve profile must not cross the selected axis.",
    },
  ];
  expect(() =>
    assertNativeModelingPreview(result, draft.document.id, draft.feature),
  ).toThrow("must not cross");
});
