export type JobReply<T> =
  { result: T } | { error: string } | { progress: string };

export function backgroundJob<Request, Result>(
  Factory: new () => Worker,
  request: Request,
  signal?: AbortSignal,
  progress?: (message: string) => void,
  timeoutMs = 30000,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Operation cancelled."));
      return;
    }
    const worker = new Factory();
    let settled = false;
    const finish = (error?: Error, result?: Result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new Error("Operation cancelled."));
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            "Operation exceeded its resource/time limit. Simplify the project and retry.",
          ),
        ),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<JobReply<Result>>) => {
      if (settled) return;
      if (
        !event.data ||
        typeof event.data !== "object" ||
        !(
          "progress" in event.data ||
          "error" in event.data ||
          "result" in event.data
        )
      ) {
        finish(new Error("Background operation returned malformed data."));
        return;
      }
      if ("progress" in event.data) progress?.(event.data.progress);
      else if ("error" in event.data) finish(new Error(event.data.error));
      else finish(undefined, event.data.result);
    };
    worker.onerror = (event) =>
      finish(new Error(event.message || "Background operation failed."));
    worker.onmessageerror = () =>
      finish(new Error("Background operation returned unreadable data."));
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
