import { describe, expect, it, vi } from "vitest";
import { backgroundJob } from "../persistence/backgroundJob";

describe("background file operations", () => {
  it("rejects malformed worker replies immediately and releases the worker", async () => {
    let worker: any;
    class FakeWorker {
      onmessage?: (event: any) => void;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        worker = this;
      }
    }
    const task = backgroundJob(FakeWorker as unknown as new () => Worker, {});
    worker.onmessage({ data: null });
    await expect(task).rejects.toThrow(/malformed data/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates on cancellation and ignores an already queued late reply", async () => {
    let worker: any;
    class FakeWorker {
      onmessage?: (event: any) => void;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        worker = this;
      }
    }
    const controller = new AbortController(),
      progress = vi.fn();
    const task = backgroundJob(
      FakeWorker as unknown as new () => Worker,
      { file: "project" },
      controller.signal,
      progress,
    );
    controller.abort();
    await expect(task).rejects.toThrow(/cancelled/);
    worker.onmessage({ data: { progress: "late" } });
    worker.onmessage({ data: { result: "stale" } });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
  });
  it("terminates a hung worker without depending on heartbeats", async () => {
    vi.useFakeTimers();
    let worker: any;
    class FakeWorker {
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        worker = this;
      }
    }
    try {
      const task = backgroundJob(
        FakeWorker as unknown as new () => Worker,
        {},
        undefined,
        undefined,
        50,
      );
      const rejected = expect(task).rejects.toThrow(/resource\/time limit/);
      await vi.advanceTimersByTimeAsync(51);
      await rejected;
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
