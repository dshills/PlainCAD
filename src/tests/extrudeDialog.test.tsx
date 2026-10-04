import { runCommand } from "../ui/commands/commandRegistry";
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
import { addCenterRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import {
  beginExtrudeCreation,
  useExtrudeDraft,
  assertNativeExtrudePreview,
} from "../ui/commands/extrudeCommand";
import { ExtrudeCreationPanel } from "../ui/panels/ExtrudeCreationPanel";
import { previewExtrusion } from "../cad/worker/extrudePreviewClient";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";

vi.mock("../cad/worker/extrudePreviewClient", () => ({
  previewExtrusion: vi.fn(),
}));
vi.mock("../viewer/ExtrudePreview", () => ({
  ExtrudePreview: () => <div data-testid="preview" />,
}));
const jobs: Array<{
  document: CadDocument;
  signal: AbortSignal;
  resolve: (result: RebuildResult) => void;
}> = [];
function simulatedNative(document: CadDocument) {
  const result = rebuildDocument(document);
  result.meshes.forEach((mesh) => {
    mesh.geometrySource = "opencascade";
    mesh.kernelOperation = "extrusion";
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
  vi.mocked(previewExtrusion).mockImplementation(
    (document, signal) =>
      new Promise((resolve) => jobs.push({ document, signal, resolve })),
  );
  const sketch = addCenterRectangle(createXySketch(), "10mm", "6mm"),
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
  beginExtrudeCreation(sketch.id);
});
afterEach(() => {
  cleanup();
  useExtrudeDraft.setState({ draft: undefined });
});
it("cancels a native preview without changing document, history or rebuild result", async () => {
  const before = useCadStore.getState();
  render(<ExtrudeCreationPanel />);
  await waitFor(() => expect(jobs).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(jobs[0].signal.aborted).toBe(true);
  await act(async () => jobs[0].resolve(simulatedNative(jobs[0].document)));
  expect(useCadStore.getState().history).toBe(before.history);
  expect(useCadStore.getState().rebuild).toBe(before.rebuild);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("discards out-of-order settings previews and applies the latest feature once", async () => {
  const before = useCadStore.getState().history.present;
  render(<ExtrudeCreationPanel />);
  await waitFor(() => expect(jobs).toHaveLength(1));
  fireEvent.change(screen.getByLabelText("Extrude distance"), {
    target: { value: "12mm" },
  });
  expect(
    screen.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  await waitFor(() => expect(jobs).toHaveLength(2));
  expect(jobs[0].signal.aborted).toBe(true);
  await act(async () => jobs[0].resolve(simulatedNative(jobs[0].document)));
  expect(
    screen.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  await act(async () => jobs[1].resolve(simulatedNative(jobs[1].document)));
  fireEvent.click(screen.getByRole("button", { name: "Apply extrusion" }));
  expect(useCadStore.getState().history.past).toEqual([before]);
  expect(useCadStore.getState().history.present.features).toHaveLength(1);
  expect(useCadStore.getState().history.present.features[0]).toMatchObject({
    distance: { expression: "12mm" },
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  const feature = useCadStore.getState().history.present.features[0];
  expect(useCadStore.getState().selection.selectedIds[0]).toMatchObject({
    kind: "feature",
    id: feature.id,
  });
  runCommand("feature.suppress");
  expect(useCadStore.getState().history.present.features[0].suppressed).toBe(
    true,
  );
  runCommand("feature.delete");
  expect(useCadStore.getState().history.present.features).toHaveLength(0);
  expect(useCadStore.getState().selection.selectedIds).toHaveLength(0);
});
it("invalidates a ready preview on project replacement even with the same project ID", async () => {
  render(<ExtrudeCreationPanel />);
  await waitFor(() => expect(jobs).toHaveLength(1));
  await act(async () => jobs[0].resolve(simulatedNative(jobs[0].document)));
  expect(screen.getByRole("button", { name: "Apply extrusion" })).toBeEnabled();
  act(() =>
    useCadStore.getState().setDocument(useCadStore.getState().history.present),
  );
  expect(
    screen.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Project or component changed",
  );
});
it("rejects fallback meshes and exposes feature diagnostics", () => {
  const draft = useExtrudeDraft.getState().draft!;
  const fallback = rebuildDocument({
    ...draft.document,
    features: [draft.feature],
  });
  expect(() => assertNativeExtrudePreview(fallback, draft.document.id)).toThrow(
    "valid native",
  );
  fallback.success = false;
  fallback.errors = [
    {
      id: "test",
      source: "feature",
      sourceId: draft.feature.id,
      message: "Cut does not remove material.",
    },
  ];
  expect(() => assertNativeExtrudePreview(fallback, draft.document.id)).toThrow(
    "does not remove material",
  );
});
