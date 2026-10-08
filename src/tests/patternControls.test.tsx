import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { PatternControls } from "../viewer/PatternControls";
import type { PatternControlInput, PatternControlModel } from "../cad/features/patternManipulation";

const input: PatternControlInput = { sourceFeatureId: "hole", type: "linear", count: "3", spacing: "10mm", direction: "X", angle: "180deg", centerX: "0mm", centerY: "0mm" };
const model: PatternControlModel = { outlines: [[[ { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 } ]], [[{ x: 9, y: -1 }, { x: 11, y: -1 }, { x: 11, y: 1 }]], [[{ x: 19, y: -1 }, { x: 21, y: -1 }, { x: 21, y: 1 }]]], centers: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], worldCenters: [], center: { x: 0, y: 0 }, sweep: Math.PI, spacing: 10, bounds: { minX: -1, maxX: 21, minY: -1, maxY: 1 } };
function coordinates(svg: Element, x: number, y: number) {
  const [vx, vy, width, height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
  const rect = svg.getBoundingClientRect(), scale = Math.min(rect.width / width, rect.height / height);
  return { clientX: rect.left + (rect.width - width * scale) / 2 + (x - vx) * scale, clientY: rect.top + (rect.height - height * scale) / 2 + (-y - vy) * scale, pointerId: 7, button: 0 };
}
beforeEach(() => {
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 7; } });
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 300, width: 300, height: 300, toJSON() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("pattern arrangement gestures", () => {
  it("changes spacing through a mouse gesture and freezes fitting until release", () => {
    const change = vi.fn(), dragging = vi.fn();
    render(<PatternControls model={model} input={input} onChange={change} onDragging={dragging} />);
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" }), handle = screen.getByRole("img", { name: "Drag pattern spacing" });
    fireEvent.pointerDown(handle, coordinates(svg, 10, 0));
    expect(dragging).toHaveBeenCalledWith(true);
    fireEvent.pointerMove(svg, coordinates(svg, 15, 0));
    expect(change).toHaveBeenCalledWith({ spacing: "15.000000mm" });
    fireEvent.pointerUp(svg, coordinates(svg, 15, 0));
    expect(dragging).toHaveBeenLastCalledWith(false);
  });
  it.each(["X", "Y"] as const)("preserves the handle grab offset for %s spacing", direction => {
    const change = vi.fn();
    const arranged = direction === "X" ? model : { ...model, centers: model.centers.map(point => ({ x: point.y, y: point.x })) };
    render(<PatternControls model={arranged} input={{ ...input, direction }} onChange={change} onDragging={vi.fn()} />);
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" }), handle = screen.getByRole("img", { name: "Drag pattern spacing" });
    const grab = { x: arranged.centers[1].x + .5, y: arranged.centers[1].y + .25 };
    fireEvent.pointerDown(handle, coordinates(svg, grab.x, grab.y));
    fireEvent.pointerMove(svg, coordinates(svg, grab.x, grab.y));
    expect(change).toHaveBeenLastCalledWith({ spacing: "10.000000mm" });
    fireEvent.pointerMove(svg, coordinates(svg, grab.x + (direction === "X" ? 5 : 0), grab.y + (direction === "Y" ? 5 : 0)));
    expect(change).toHaveBeenLastCalledWith({ spacing: "15.000000mm" });
    fireEvent.pointerUp(svg, { pointerId: 7 });
  });
  it("preserves both center grab offsets without jumping on the first move", () => {
    const change = vi.fn();
    render(<PatternControls model={model} input={{ ...input, type: "circular" }} onChange={change} onDragging={vi.fn()} />);
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" });
    fireEvent.pointerDown(screen.getByRole("img", { name: "Drag pattern center" }), coordinates(svg, .5, .25));
    fireEvent.pointerMove(svg, coordinates(svg, .5, .25));
    expect(change).toHaveBeenLastCalledWith({ centerX: "0.000000mm", centerY: "0.000000mm" });
    fireEvent.pointerMove(svg, coordinates(svg, 3.5, -3.75));
    expect(change).toHaveBeenLastCalledWith({ centerX: "3.000000mm", centerY: "-4.000000mm" });
    fireEvent.pointerCancel(svg, { pointerId: 7 });
    expect(change).toHaveBeenLastCalledWith({ centerX: "0mm", centerY: "0mm" });
  });
  it("keeps formula spacing protected until explicit replacement consent", () => {
    const change = vi.fn();
    render(<PatternControls model={model} input={{ ...input, spacing: "pitch * 2" }} onChange={change} onDragging={vi.fn()} />);
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" }), handle = screen.getByRole("img", { name: "Drag pattern spacing" });
    fireEvent.pointerDown(handle, coordinates(svg, 10, 0)); fireEvent.pointerMove(svg, coordinates(svg, 15, 0));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow dragging to replace formulas with literal values" }));
    fireEvent.pointerDown(handle, coordinates(svg, 10, 0)); fireEvent.pointerMove(svg, coordinates(svg, 15, 0));
    expect(change).toHaveBeenCalledWith({ spacing: "15.000000mm" });
  });
  it("Escape and pointer cancellation restore the original expressions", () => {
    const change = vi.fn();
    render(<PatternControls model={model} input={input} onChange={change} onDragging={vi.fn()} />);
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" }), handle = screen.getByRole("img", { name: "Drag pattern spacing" });
    fireEvent.pointerDown(handle, coordinates(svg, 10, 0)); fireEvent.pointerMove(svg, coordinates(svg, 17, 0));
    fireEvent.keyDown(svg, { key: "Escape" }); expect(change).toHaveBeenLastCalledWith({ spacing: input.spacing });
    fireEvent.pointerDown(handle, coordinates(svg, 10, 0)); fireEvent.pointerMove(svg, coordinates(svg, 17, 0));
    fireEvent.pointerCancel(svg, coordinates(svg, 17, 0)); expect(change).toHaveBeenLastCalledWith({ spacing: input.spacing });
  });
  it("moves the circular center using source-plane coordinates and cancels stale gestures", () => {
    const change = vi.fn(), dragging = vi.fn();
    const { rerender } = render(<PatternControls model={model} input={{ ...input, type: "circular" }} onChange={change} onDragging={dragging} />);
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" }), handle = screen.getByRole("img", { name: "Drag pattern center" });
    fireEvent.pointerDown(handle, coordinates(svg, 0, 0)); fireEvent.pointerMove(svg, coordinates(svg, 3, -4));
    expect(change).toHaveBeenCalledWith({ centerX: "3.000000mm", centerY: "-4.000000mm" });
    rerender(<PatternControls model={model} input={{ ...input, type: "circular" }} disabled onChange={change} onDragging={dragging} />);
    expect(change).toHaveBeenLastCalledWith({ centerX: input.centerX, centerY: input.centerY });
    expect(dragging).toHaveBeenLastCalledWith(false);
  });
  it("ignores a second pointer and preserves the first gesture's cancellation snapshot", () => {
    const change = vi.fn(), dragging = vi.fn();
    render(<PatternControls model={model} input={input} onChange={change} onDragging={dragging} />);
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" }), handle = screen.getByRole("img", { name: "Drag pattern spacing" });
    fireEvent.pointerDown(handle, coordinates(svg, 10, 0));
    fireEvent.pointerDown(handle, { ...coordinates(svg, 10, 0), pointerId: 8 });
    fireEvent.pointerMove(svg, { ...coordinates(svg, 17, 0), pointerId: 8 });
    fireEvent.pointerCancel(svg, { ...coordinates(svg, 17, 0), pointerId: 8 });
    expect(change).not.toHaveBeenCalled();
    expect(dragging).toHaveBeenCalledExactlyOnceWith(true);
    fireEvent.pointerMove(svg, coordinates(svg, 15, 0));
    expect(change).toHaveBeenLastCalledWith({ spacing: "15.000000mm" });
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(change).toHaveBeenLastCalledWith({ spacing: "10mm" });
    expect(dragging).toHaveBeenLastCalledWith(false);
  });
  it("notifies only active unmounts and restores gesture fields through the latest callbacks", () => {
    const firstChange = vi.fn(), firstDragging = vi.fn(), latestChange = vi.fn(), latestDragging = vi.fn();
    const view = render(<StrictMode><PatternControls model={model} input={input} onChange={firstChange} onDragging={firstDragging} /></StrictMode>);
    expect(firstDragging).not.toHaveBeenCalled();
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" });
    fireEvent.pointerDown(screen.getByRole("img", { name: "Drag pattern spacing" }), coordinates(svg, 10, 0));
    fireEvent.pointerMove(svg, coordinates(svg, 15, 0));
    view.rerender(<StrictMode><PatternControls model={model} input={{ ...input, sourceFeatureId: "other", spacing: "15.000000mm" }} onChange={latestChange} onDragging={latestDragging} /></StrictMode>);
    view.unmount();
    expect(firstDragging).toHaveBeenCalledExactlyOnceWith(true);
    expect(latestDragging).toHaveBeenCalledExactlyOnceWith(false);
    expect(latestChange).toHaveBeenCalledExactlyOnceWith({ spacing: "10mm" });
  });
  it("maps screen coordinates through the captured SVG matrix", () => {
    const change = vi.fn();
    render(<PatternControls model={model} input={input} onChange={change} onDragging={vi.fn()} />);
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" });
    Object.defineProperty(svg, "getScreenCTM", { value: () => ({ inverse: () => ({ a: .5, b: 0, c: 0, d: .5, e: -100, f: -75 }) }) });
    fireEvent.pointerDown(screen.getByRole("img", { name: "Drag pattern spacing" }), { clientX: 220, clientY: 150, pointerId: 7, button: 0 });
    fireEvent.pointerMove(svg, { clientX: 230, clientY: 150, pointerId: 7 });
    expect(change).toHaveBeenCalledExactlyOnceWith({ spacing: "15.000000mm" });
    fireEvent.pointerUp(svg, { pointerId: 7 });
  });
  it("accounts for letterboxing when an SVG matrix is unavailable", () => {
    vi.mocked(SVGElement.prototype.getBoundingClientRect).mockReturnValue({ x: 10, y: 20, top: 20, left: 10, right: 610, bottom: 320, width: 600, height: 300, toJSON() {} });
    const change = vi.fn();
    render(<PatternControls model={model} input={input} onChange={change} onDragging={vi.fn()} />);
    const svg = screen.getByRole("img", { name: "Pattern arrangement plan" });
    fireEvent.pointerDown(screen.getByRole("img", { name: "Drag pattern spacing" }), coordinates(svg, 10, 0));
    fireEvent.pointerMove(svg, coordinates(svg, 15, 0));
    expect(change).toHaveBeenCalledExactlyOnceWith({ spacing: "15.000000mm" });
    fireEvent.pointerUp(svg, coordinates(svg, 15, 0));
  });
});
