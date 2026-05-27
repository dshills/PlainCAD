import { describe, expect, it } from "vitest";
import { DisposableScope, getDisposableScopeMetrics, withDisposableScope } from "../cad/kernel/disposableScope";
import { TESSELLATION_LOD, tessellationCacheKey } from "../cad/kernel/tessellationCache";
import { createWorkerRequest, isWorkerRequestExpired, shouldAcceptWorkerResponse } from "../cad/worker/workerLifecycle";

describe("kernel lifecycle hardening", () => {
  it("disposes registered handles in reverse order", () => {
    const disposed: string[] = [];
    const scope = new DisposableScope();
    scope.use({ delete: () => disposed.push("first") });
    scope.use({ delete: () => disposed.push("second") });

    const metrics = scope.dispose();

    expect(disposed).toEqual(["second", "first"]);
    expect(metrics).toMatchObject({ registered: 2, disposed: 2, failures: 0 });
    expect(getDisposableScopeMetrics().registered).toBeGreaterThanOrEqual(2);
  });

  it("disposes handles when scoped operations throw", () => {
    let disposed = false;

    expect(() =>
      withDisposableScope((scope) => {
        scope.use({ delete: () => { disposed = true; } });
        throw new Error("operation failed");
      }),
    ).toThrow("operation failed");
    expect(disposed).toBe(true);
  });

  it("rejects stale worker responses by epoch and request id", () => {
    const request = createWorkerRequest({ type: "rebuild", document: { id: "doc" } }, 10, 3);

    expect(shouldAcceptWorkerResponse({ type: "heartbeat", requestId: 10, epoch: 3, stage: "rebuilding", elapsedMs: 1 }, 3, request)).toBe(true);
    expect(shouldAcceptWorkerResponse({ type: "heartbeat", requestId: 9, epoch: 3, stage: "rebuilding", elapsedMs: 1 }, 3, request)).toBe(false);
    expect(shouldAcceptWorkerResponse({ type: "heartbeat", requestId: 10, epoch: 2, stage: "rebuilding", elapsedMs: 1 }, 3, request)).toBe(false);
  });

  it("expires requests based on last worker progress", () => {
    expect(isWorkerRequestExpired({ startedAt: 0, lastProgressAt: 100, timeoutMs: 500, maxElapsedMs: 2_000 }, 599)).toBe(false);
    expect(isWorkerRequestExpired({ startedAt: 0, lastProgressAt: 100, timeoutMs: 500, maxElapsedMs: 2_000 }, 601)).toBe(true);
    expect(isWorkerRequestExpired({ startedAt: 0, lastProgressAt: 1_900, timeoutMs: 500, maxElapsedMs: 2_000 }, 2_001)).toBe(true);
  });

  it("builds tessellation cache keys from revision, output, tolerances, normals, and lod", () => {
    const key = tessellationCacheKey({
      documentRevision: 42,
      outputId: "body:feature_box",
      options: TESSELLATION_LOD.interaction,
      normalMode: "flat",
      lodProfile: "interaction",
    });

    expect(key).toBe("42:body:feature_box:1.000000:0.350000:flat:interaction");
  });
});
