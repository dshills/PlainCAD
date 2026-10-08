import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import { FeaturePatternPanel } from "../ui/panels/FeaturePatternPanel";
import { beginFeaturePattern, cancelFeaturePattern, previewFeaturePattern } from "../ui/commands/featurePatternCommand";

vi.mock("../ui/commands/featurePatternCommand", async () => ({
  ...await vi.importActual<typeof import("../ui/commands/featurePatternCommand")>("../ui/commands/featurePatternCommand"),
  previewFeaturePattern: vi.fn(),
}));
vi.mock("../viewer/ExtrudePreview", () => ({ ExtrudePreview: ({ meshes, label }: { meshes: unknown[]; label: string }) => <div aria-label={label} data-testid="native-preview" data-mesh-count={meshes.length} /> }));
vi.mock("../viewer/PatternControls", () => ({ PatternControls: ({ onChange, onDragging }: { onChange: (value: { spacing: string }) => void; onDragging: (value: boolean) => void }) => <>
  <button type="button" onClick={() => { onDragging(true); onChange({ spacing: "14mm" }); }}>Start arrangement drag</button>
  <button type="button" onClick={() => onDragging(false)}>End arrangement drag</button>
</> }));

beforeEach(() => {
  vi.useFakeTimers();
  let document = createBoxTemplate();
  for (const [id, x] of [["seed", "-20mm"], ["other-seed", "0mm"]]) {
    const center = addPoint(createXySketch(id), x, "0mm");
    document = upsertFeature(upsertSketch(document, center.sketch), { id, type: "hole", name: id, sketchId: center.sketch.id, centerPointIds: [center.pointId], diameter: { expression: "4mm", unit: "mm" }, depth: "throughAll", targetBodyIds: [`body:${document.features[0].id}`] });
  }
  const result = rebuildDocument(document);
  result.success = true; result.errors = [];
  result.meshes = result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade", geometryAssertions: { valid: true, volume: 79000, surfaceArea: 13000, solidCount: 1 } }));
  useCadStore.setState(state => ({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { ...state.rebuild, kernelReady: true, status: "succeeded", result }, selection: { selectedIds: [{ kind: "feature", id: "seed", documentId: document.id }] } }));
  vi.mocked(previewFeaturePattern).mockImplementation(async (frame, input) => ({ frame, input: { ...input }, document, result, operation: result, feature: { id: frame.featureId, type: "pattern", name: input.name, sourceFeatureId: input.sourceFeatureId, targetBodyIds: [`body:${document.features[0].id}`], pattern: { type: "linear", count: { expression: input.count, unit: "" }, spacing: { expression: input.spacing, unit: "mm" }, direction: input.direction } } }));
  beginFeaturePattern();
});
afterEach(() => { cleanup(); cancelFeaturePattern(); vi.useRealTimers(); vi.restoreAllMocks(); useCadStore.setState(useCadStore.getInitialState(), true); });
async function finishPreview() { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); }

it("keeps a labeled last native preview while dragging and validating, with Apply requiring the latest input", async () => {
  render(<StrictMode><FeaturePatternPanel /></StrictMode>);
  await finishPreview();
  const apply = screen.getByRole("button", { name: "Apply pattern" });
  expect(apply).toBeEnabled();
  expect(screen.getByTestId("native-preview")).toHaveAttribute("data-mesh-count", "1");
  const calls = vi.mocked(previewFeaturePattern).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Start arrangement drag" }));
  expect(apply).toBeDisabled();
  expect(screen.getByText(/Showing the last validated native preview/)).toBeVisible();
  expect(screen.getByRole("status", { name: "Pattern preview status" })).toHaveTextContent("native validation waits for release");
  expect(screen.getByTestId("native-preview")).toHaveAttribute("data-mesh-count", "1");
  await finishPreview();
  expect(vi.mocked(previewFeaturePattern).mock.calls).toHaveLength(calls);
  fireEvent.click(screen.getByRole("button", { name: "End arrangement drag" }));
  expect(apply).toBeDisabled();
  await finishPreview();
  expect(apply).toBeEnabled();
  expect(screen.queryByText(/Showing the last validated native preview/)).toBeNull();
  expect(vi.mocked(previewFeaturePattern).mock.lastCall?.[1].spacing).toBe("14mm");
});
it("hides retained geometry when the source or project changes", async () => {
  render(<FeaturePatternPanel />);
  await finishPreview();
  fireEvent.change(screen.getByLabelText("Pattern source feature"), { target: { value: "other-seed" } });
  expect(screen.getByTestId("native-preview")).toHaveAttribute("data-mesh-count", "0");
  expect(screen.getByRole("button", { name: "Apply pattern" })).toBeDisabled();
  await finishPreview();
  expect(screen.getByTestId("native-preview")).toHaveAttribute("data-mesh-count", "1");
  act(() => useCadStore.setState(state => ({ documentSession: state.documentSession + 1 })));
  expect(screen.getByTestId("native-preview")).toHaveAttribute("data-mesh-count", "0");
  expect(screen.getByRole("button", { name: "Apply pattern" })).toBeDisabled();
  expect(screen.getByRole("status", { name: "Pattern preview status" })).toHaveTextContent("Project or component changed");
});
it("keeps failed latest previews visibly stale and unavailable for Apply", async () => {
  render(<FeaturePatternPanel />);
  await finishPreview();
  vi.mocked(previewFeaturePattern).mockRejectedValueOnce(new Error("Copy misses the body"));
  fireEvent.change(screen.getByLabelText("Pattern spacing"), { target: { value: "900mm" } });
  await finishPreview();
  expect(screen.getByRole("alert")).toHaveTextContent("Copy misses the body");
  expect(screen.getByText(/Showing the last validated native preview/)).toBeVisible();
  expect(screen.getByTestId("native-preview")).toHaveAttribute("data-mesh-count", "1");
  expect(screen.getByRole("button", { name: "Apply pattern" })).toBeDisabled();
});
