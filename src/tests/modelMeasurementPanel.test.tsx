import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, createSketchOnPlane } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { modelMeasurementTargets } from "../cad/inspection/modelMeasurements";
import * as commands from "../ui/commands/commandRegistry";
import { ModelMeasurementReadout } from "../viewer/ModelMeasurementReadout";
import { MeasurementPanel } from "../ui/panels/MeasurementPanel";
import { useCadStore } from "../state/useCadStore";
import { useInspectionState } from "../state/inspectionState";
import { useViewerState } from "../state/viewerState";

beforeEach(() => {
  useInspectionState.setState(useInspectionState.getInitialState());
  useViewerState.setState(useViewerState.getInitialState());
  const document = upsertSketch(createEmptyDocument(), addCornerRectangle(createSketchOnPlane("Rectangle", "XY"), "3mm", "4mm")), result = rebuildDocument(document);
  useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 35, fileBusy: false, rebuild: { status: "succeeded", result, kernelReady: true }, selection: { selectedIds: [] } });
  useViewerState.getState().showAll(35);
  useInspectionState.getState().setPicking(35, true);
});
afterEach(() => { cleanup(); useInspectionState.setState(useInspectionState.getInitialState()); useViewerState.setState(useViewerState.getInitialState()); vi.restoreAllMocks(); });
describe("model measurement panel", () => {
  it("has a click-first flow, exact accessible target alternative, units and explicit mixed-pair diagnostics", () => {
    render(<MeasurementPanel />);
    expect(screen.getByRole("button", { name: "Done measuring" })).toBeInTheDocument();
    const state = useCadStore.getState(), targets = modelMeasurementTargets(state.history.present, state.rebuild.result!);
    const curve = targets.find((target) => target.kind === "curve")!, point = targets.find((target) => target.kind === "point")!;
    act(() => useInspectionState.getState().pick(35, state.history.present, state.rebuild.result!, curve.id));
    expect(screen.getByLabelText("Model measured length")).toHaveTextContent("3.0000 mm");
    fireEvent.change(screen.getByLabelText("Measurement units"), { target: { value: "in" } });
    expect(screen.getByLabelText("Model measured length")).toHaveTextContent("0.1181 in");
    expect(useInspectionState.getState().unit).toBe("in");
    act(() => useInspectionState.getState().pick(35, state.history.present, state.rebuild.result!, point.id));
    expect(screen.getByRole("alert")).toHaveTextContent("Mixed and curved distance pairs are unavailable");
    expect(useCadStore.getState().history.past).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Done measuring" }));
    expect(useInspectionState.getState().picking).toBe(false);
  });
  it("keeps units chosen before the first pick shared with the model readout", async () => {
    useInspectionState.getState().setPicking(-1, false);
    render(<MeasurementPanel />);
    fireEvent.change(screen.getByLabelText("Measurement units"), { target: { value: "in" } });
    expect(useInspectionState.getState().session).toBe(35);
    fireEvent.click(screen.getByRole("button", { name: "Pick in model" }));
    await act(async () => {});
    expect(useInspectionState.getState().picking).toBe(true);
    expect(useInspectionState.getState().unit).toBe("in");
    const state = useCadStore.getState(), target = modelMeasurementTargets(state.history.present, state.rebuild.result!).find((target) => target.kind === "curve")!;
    act(() => useInspectionState.getState().pick(35, state.history.present, state.rebuild.result!, target.id));
    expect(screen.getByLabelText("Model measured length")).toHaveTextContent("0.1181 in");
  });
  it("clears captured references on invalidation and cannot resurrect them when Undo restores the same object", () => {
    const state = useCadStore.getState(), first = modelMeasurementTargets(state.history.present, state.rebuild.result!).find((target) => target.kind === "curve")!;
    useInspectionState.getState().pick(35, state.history.present, state.rebuild.result!, first.id);
    render(<MeasurementPanel />);
    expect(screen.getByLabelText("Model measured length")).toBeInTheDocument();
    act(() => useCadStore.setState({ rebuild: { status: "queued", result: state.rebuild.result, kernelReady: true } }));
    expect(screen.queryByLabelText("Model measured length")).not.toBeInTheDocument();
    expect(useInspectionState.getState().result).toBeUndefined();
    act(() => useCadStore.setState({ rebuild: state.rebuild }));
    expect(screen.queryByLabelText("Model measured length")).not.toBeInTheDocument();
  });
  it("reacts immediately to visibility and presentation changes without a CAD edit", () => {
    const state = useCadStore.getState(), target = modelMeasurementTargets(state.history.present, state.rebuild.result!).find((target) => target.kind === "curve")!;
    useInspectionState.getState().pick(35, state.history.present, state.rebuild.result!, target.id);
    render(<ModelMeasurementReadout project={() => ({ x: 20, y: 20, depth: 0, width: 500, height: 400 })} subscribeFrames={() => () => {}} />);
    expect(screen.getByRole("status", { name: "Model measurement" })).toHaveTextContent("3.0000 mm");
    act(() => useViewerState.getState().toggleSketch(35, target.sketchId!, Object.keys(state.history.present.sketches)));
    expect(screen.queryByRole("status", { name: "Model measurement" })).not.toBeInTheDocument();
    act(() => useViewerState.getState().showAll(35));
    expect(screen.getByRole("status", { name: "Model measurement" })).toBeInTheDocument();
    act(() => useViewerState.getState().setPresentationMode(35, "render"));
    expect(screen.queryByRole("status", { name: "Model measurement" })).not.toBeInTheDocument();
  });
  it("uses the shared unit after panel remount and resets unit/references in a new document session", () => {
    const panel = render(<MeasurementPanel />);
    fireEvent.change(screen.getByLabelText("Measurement units"), { target: { value: "in" } });
    panel.unmount(); render(<MeasurementPanel />);
    expect(screen.getByLabelText("Measurement units")).toHaveValue("in");
    act(() => useCadStore.setState({ documentSession: 36 }));
    expect(screen.getByLabelText("Measurement units")).toHaveValue("mm");
    act(() => useInspectionState.getState().setUnit(36, "cm"));
    expect(useInspectionState.getState()).toMatchObject({ session: 36, picking: false, unit: "cm", targetIds: [] });
    expect(useInspectionState.getState().document).toBeUndefined();
  });

  it("shows a first-pick command error in its session and ignores delayed errors after project replacement", async () => {
    useInspectionState.getState().setPicking(-1, false);
    vi.spyOn(commands, "runCommand").mockRejectedValueOnce(new Error("Finish the current task"));
    render(<MeasurementPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Pick in model" }));
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("Finish the current task");
    let reject!: (reason: Error) => void;
    vi.mocked(commands.runCommand).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    fireEvent.click(screen.getByRole("button", { name: "Pick in model" }));
    act(() => useCadStore.setState({ documentSession: 36 }));
    await act(async () => reject(new Error("Old project failure")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(useInspectionState.getState().error).not.toBe("Old project failure");
  });

  it("never substitutes one remaining target after either member of a picked pair is hidden", () => {
    const original = useCadStore.getState(), document = upsertSketch(original.history.present, addCornerRectangle(createSketchOnPlane("Second sketch", "XY"), "5mm", "6mm")), result = rebuildDocument(document);
    useCadStore.setState({ history: { past: [], present: document, future: [] }, rebuild: { status: "succeeded", kernelReady: true, result } });
    const curves = modelMeasurementTargets(document, result).filter((target) => target.kind === "curve");
    const first = curves[0], second = curves.find((target) => target.sketchId !== first.sketchId)!;
    useInspectionState.getState().pick(35, document, result, first.id);
    useInspectionState.getState().pick(35, document, result, second.id);
    render(<><MeasurementPanel /><ModelMeasurementReadout project={() => ({ x: 20, y: 20, depth: 0, width: 500, height: 400 })} subscribeFrames={() => () => {}} /></>);
    expect(screen.getByLabelText("Model measured angle")).toBeInTheDocument();
    for (const hidden of [first, second]) {
      act(() => useViewerState.getState().toggleSketch(35, hidden.sketchId!, Object.keys(document.sketches)));
      expect(screen.queryByLabelText("Model measured angle")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Model measured length")).not.toBeInTheDocument();
      expect(screen.queryByRole("status", { name: "Model measurement" })).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Selected measurement geometry is hidden or unavailable");
      act(() => useViewerState.getState().showAll(35));
      expect(screen.getByLabelText("Model measured angle")).toBeInTheDocument();
    }
  });

});
