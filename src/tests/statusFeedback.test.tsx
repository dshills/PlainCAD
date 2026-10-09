import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument, upsertParameter, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument } from "../cad/document/schema";
import { useCadStore } from "../state/useCadStore";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { useWorkbenchState } from "../state/useWorkbenchState";
import { ParameterPanel } from "../ui/panels/ParameterPanel";
import { RebuildErrorsPanel } from "../ui/panels/RebuildErrorsPanel";
import { WorkbenchBottomDock } from "../ui/workspace/WorkbenchBottomDock";
import { actionableIssueCount } from "../ui/workspace/diagnosticPresentation";

function fixture(document = upsertParameter(createEmptyDocument(), { id: "width-id", name: "width", expression: "20mm", unit: "mm", value: 20 })) {
  const result = rebuildDocument(document);
  useCadStore.setState({ history: { past: [], present: document, future: [] }, activeComponentId: document.rootComponentId,
    selection: { selectedIds: [] }, rebuild: { status: result.success ? "succeeded" : "failed", result, kernelReady: false } });
  return document;
}
function pending(document: CadDocument) {
  useCadStore.setState({ history: { past: [], present: document, future: [] }, rebuild: { ...useCadStore.getState().rebuild, status: "queued" } });
}
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useAiDrawer.setState({ open: false });
  useSketchCanvas.setState({ active: undefined });
  useWorkbenchState.setState({ bottomOpen: false, bottomTab: "history" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("model success and optional drawing guidance", () => {
  it("keeps a usable free rectangle successful with guidance outside the Issues badge", () => {
    fixture(upsertSketch(createEmptyDocument(), addCornerRectangle(createXySketch("Free rectangle"), "20mm", "10mm")));
    const result = useCadStore.getState().rebuild.result!;
    expect(result.success).toBe(true);
    expect(Object.values(result.profiles ?? {})[0]).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.id.endsWith(":dof"))).toBe(true);
    render(<WorkbenchBottomDock context={{}} enabled />);
    expect(screen.getByRole("button", { name: "Issues" })).not.toHaveClass("has-issues");
    fireEvent.click(screen.getByRole("button", { name: "Issues" }));
    expect(screen.getByText("No rebuild issues.")).toBeVisible();
    expect(screen.getByText("Optional sketch guidance (1)")).toBeVisible();
    fireEvent.click(screen.getByText("Optional sketch guidance (1)"));
    expect(screen.getByText(/Free rectangle: Underconstrained sketch/)).toBeVisible();
  });
  it("keeps profile, kernel and future unknown warnings prominent", () => {
    fixture();
    const result = useCadStore.getState().rebuild.result!;
    const warnings = [
      { id: "profile:sketch:open", source: "sketch" as const, sourceId: "sketch", message: "Open outline" },
      { id: "kernel:unsafe", source: "kernel" as const, message: "Invalid body" },
      { id: "sketch:future:dof", source: "feature" as const, sourceId: "future", message: "Unknown safety warning" },
    ];
    useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, result: { ...result, warnings } } });
    expect(actionableIssueCount({ ...result, warnings })).toBe(3);
    render(<WorkbenchBottomDock context={{}} enabled />);
    expect(screen.getByRole("button", { name: "Issues (3)" })).toHaveClass("has-issues");
    fireEvent.click(screen.getByRole("button", { name: "Issues (3)" }));
    expect(screen.getByRole("button", { name: "kernel: Invalid body" })).toBeVisible();
    expect(screen.queryByText("No rebuild issues.")).not.toBeInTheDocument();
  });
  it("shows invalid geometry prominently and does not present old diagnostics as current", () => {
    const document = fixture(upsertSketch(createEmptyDocument(), addCornerRectangle(createXySketch(), "missing", "10mm")));
    render(<RebuildErrorsPanel />);
    expect(screen.getAllByText(/Unknown parameter missing/).length).toBeGreaterThan(0);
    act(() => pending(document));
    expect(screen.getByRole("status")).toHaveTextContent("Updating model diagnostics…");
    expect(screen.queryByRole("button", { name: /Unknown parameter missing/ })).not.toBeInTheDocument();
  });
  it("shows a failed worker without result diagnostics as an issue", () => {
    fixture();
    useCadStore.setState({ rebuild: { status: "failed", kernelReady: true, message: "Worker timeout", result: undefined } });
    render(<WorkbenchBottomDock context={{}} enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Issues (1)" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Worker timeout");
  });
});

