import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { upsertSketch } from "../cad/document/CadDocument";
import { addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createExtrudeEdgeRef } from "../cad/features/topologyRefs";
import { useCadStore } from "../state/useCadStore";
import { useWorkspaceState } from "../state/useWorkspaceState";
import { beginExtrudeCreation, useExtrudeDraft } from "../ui/commands/extrudeCommand";
import { beginHoleCreation, useHoleDraft } from "../ui/commands/holeCommand";
import { beginModelingCreation, useModelingDraft } from "../ui/commands/modelingDraftCommand";
import { ExtrudeCreationPanel } from "../ui/panels/ExtrudeCreationPanel";
import { ModelingCreationPanel } from "../ui/panels/ModelingCreationPanel";
import { HoleCreationPanel } from "../ui/panels/HoleCreationPanel";
import { previewModeling } from "../cad/worker/extrudePreviewClient";

vi.mock("../viewer/ExtrudePreview", () => ({ ExtrudePreview: () => <div /> }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({
  previewExtrusion: vi.fn(() => new Promise(() => {})),
  previewModeling: vi.fn(() => new Promise(() => {})),
}));

beforeEach(() => {
  vi.clearAllMocks();
  const point = addPoint(createXySketch("Hole centers"), "0mm", "0mm");
  const document = upsertSketch(createBoxTemplate(), point.sketch);
  const result = rebuildDocument(document);
  // Native tags supply selection availability only. Browser acceptance validates actual solids.
  result.meshes.forEach((mesh) => {
    mesh.geometrySource = "opencascade";
    mesh.geometryAssertions = { valid: true, volume: 80000, solidCount: 1, surfaceArea: 13200 };
  });
  useCadStore.setState({
    ...useCadStore.getInitialState(),
    history: { past: [], present: document, future: [] },
    activeComponentId: document.rootComponentId,
    rebuild: { kernelReady: true, status: "succeeded", result },
  }, true);
  useWorkspaceState.setState({ layout: "workbench" });
});
afterEach(() => {
  cleanup();
  useExtrudeDraft.setState({ draft: undefined });
  useModelingDraft.setState({ draft: undefined });
  useHoleDraft.setState({ draft: undefined });
});

function beginTask(operation: "extrude" | "revolve" | "fillet" | "chamfer" | "hole") {
  const state = useCadStore.getState();
  const document = state.history.present;
  const owner = document.features[0];
  if (owner.type !== "extrude") throw new Error("Fixture needs an extrusion.");
  if (operation === "extrude") {
    beginExtrudeCreation(owner.sketchId);
    return render(<ExtrudeCreationPanel />);
  }
  if (operation === "hole") {
    const sketch = Object.values(document.sketches).find((item) => item.name === "Hole centers")!;
    state.select({ kind: "sketch", id: sketch.id, documentId: document.id });
    beginHoleCreation();
    return render(<HoleCreationPanel />);
  }
  const common = { id: `feature-${operation}`, name: operation };
  beginModelingCreation(operation === "revolve" ? {
    ...common, type: "revolve", sketchId: owner.sketchId,
    profileId: state.rebuild.result!.profiles![owner.sketchId][0].id,
    axis: { type: "origin", axis: "Y" }, angle: { expression: "360deg", unit: "deg" }, operation: "newBody",
  } : operation === "fillet" ? {
    ...common, type: "fillet", targetEdgeRefs: [createExtrudeEdgeRef(owner.id, "endCapPerimeter")],
    radius: { expression: "1mm", unit: "mm" },
  } : {
    ...common, type: "chamfer", targetEdgeRefs: [createExtrudeEdgeRef(owner.id, "endCapPerimeter")],
    distance: { expression: "1mm", unit: "mm" },
  });
  return render(<ModelingCreationPanel />);
}

it.each(["extrude", "revolve", "fillet", "chamfer", "hole"] as const)(
  "%s keeps selection and settings visible, advanced controls disclosed, and unvalidated Apply blocked",
  (operation) => {
    const before = useCadStore.getState().history;
    const { container } = beginTask(operation);
    expect(screen.getByRole("heading", { name: /Selection/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: /Settings/ })).toBeVisible();
    const advanced = container.querySelector("details")!;
    expect(advanced.open).toBe(false);
    fireEvent.click(screen.getByText("Advanced options"));
    expect(advanced.open).toBe(true);
    const apply = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(apply).toHaveTextContent(/^Apply$/);
    expect(apply).toBeDisabled();
    expect(apply).toHaveAccessibleDescription(/latest valid native preview/);
    const cancel = screen.getByRole("button", { name: operation === "hole" ? "Cancel hole" : "Cancel" });
    expect(cancel).toHaveTextContent(/^Cancel$/);
    fireEvent.click(cancel);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useCadStore.getState().history).toBe(before);
  },
);

it("reveals a lost individual edge reference for explicit repair without replacing it with a perimeter", () => {
  beginTask("fillet");
  const original = useModelingDraft.getState().draft!;
  cleanup();
  if (original.feature.type !== "fillet") throw new Error("Fixture needs a fillet.");
  const feature = original.feature;
  act(() => useModelingDraft.setState({ draft: {
    ...original, feature: { ...feature, targetEdgeRefs: [
      createExtrudeEdgeRef(original.document.features[0].id, "endCapPerimeter", "lost-edge"),
    ] },
  } }));
  const { container } = render(<ModelingCreationPanel />);
  expect(container.querySelector("details")!.open).toBe(true);
  expect(screen.getByLabelText("Source edge")).toHaveValue("lost-edge");
  expect(screen.getByRole("option", { name: /Lost source/ })).toBeInTheDocument();
  expect(useCadStore.getState().history.past).toEqual([]);
});

it("keeps Hole selection counts singular and reveals a name-related preview failure", async () => {
  vi.mocked(previewModeling).mockRejectedValueOnce(new Error("Hole name is too long."));
  const { container } = beginTask("hole");
  fireEvent.click(screen.getByRole("checkbox", { name: /Include hole target/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Hole center at/ }));
  expect(screen.getByText("1 center selected · 1 body selected")).toBeVisible();
  expect(container.querySelector("details")!.open).toBe(false);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Hole name is too long."));
  expect(container.querySelector("details")!.open).toBe(true);
  expect(screen.getByLabelText("Hole name")).toBeVisible();
  expect(screen.getByRole("button", { name: "Apply hole" })).toBeDisabled();
});

it("accepts a supported saved profile alias for Revolve without changing the selected identity", async () => {
  beginTask("revolve");
  const draft = useModelingDraft.getState().draft!;
  const owner = draft.document.features[0];
  if (owner.type !== "extrude" || draft.feature.type !== "revolve")
    throw new Error("Fixture needs an extrusion and a revolve draft.");
  const feature = { ...draft.feature, profileId: owner.profileId };
  cleanup();
  useModelingDraft.setState({ draft: { ...draft, feature } });
  render(<ModelingCreationPanel />);
  expect(screen.getByRole("combobox", { name: "Choose shape" })).toHaveValue(owner.profileId);
  expect(screen.queryByRole("option", { name: /Lost profile/ })).toBeNull();
  await waitFor(() => expect(previewModeling).toHaveBeenCalledOnce());
  expect(vi.mocked(previewModeling).mock.calls[0][0].features.at(-1)).toMatchObject({
    id: feature.id, profileId: owner.profileId,
  });
});
