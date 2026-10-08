import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument, ComponentPlacement } from "../cad/document/schema";
import { useCadStore } from "../state/useCadStore";
import { beginComponentPlacement, cancelComponentPlacement, useComponentPlacement } from "../ui/commands/componentPlacementCommand";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { ComponentPlacementPanel } from "../ui/panels/ComponentPlacementPanel";
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
vi.mock("../viewer/ComponentPlacementControls", () => ({ ComponentPlacementControls: ({ onChange, onDragging }: { onChange: (placement: ComponentPlacement) => void; onDragging: (value: boolean) => void }) => <div><button onClick={() => { onDragging(true); onChange({ translation: [15, 0, 0], rotation: [0, 0, 0] }); }}>Begin move gesture</button><button onClick={() => onDragging(false)}>Finish move gesture</button></div> }));
const worker = vi.mocked(previewModeling);
function native(document: CadDocument) {
  const result = rebuildDocument(document);
  return { ...result, meshes: result.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 24000, surfaceArea: 10000, solidCount: 1 } })) };
}
function setup() {
  const document = createBoxTemplate(), result = native(document);
  useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 51, activeComponentId: document.rootComponentId, fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result }, selection: { selectedIds: [] } });
  worker.mockImplementation(async (document) => native(document)); beginComponentPlacement(); render(<ComponentPlacementPanel />); return document;
}
beforeEach(() => { vi.useFakeTimers(); worker.mockReset(); cancelComponentPlacement(); });
afterEach(() => { cleanup(); cancelComponentPlacement(); useCadStore.setState(useCadStore.getInitialState()); vi.useRealTimers(); });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(180); });
function field(value: string) { const input = screen.getByLabelText("Position X (mm)"); fireEvent.change(input, { target: { value } }); fireEvent.blur(input); }
it("requires a successful native numeric preview and refuses invalid fields without applying the old pose", async () => {
  const document = setup(); field("50"); await flush();
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeEnabled();
  expect(useCadStore.getState().history.present).toBe(document);
  field("not a position");
  expect(screen.getByRole("alert")).toHaveTextContent("Enter finite positions");
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeDisabled();
  expect(useCadStore.getState().history.past).toHaveLength(0);
  field("70"); await flush(); fireEvent.click(screen.getByRole("button", { name: "Apply component placement" }));
  expect(useCadStore.getState().history.present.components[document.rootComponentId].placement!.translation).toEqual([70, 0, 0]);
  expect(useCadStore.getState().history.past).toEqual([document]);
});
it("defers native preview for live movement and validates only after release", async () => {
  setup(); fireEvent.click(screen.getByRole("button", { name: "Begin move gesture" })); await flush();
  expect(worker).not.toHaveBeenCalled(); expect(screen.getByRole("status", { name: "Placement status" })).toHaveTextContent("Moving live");
  fireEvent.click(screen.getByRole("button", { name: "Finish move gesture" })); await flush();
  expect(worker).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Apply component placement" })).toBeEnabled();
});
it("closes on document currency changes and ignores a late worker result", async () => {
  const document = setup();
  let deliver!: (value: ReturnType<typeof native>) => void;
  worker.mockImplementationOnce(() => new Promise((resolve) => { deliver = resolve; }));
  field("50"); await flush();
  act(() => useCadStore.setState({ documentSession: 52 }));
  expect(screen.queryByRole("dialog", { name: "Move or rotate component" })).toBeNull(); expect(useComponentPlacement.getState().frame).toBeUndefined();
  await act(async () => { deliver(native(document)); await Promise.resolve(); });
  expect(useCadStore.getState().history.present).toBe(document); expect(useCadStore.getState().history.past).toHaveLength(0);
});
