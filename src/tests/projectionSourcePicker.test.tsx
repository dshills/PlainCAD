import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProjectionSourcePicker } from "../viewer/ProjectionSourcePicker";
import type { ProjectionBoundaryTarget } from "../viewer/projectionBoundaryPicking";
const fitting = vi.hoisted(() => vi.fn());
vi.mock("../viewer/cameraFit", async () => {
  const actual = await vi.importActual<typeof import("../viewer/cameraFit")>("../viewer/cameraFit");
  return { fitCameraBounds: (...args: Parameters<typeof actual.fitCameraBounds>) => { fitting(...args); return actual.fitCameraBounds(...args); } };
});
const resizeCallbacks: (() => void)[] = [];
const renderer = vi.hoisted(() => ({ dispose: vi.fn(), forceContextLoss: vi.fn() }));
vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  return { ...actual, WebGLRenderer: class {
    domElement = document.createElement("canvas");
    setPixelRatio() {} setSize() {} render() {}
    dispose = renderer.dispose; forceContextLoss = renderer.forceContextLoss;
  } };
});
const target: ProjectionBoundaryTarget = { id: "cap:end", featureId: "cap", role: "endCapPerimeter", label: "Block · End cap", curves: [[{ x: 0, y: 0, z: 8 }, { x: 30, y: 0, z: 8 }]] };
const mesh = { id: "mesh", bodyId: "body:cap", positions: [0, 0, 8, 30, 0, 8, 0, 20, 8], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], bounds: { min: [0, 0, 8] as [number, number, number], max: [30, 20, 8] as [number, number, number] } };
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(260);
  vi.stubGlobal("ResizeObserver", class { constructor(private callback: () => void) { resizeCallbacks.push(callback); } observe() { this.callback(); } disconnect() {} });
  renderer.dispose.mockClear(); renderer.forceContextLoss.mockClear(); fitting.mockClear(); resizeCallbacks.length = 0;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("selects exact cap identity with click, Enter and Space; disables picks while checking", () => {
  const choose = vi.fn(), view = render(<ProjectionSourcePicker meshes={[mesh]} targets={[target]} selectedId="" disabled={false} onChoose={choose} />);
  const boundary = screen.getByRole("button", { name: "Project Block · End cap" });
  fireEvent.click(boundary); fireEvent.keyDown(boundary, { key: "Enter" }); fireEvent.keyDown(boundary, { key: " " });
  expect(choose).toHaveBeenCalledTimes(3); expect(choose).toHaveBeenLastCalledWith(target);
  view.rerender(<ProjectionSourcePicker meshes={[mesh]} targets={[target]} selectedId={target.id} disabled={true} onChoose={choose} />);
  expect(boundary).toHaveAttribute("aria-pressed", "true"); expect(boundary).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(boundary); fireEvent.keyDown(boundary, { key: "Enter" }); expect(choose).toHaveBeenCalledTimes(3);
  view.unmount(); expect(renderer.dispose).toHaveBeenCalledOnce(); expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
});
it("replaces old target identities and makes incompatible geometry a diagnostic pick", () => {
  const choose = vi.fn(), view = render(<ProjectionSourcePicker meshes={[mesh]} targets={[target]} selectedId="" disabled={false} onChoose={choose} />);
  const replacement = { ...target, id: "new-cap", label: "New block · End cap", disabledReason: "Project edges currently requires parallel planes." };
  view.rerender(<ProjectionSourcePicker meshes={[mesh]} targets={[replacement]} selectedId="" disabled={false} onChoose={choose} />);
  expect(screen.queryByRole("button", { name: "Project Block · End cap" })).toBeNull();
  const boundary = screen.getByRole("button", { name: "Inspect unavailable New block · End cap" });
  expect(boundary).toHaveAttribute("aria-disabled", "false");
  fireEvent.keyDown(boundary, { key: "Enter" }); expect(choose).toHaveBeenCalledWith(replacement);
});

it("preserves the fitted camera after source-view resize and ignores empty bounds", () => {
  const choose = vi.fn(), view = render(<ProjectionSourcePicker meshes={[]} targets={[]} selectedId="" disabled={false} onChoose={choose} />);
  expect(fitting).not.toHaveBeenCalled();
  view.rerender(<ProjectionSourcePicker meshes={[mesh]} targets={[target]} selectedId="" disabled={false} onChoose={choose} />);
  expect(fitting).toHaveBeenCalledOnce();
  const camera = fitting.mock.calls[0][0] as import("three").PerspectiveCamera;
  camera.position.x += 10; camera.position.y += 3;
  const before = camera.position.clone();
  act(() => resizeCallbacks.forEach((callback) => callback()));
  expect(fitting).toHaveBeenCalledOnce(); expect(camera.position.equals(before)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Fit projection sources" }));
  expect(fitting).toHaveBeenCalledTimes(2);
});
