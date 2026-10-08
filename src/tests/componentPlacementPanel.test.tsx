import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument, ComponentPlacement } from "../cad/document/schema";
import { useCadStore } from "../state/useCadStore";
import { beginComponentPlacement, cancelComponentPlacement, useComponentPlacement } from "../ui/commands/componentPlacementCommand";
import { previewModeling } from "../cad/worker/extrudePreviewClient";
import { ComponentPlacementPanel } from "../ui/panels/ComponentPlacementPanel";
import { appendProject } from "../persistence/appendProject";
import { withComponentPlacement } from "../cad/document/componentPlacement";
import { componentAlignmentTargets } from "../cad/inspection/componentAlignment";
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
vi.mock("../viewer/ComponentPlacementControls", () => ({ ComponentPlacementControls: ({ onChange, onDragging, alignmentTargets, alignmentPicking, onAlignmentPick }: { onChange: (placement: ComponentPlacement) => void; onDragging: (value: boolean) => void; alignmentTargets: { id: string; label: string }[]; alignmentPicking?: string; onAlignmentPick: (id: string) => void }) => <div>{alignmentTargets.map(target => <button key={target.id} onClick={() => onAlignmentPick(target.id)}>{`Pick ${alignmentPicking}: ${target.label}`}</button>)}<button onClick={() => { onDragging(true); onChange({ translation: [15, 0, 0], rotation: [0, 0, 0] }); }}>Begin move gesture</button><button onClick={() => onDragging(false)}>Finish move gesture</button></div> }));
const worker = vi.mocked(previewModeling);
function native(document: CadDocument) {
  const result = rebuildDocument(document);
  return { ...result, meshes: result.meshes.map((mesh) => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 24000, surfaceArea: 10000, solidCount: 1 } })) };
}
function setup(two = false) {
  let document = createBoxTemplate();
  if (two) { const appended = appendProject(document, createBoxTemplate()); document = withComponentPlacement(appended.document, appended.componentIds[0], { translation: [0, 0, 60], rotation: [0, 0, 0] }); }
  const result = native(document);
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
it("automatically previews selected alignment before Apply and saves one native-validated rigid pose", async () => {
  const document = setup(true), targets = componentAlignmentTargets(document, useCadStore.getState().rebuild.result!);
  const source = targets.find(target => target.componentId === document.rootComponentId && target.id.endsWith(":endCap"))!;
  const target = targets.find(target => target.componentId !== document.rootComponentId && target.id.endsWith(":startCap"))!;
  field("50"); await flush(); expect(screen.getByRole("button", { name: "Apply component placement" })).toBeEnabled();
  fireEvent.change(screen.getByRole("combobox", { name: "Source geometry" }), { target: { value: source.id } });
  fireEvent.change(screen.getByRole("combobox", { name: "Target geometry" }), { target: { value: target.id } });
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeDisabled();
  await flush();
  expect(screen.getByLabelText("Position X (mm)")).toHaveValue("50"); expect(screen.getByLabelText("Position Z (mm)")).toHaveValue("40");
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeEnabled(); expect(useCadStore.getState().history.present).toBe(document);
  fireEvent.click(screen.getByRole("checkbox", { name: "Flip direction" }));
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeDisabled();
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Apply component placement" })); expect(useCadStore.getState().history.past).toEqual([document]);
  expect(useCadStore.getState().history.present.components[document.rootComponentId].placement).toEqual({ translation: [50, 0, 80], rotation: [Math.PI, 0, Math.PI] });
  const other = Object.keys(document.components).find(id => id !== document.rootComponentId)!;
  expect(useCadStore.getState().history.present.components[other]).toEqual(document.components[other]);
});
it("invalid clearance cannot reuse an old placement proof and Cancel writes no history", async () => {
  const document = setup(true); field("50"); await flush();
  const input = screen.getByLabelText("Gap (mm)"); fireEvent.change(input, { target: { value: "NaN" } }); fireEvent.blur(input);
  expect(screen.getByRole("alert")).toHaveTextContent("finite gap"); expect(screen.getByRole("button", { name: "Apply component placement" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel placement" })); expect(useCadStore.getState().history.present).toBe(document); expect(useCadStore.getState().history.past).toHaveLength(0);
});

it("advances two preview picks automatically and blocks dirty gap until native proof", async () => {
  const document = setup(true);
  fireEvent.click(screen.getByRole("button", { name: /Pick source:.*end cap/i }));
  expect(screen.getByRole("button", { name: /Pick target:.*start cap/i })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /Pick target:.*start cap/i }));
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeDisabled();
  await flush(); expect(screen.getByRole("button", { name: "Apply component placement" })).toBeEnabled();
  const gap = screen.getByLabelText("Gap (mm)"); fireEvent.change(gap, { target: { value: "3" } });
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeDisabled();
  fireEvent.blur(gap); await flush();
  expect(screen.getByLabelText("Position Z (mm)")).toHaveValue("37");
  fireEvent.click(screen.getByRole("button", { name: "Apply component placement" }));
  expect(useCadStore.getState().history.past).toEqual([document]);
  expect(useCadStore.getState().history.present.components[document.rootComponentId].placement!.translation).toEqual([0, 0, 37]);
});

it("changing alignment type and clearing choices preserves a current native free-movement proof", async () => {
  setup(true); field("50"); await flush();
  fireEvent.change(screen.getByRole("combobox", { name: "Alignment geometry" }), { target: { value: "edge" } });
  expect(screen.getByRole("button", { name: "Pick source in preview" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Clear alignment choices" }));
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeEnabled();
  expect(worker).toHaveBeenCalledOnce();
});

it("unused Gap and Flip settings preserve a validated free-movement preview", async () => {
  setup(true); field("50"); await flush();
  const gap = screen.getByLabelText("Gap (mm)"); fireEvent.change(gap, { target: { value: "3" } }); fireEvent.blur(gap);
  fireEvent.click(screen.getByRole("checkbox", { name: "Flip direction" }));
  expect(screen.getByRole("button", { name: "Apply component placement" })).toBeEnabled();
  expect(worker).toHaveBeenCalledOnce();
});
