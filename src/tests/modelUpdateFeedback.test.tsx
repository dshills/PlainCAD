import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelUpdateFeedback, sameModelGeometry } from "../ui/workspace/ModelUpdateFeedback";
import { useCadStore } from "../state/useCadStore";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import type { RebuildResult } from "../cad/worker/workerProtocol";

// Protocol fixtures verify confirmation guards. Native modeling is proven in Chromium.
function mesh(size = 1): RenderMesh {
  return { id: "body", bodyId: "body", positions: [0, 0, 0, size, 0, 0, 0, size, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], bounds: { min: [0, 0, 0], max: [size, size, 0] }, geometrySource: "opencascade", geometryAssertions: { valid: true, volume: size, surfaceArea: size, solidCount: 1 } };
}
function result(meshes: RenderMesh[], success = true): RebuildResult {
  return { documentId: useCadStore.getState().history.present.id, success, meshes, bodies: [], errors: [], warnings: [], durationMs: 1 };
}
function complete(meshes: RenderMesh[], success = true) {
  act(() => useCadStore.setState({ rebuild: { kernelReady: true, status: success ? "succeeded" : "failed", result: result(meshes, success) } }));
}
beforeEach(() => { vi.useFakeTimers(); useCadStore.setState(useCadStore.getInitialState(), true); complete([]); });
afterEach(() => { cleanup(); vi.useRealTimers(); useCadStore.setState(useCadStore.getInitialState(), true); });

it("confirms a changed accepted native result after an empty project, then removes feedback without persistent timers", () => {
  render(<ModelUpdateFeedback />);
  expect(screen.queryByText(/Model updated/)).toBeNull();
  complete([mesh()]);
  expect(screen.getByText(/Model updated/)).toBeVisible();
  act(() => vi.advanceTimersByTime(1800));
  expect(screen.queryByText(/Model updated/)).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
it("does not confirm initial load, metadata-only rebuilds, failures, fallback or unmatched document results", () => {
  complete([mesh()]);
  render(<ModelUpdateFeedback />);
  complete([{ ...mesh(), color: "red" }]);
  complete([mesh(2)], false);
  complete([{ ...mesh(2), geometrySource: "fallback" }]);
  act(() => useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: { ...result([mesh(3)]), documentId: "stale" } } }));
  expect(screen.queryByText(/Model updated/)).toBeNull();
  complete([mesh(2)]);
  expect(screen.getByText(/Model updated/)).toBeVisible();
});
it("clears confirmations on project replacement and seeds its new native model without a success flash", () => {
  render(<ModelUpdateFeedback />);
  complete([mesh()]);
  act(() => useCadStore.setState((state) => ({ documentSession: state.documentSession + 1, rebuild: { status: "succeeded", kernelReady: true, result: result([mesh(4)]) } })));
  expect(screen.queryByText(/Model updated/)).toBeNull();
  complete([mesh(5)]);
  expect(screen.getByText(/Model updated/)).toBeVisible();
});
it("compares actual vertices, topology and body identity rather than metadata or object identity", () => {
  expect(sameModelGeometry([mesh()], [mesh()])).toBe(true);
  expect(sameModelGeometry([mesh()], [mesh(2)])).toBe(false);
  expect(sameModelGeometry([mesh()], [{ ...mesh(), indices: [2, 1, 0] }])).toBe(false);
  expect(sameModelGeometry([mesh()], [{ ...mesh(), bodyId: "other" }])).toBe(false);
  expect(sameModelGeometry([mesh()], [])).toBe(false);
});
