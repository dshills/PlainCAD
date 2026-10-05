import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ExtrudePreview,
  type ExtrudeDistanceHandle,
} from "../viewer/ExtrudePreview";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
vi.mock("three", async (original) => {
  const three = await original<typeof import("three")>();
  return {
    ...three,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      setPixelRatio() {}
      setSize() {}
      render() {}
      dispose() {}
      forceContextLoss() {}
    },
  };
});
vi.mock("three/examples/jsm/controls/OrbitControls.js", async () => {
  const { Vector3 } = await import("three");
  return {
    OrbitControls: class {
      target = new Vector3();
      enabled = true;
      constructor(private camera: import("three").PerspectiveCamera) {}
      addEventListener() {}
      update() {
        this.camera.lookAt(this.target);
        this.camera.updateMatrixWorld();
      }
      dispose() {}
    },
  };
});
const mesh = {
  positions: [-5, -3, 0, 5, -3, 0, 5, 3, 10, -5, 3, 10],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2, 0, 2, 3],
} as unknown as RenderMesh;
let onChange = vi.fn<(value: number) => void>(),
  onCancel = vi.fn<(expression: string) => void>(),
  onDragging = vi.fn<(dragging: boolean) => void>();
function handle(): ExtrudeDistanceHandle {
  return {
    key: "test",
    origin: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    direction: "positive",
    distance: 10,
    expression: "1cm",
    onChange,
    onCancel,
    onDragging,
  };
}
const originalCapture = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "setPointerCapture",
  ),
  originalRelease = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "releasePointerCapture",
  );
beforeEach(() => {
  onChange = vi.fn();
  onCancel = vi.fn();
  onDragging = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 320,
    height: 320,
    bottom: 320,
    right: 320,
    toJSON: () => ({}),
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [key, descriptor] of [
    ["setPointerCapture", originalCapture],
    ["releasePointerCapture", originalRelease],
  ] as const) {
    if (descriptor)
      Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
});
function begin(button: HTMLElement) {
  const x = Number.parseFloat(button.style.left),
    y = Number.parseFloat(button.style.top);
  fireEvent.pointerDown(button, {
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  fireEvent.pointerMove(button, { pointerId: 1, clientX: x, clientY: y - 20 });
}
it.each(["Escape", "pointercancel", "lostpointercapture"])(
  "restores the exact authored expression on %s without committing",
  (reason) => {
    render(<ExtrudePreview meshes={[mesh]} distanceHandle={handle()} />);
    const button = screen.getByRole("button", {
      name: "Drag extrusion distance",
    });
    begin(button);
    expect(onChange).toHaveBeenCalled();
    expect(onDragging).toHaveBeenCalledWith(true);
    if (reason === "Escape") fireEvent.keyDown(button, { key: "Escape" });
    else if (reason === "pointercancel")
      fireEvent.pointerCancel(button, { pointerId: 1 });
    else fireEvent.lostPointerCapture(button, { pointerId: 1 });
    expect(onCancel).toHaveBeenCalledExactlyOnceWith("1cm");
    expect(onDragging).toHaveBeenLastCalledWith(false);
  },
);
it("finishes a gesture without restoring it and cancels changes after source invalidation", () => {
  const { rerender } = render(
    <ExtrudePreview meshes={[mesh]} distanceHandle={handle()} />,
  );
  const button = screen.getByRole("button", {
    name: "Drag extrusion distance",
  });
  begin(button);
  fireEvent.pointerUp(button, { pointerId: 1 });
  fireEvent.lostPointerCapture(button, { pointerId: 1 });
  expect(onCancel).not.toHaveBeenCalled();
  begin(button);
  act(() =>
    rerender(
      <ExtrudePreview
        meshes={[mesh]}
        distanceHandle={{ ...handle(), disabledReason: "Project changed" }}
      />,
    ),
  );
  expect(onCancel).toHaveBeenCalledExactlyOnceWith("1cm");
  expect(button).toBeDisabled();
});
it("provides keyboard increments while preserving protected expressions", () => {
  const { rerender } = render(
    <ExtrudePreview meshes={[mesh]} distanceHandle={handle()} />,
  );
  const button = screen.getByRole("button", {
    name: "Drag extrusion distance",
  });
  fireEvent.keyDown(button, { key: "ArrowUp" });
  expect(onChange).toHaveBeenLastCalledWith(11);
  fireEvent.keyDown(button, { key: "ArrowDown", shiftKey: true });
  expect(onChange).toHaveBeenLastCalledWith(0.001);
  rerender(
    <ExtrudePreview
      meshes={[mesh]}
      distanceHandle={{
        ...handle(),
        expression: "thickness",
        disabledReason: "Distance is an expression",
      }}
    />,
  );
  onChange.mockClear();
  fireEvent.keyDown(button, { key: "ArrowUp" });
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps pointer capture alive outside the viewport and ends without an accidental rollback", () => {
  render(<ExtrudePreview meshes={[mesh]} distanceHandle={handle()} />);
  const button = screen.getByRole("button", {
    name: "Drag extrusion distance",
  });
  begin(button);
  fireEvent.pointerMove(button, {
    pointerId: 1,
    clientX: 1000,
    clientY: -1000,
  });
  expect(screen.getByRole("button", { name: "Drag extrusion distance" })).toBe(
    button,
  );
  fireEvent.pointerUp(button, { pointerId: 1 });
  expect(onCancel).not.toHaveBeenCalled();
  expect(onDragging).toHaveBeenLastCalledWith(false);
});

it("notifies the draft and restores its authored value when unmounted during a gesture", () => {
  const { unmount } = render(
    <ExtrudePreview meshes={[mesh]} distanceHandle={handle()} />,
  );
  begin(screen.getByRole("button", { name: "Drag extrusion distance" }));
  unmount();
  expect(onCancel).toHaveBeenCalledExactlyOnceWith("1cm");
  expect(onDragging).toHaveBeenLastCalledWith(false);
});
