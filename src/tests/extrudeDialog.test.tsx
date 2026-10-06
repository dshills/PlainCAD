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
  beginExtrudeEditing,
  useExtrudeDraft,
  assertNativeExtrudePreview,
} from "../ui/commands/extrudeCommand";
import type { ExtrudeDistanceHandle } from "../viewer/ExtrudePreview";
import { ExtrudeCreationPanel } from "../ui/panels/ExtrudeCreationPanel";
import { previewExtrusion } from "../cad/worker/extrudePreviewClient";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import { createBoxTemplate } from "../templates/templates";

vi.mock("../cad/worker/extrudePreviewClient", () => ({
  previewExtrusion: vi.fn(),
}));
vi.mock("../viewer/ExtrudePreview", () => ({
  ExtrudePreview: ({
    distanceHandle,
  }: {
    distanceHandle?: ExtrudeDistanceHandle;
  }) => (
    <div data-testid="preview">
      <button
        type="button"
        disabled={Boolean(distanceHandle?.disabledReason)}
        onClick={() => {
          distanceHandle?.onDragging?.(true);
          distanceHandle?.onChange(15);
        }}
      >
        Start simulated drag
      </button>
      <button type="button" onClick={() => distanceHandle?.onDragging?.(false)}>
        Finish simulated drag
      </button>
      <span>{distanceHandle?.disabledReason}</span>
    </div>
  ),
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
it("requires the native To Face operation tag for a To Face new-body preview", () => {
  const draft = useExtrudeDraft.getState().draft!;
  const result = simulatedNative({
    ...draft.document,
    features: [draft.feature],
  });
  const feature = {
    ...draft.feature,
    termination: {
      type: "toFace" as const,
      faceRef: {
        kind: "face" as const,
        featureId: "owner",
        transientId: "owner-cap",
        stableHint: "owner-cap",
        role: "planarFace" as const,
      },
    },
  };
  expect(() =>
    assertNativeExtrudePreview(result, draft.document.id, feature),
  ).toThrow("requested extrusion operation");
  result.meshes[0].kernelOperation = "toFace";
  expect(() =>
    assertNativeExtrudePreview(result, draft.document.id, feature),
  ).not.toThrow();
});

it("keeps drag edits in the draft, rejects pending previews, and commits the latest distance once", async () => {
  const before = useCadStore.getState().history.present;
  render(<ExtrudeCreationPanel />);
  await waitFor(() => expect(jobs).toHaveLength(1));
  await act(async () => jobs[0].resolve(simulatedNative(jobs[0].document)));
  fireEvent.change(screen.getByLabelText("Extrude distance"), {
    target: { value: "1cm" },
  });
  await waitFor(() => expect(jobs).toHaveLength(2));
  await act(async () => jobs[1].resolve(simulatedNative(jobs[1].document)));
  fireEvent.click(screen.getByRole("button", { name: "Start simulated drag" }));
  expect(useCadStore.getState().history.present).toBe(before);
  expect(screen.getByLabelText("Extrude distance")).toHaveValue("15mm");
  expect(
    screen.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  await waitFor(() => expect(jobs).toHaveLength(3));
  expect(jobs[2].document.features[0]).toMatchObject({
    distance: { expression: "15mm" },
  });
  await act(async () => jobs[2].resolve(simulatedNative(jobs[2].document)));
  expect(
    screen.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Finish simulated drag" }),
  );
  expect(screen.getByRole("button", { name: "Apply extrusion" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Apply extrusion" }));
  expect(useCadStore.getState().history.past).toEqual([before]);
  expect(useCadStore.getState().history.present.features[0]).toMatchObject({
    distance: { expression: "15mm" },
    termination: { type: "distance", distance: { expression: "15mm" } },
  });
});
it("keeps parameter and formula editing available without enabling destructive dragging", async () => {
  render(<ExtrudeCreationPanel />);
  fireEvent.change(screen.getByLabelText("Extrude distance"), {
    target: { value: "depth*2" },
  });
  expect(
    screen.getByRole("button", { name: "Start simulated drag" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/dragging preserves parameter and formula bindings/),
  ).toBeVisible();
  expect(screen.getByLabelText("Extrude distance")).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Extrude distance"), {
    target: { value: "2*5mm" },
  });
  expect(
    screen.getByRole("button", { name: "Start simulated drag" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Extrude distance"), {
    target: { value: "1cm" },
  });
  expect(
    screen.getByRole("button", { name: "Start simulated drag" }),
  ).toBeEnabled();
});

it("previews and edits a saved legacy rectangle profile alias without changing its authored identity", async () => {
  const document = createBoxTemplate();
  const feature = document.features[0];
  if (feature.type !== "extrude") throw new Error("Fixture needs an extrusion.");
  useExtrudeDraft.setState({ draft: undefined });
  useCadStore.setState({
    history: { past: [], present: document, future: [] },
    activeComponentId: document.rootComponentId,
    rebuild: { status: "succeeded", kernelReady: true, result: simulatedNative(document) },
    selection: { selectedIds: [{ kind: "feature", id: feature.id, documentId: document.id }] },
  });
  beginExtrudeEditing();
  render(<ExtrudeCreationPanel />);
  await waitFor(() => expect(jobs).toHaveLength(1));
  await act(async () => jobs[0].resolve(simulatedNative(jobs[0].document)));
  await waitFor(() => expect(jobs).toHaveLength(2));
  expect(screen.queryByRole("option", { name: /Lost profile/ })).toBeNull();
  expect(screen.getByRole("combobox", { name: /Extrude profile/ })).toHaveValue(feature.profileId);
  expect(jobs[1].document.features[0]).toMatchObject({ profileId: feature.profileId });
  await act(async () => jobs[1].resolve(simulatedNative(jobs[1].document)));
  await waitFor(() => expect(jobs).toHaveLength(3));
  await act(async () => jobs[2].resolve(simulatedNative(jobs[2].document)));
  expect(screen.getByRole("button", { name: "Apply extrusion" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Apply extrusion" }));
  expect(useCadStore.getState().history.present.features[0]).toMatchObject({ profileId: feature.profileId });
  expect(useCadStore.getState().history.past).toEqual([document]);
});

it("keeps a profile lost when neither its current identity nor exact legacy alias exists", () => {
  const draft = useExtrudeDraft.getState().draft!;
  useExtrudeDraft.setState({ draft: {
    ...draft, feature: { ...draft.feature, profileId: "missing-profile" },
  } });
  render(<ExtrudeCreationPanel />);
  expect(screen.getByRole("option", { name: /Lost profile/ })).toHaveValue("missing-profile");
  expect(screen.getByRole("button", { name: "Apply extrusion" })).toBeDisabled();
  expect(jobs).toHaveLength(0);
});
