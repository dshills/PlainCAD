import { describe, expect, it, vi } from "vitest";
import { DemandRenderer } from "../viewer/demandRenderer";

function fixture(draw: () => boolean) {
  let id = 0;
  const queued = new Map<number, FrameRequestCallback>();
  const renderer = new DemandRenderer(draw, (callback) => { queued.set(++id, callback); return id; }, (handle) => { queued.delete(handle); });
  const tick = () => {
    const [handle, callback] = queued.entries().next().value!;
    queued.delete(handle);
    callback(0);
  };
  return { renderer, queued, tick };
}

describe("demand rendering", () => {
  it("coalesces scene updates into one frame, sleeps while idle, and resumes on a new change", () => {
    const draw = vi.fn(() => false), { renderer, queued, tick } = fixture(draw);
    renderer.invalidate(); renderer.invalidate(); renderer.invalidate();
    expect(queued.size).toBe(1);
    tick();
    expect(draw).toHaveBeenCalledOnce();
    expect(queued.size).toBe(0);
    expect(renderer.inspect()).toEqual({ frameCount: 1, scheduled: false });
    renderer.invalidate(); tick();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(queued.size).toBe(0);
    renderer.dispose();
  });
  it("continues damping frames until settled and retains invalidations raised during drawing", () => {
    let moving = true;
    const { renderer, queued, tick } = fixture(() => moving);
    renderer.invalidate(); tick(); tick();
    expect(queued.size).toBe(1);
    moving = false; tick();
    expect(queued.size).toBe(0);
    const other = fixture(() => { other.renderer.invalidate(); return false; });
    other.renderer.invalidate(); other.tick();
    expect(other.queued.size).toBe(1);
    renderer.dispose(); other.renderer.dispose();
  });
  it("cancels queued work on disposal and never restarts a removed viewer", () => {
    const draw = vi.fn(() => true), { renderer, queued } = fixture(draw);
    renderer.invalidate();
    const captured = [...queued.values()][0];
    renderer.dispose(); renderer.dispose(); renderer.invalidate();
    expect(queued.size).toBe(0);
    captured(0);
    expect(draw).not.toHaveBeenCalled();
    expect(renderer.inspect().scheduled).toBe(false);
  });
});
