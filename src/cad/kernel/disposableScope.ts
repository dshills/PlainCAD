export interface DisposableHandle {
  delete?: () => void;
  isDeleted?: () => boolean;
}

export interface DisposableScopeMetrics {
  registered: number;
  disposed: number;
  failures: number;
}

const aggregateMetrics: DisposableScopeMetrics = { registered: 0, disposed: 0, failures: 0 };

export class DisposableScope {
  private readonly handles: DisposableHandle[] = [];
  readonly metrics: DisposableScopeMetrics = { registered: 0, disposed: 0, failures: 0 };

  use<T extends DisposableHandle | undefined>(handle: T): T {
    if (handle?.delete) {
      this.handles.push(handle);
      this.metrics.registered += 1;
    }
    return handle;
  }

  dispose(): DisposableScopeMetrics {
    for (let index = this.handles.length - 1; index >= 0; index -= 1) {
      const handle = this.handles[index];
      try {
        if (!handle.isDeleted?.()) {
          handle.delete?.();
          this.metrics.disposed += 1;
        }
      } catch {
        this.metrics.failures += 1;
      }
    }
    this.handles.length = 0;
    aggregateMetrics.registered += this.metrics.registered;
    aggregateMetrics.disposed += this.metrics.disposed;
    aggregateMetrics.failures += this.metrics.failures;
    return { ...this.metrics };
  }
}

export function withDisposableScope<T>(operation: (scope: DisposableScope) => T): T {
  const scope = new DisposableScope();
  try {
    return operation(scope);
  } finally {
    scope.dispose();
  }
}

export function getDisposableScopeMetrics(): DisposableScopeMetrics {
  return { ...aggregateMetrics };
}
