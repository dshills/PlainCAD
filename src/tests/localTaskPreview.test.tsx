import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOCAL_TASK_PREVIEW_DELAY_MS, localPreviewExpressionReady, useLocalTaskPreview } from "../ui/panels/useLocalTaskPreview";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("coalesces rapid input changes and runs the latest local preview once", () => {
  const scope = {}, preview = vi.fn();
  const hook = renderHook(({ value }) => useLocalTaskPreview(scope, value, true, () => preview(value)), { initialProps: { value: "2mm" } });
  act(() => vi.advanceTimersByTime(200));
  hook.rerender({ value: "3mm" });
  act(() => vi.advanceTimersByTime(200));
  hook.rerender({ value: "4mm" });
  act(() => vi.advanceTimersByTime(LOCAL_TASK_PREVIEW_DELAY_MS - 1));
  expect(preview).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(preview).toHaveBeenCalledExactlyOnceWith("4mm");
  hook.rerender({ value: "4mm" });
  act(() => vi.advanceTimersByTime(1000));
  expect(preview).toHaveBeenCalledTimes(1);
});
it("cancels queued work on explicit retry, closing, unavailable inputs, or unmount", () => {
  const scope = {}, preview = vi.fn();
  const hook = renderHook(({ current, enabled }) => useLocalTaskPreview(current, "inputs", enabled, preview), { initialProps: { current: scope as object | undefined, enabled: true } });
  act(() => hook.result.current());
  act(() => vi.advanceTimersByTime(1000));
  expect(preview).not.toHaveBeenCalled();
  hook.rerender({ current: {}, enabled: true });
  hook.rerender({ current: undefined, enabled: true });
  act(() => vi.advanceTimersByTime(1000));
  hook.rerender({ current: scope, enabled: true });
  hook.rerender({ current: scope, enabled: false });
  act(() => vi.advanceTimersByTime(1000));
  hook.rerender({ current: scope, enabled: true });
  hook.unmount();
  act(() => vi.advanceTimersByTime(1000));
  expect(preview).not.toHaveBeenCalled();
});

it("waits for unfinished arithmetic but allows complete quantities and expressions", () => {
  for (const value of ["", "2*", "2+", "(2mm", "max(2mm,"]) expect(localPreviewExpressionReady(value)).toBe(false);
  for (const value of ["2m", "2mm", "2 * 3mm", "max(2mm, 3mm)", "wall", "wrongUnit"]) expect(localPreviewExpressionReady(value)).toBe(true);
});