describe("parameter presentation", () => {
  it("shows full names and requires an explicit rename action", () => {
    const name = "mounting_plate_outer_hole_spacing";
    fixture(upsertParameter(createEmptyDocument(), { id: "long-name", name, expression: "42mm", unit: "mm", value: 42 }));
    useCadStore.setState({ rebuildNow: vi.fn() });
    const before = useCadStore.getState().history.present;
    render(<ParameterPanel />);
    expect(screen.getByText(name)).toHaveClass("parameter-name");
    expect(screen.queryByLabelText(`Parameter ${name} name`)).not.toBeInTheDocument();
    expect(screen.getByLabelText(`Parameter ${name} expression`).closest("label")).toHaveClass("parameter-expression-label");
    fireEvent.click(screen.getByRole("button", { name: `Rename parameter ${name}` }));
    const input = screen.getByLabelText(`Parameter ${name} name`);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "hole_spacing" } });
    fireEvent.blur(input);
    const history = useCadStore.getState().history;
    expect(history.present.parameters.hole_spacing).toMatchObject({ id: "long-name", name: "hole_spacing", expression: "42mm" });
    expect(history.present.parameters[name]).toBeUndefined();
    expect(history.past.at(-1)).toBe(before);
  });
  it("retains a clearly stale last value while pending and replaces it when current", () => {
    const document = fixture();
    render(<ParameterPanel />);
    expect(screen.getByLabelText("Computed parameter width")).toHaveTextContent("20.0000 mm");
    act(() => pending(upsertParameter(document, { ...document.parameters.width, expression: "40mm" })));
    expect(screen.getByLabelText("Computed parameter width")).toHaveTextContent("Updating… Previous: 20.0000 mm (stale)");
    act(() => { fixture(useCadStore.getState().history.present); });
    expect(screen.getByLabelText("Computed parameter width")).toHaveTextContent("40.0000 mm");
    expect(screen.getByLabelText("Computed parameter width")).not.toHaveTextContent("stale");
  });
  it("shows an invalid current value as unavailable, and never revives it on a later pending rebuild", () => {
    const document = fixture();
    render(<ParameterPanel />);
    act(() => pending(upsertParameter(document, { ...document.parameters.width, expression: "missing" })));
    act(() => { fixture(useCadStore.getState().history.present); });
    expect(screen.getByLabelText("Computed parameter width")).toHaveTextContent("Unavailable");
    expect(screen.getByText(/Unknown parameter missing/)).toHaveClass("error-text");
    act(() => pending(upsertParameter(document, { ...document.parameters.width, expression: "30mm" })));
    expect(screen.getByLabelText("Computed parameter width")).toHaveTextContent(/^Updating…$/);
  });
  it("does not borrow a value from a replaced session, reused parameter name or stale foreign result", () => {
    const document = fixture();
    render(<ParameterPanel />);
    act(() => pending(upsertParameter(document, { ...document.parameters.width, id: "replacement-id", expression: "50mm" })));
    expect(screen.getByLabelText("Computed parameter width")).toHaveTextContent(/^Updating…$/);
    act(() => { fixture(document); });
    act(() => {
      useCadStore.setState({ documentSession: 1 });
      pending({ ...document, parameters: { width: { ...document.parameters.width, expression: "60mm" } } });
    });
    expect(screen.getByLabelText("Computed parameter width")).toHaveTextContent(/^Updating…$/);
    act(() => {
      useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, status: "succeeded", result: { ...useCadStore.getState().rebuild.result!, documentId: "foreign-document" } } });
    });
    expect(screen.getByLabelText("Computed parameter width")).toHaveTextContent(/^Updating…$/);
  });
  it("resets a focused expression draft on same-ID project replacement", () => {
    const document = fixture();
    useCadStore.setState({ rebuildNow: vi.fn() });
    render(<ParameterPanel />);
    const input = screen.getByLabelText("Parameter width expression");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "999mm" } });
    act(() => {
      useCadStore.setState({ documentSession: 1 });
      fixture(upsertParameter(document, { ...document.parameters.width, expression: "70mm" }));
    });
    expect(screen.getByLabelText("Parameter width expression")).toHaveValue("70mm");
    expect(useCadStore.getState().history.present.parameters.width.expression).toBe("70mm");
    expect(useCadStore.getState().history.past).toHaveLength(0);
  });
});
