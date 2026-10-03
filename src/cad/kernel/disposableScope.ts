export interface DisposableHandle {
  delete?: () => void;
  isDeleted?: () => boolean;
}

export interface DisposableScopeMetrics {
  registered: number;
  disposed: number;
  failures: number;
  released: number;
  alreadyDeleted: number;
}

const aggregateMetrics: DisposableScopeMetrics = {
  registered: 0,
  disposed: 0,
  failures: 0,
  released: 0,
  alreadyDeleted: 0,
};

export class DisposableScope {
  private readonly handles: DisposableHandle[] = [];
  private disposed = false;
  readonly metrics: DisposableScopeMetrics = {
    registered: 0,
    disposed: 0,
    failures: 0,
    released: 0,
    alreadyDeleted: 0,
  };

  use<T extends DisposableHandle | undefined>(handle: T): T {
    if (this.disposed)
      throw new Error("Cannot register a handle in a disposed scope.");
    if (handle?.delete && !this.handles.includes(handle)) {
      this.handles.push(handle);
      this.metrics.registered += 1;
    }
    return handle;
  }

  release<T extends DisposableHandle>(handle: T): T {
    const index = this.handles.lastIndexOf(handle);
    if (index >= 0) {
      this.handles.splice(index, 1);
      this.metrics.released += 1;
    }
    return handle;
  }

  dispose(): DisposableScopeMetrics {
    if (this.disposed) return { ...this.metrics };
    this.disposed = true;
    for (let index = this.handles.length - 1; index >= 0; index -= 1) {
      const handle = this.handles[index];
      try {
        if (!handle.isDeleted?.()) {
          handle.delete?.();
          this.metrics.disposed += 1;
        } else {
          this.metrics.alreadyDeleted += 1;
        }
      } catch {
        this.metrics.failures += 1;
      }
    }
    this.handles.length = 0;
    aggregateMetrics.registered += this.metrics.registered;
    aggregateMetrics.disposed += this.metrics.disposed;
    aggregateMetrics.failures += this.metrics.failures;
    aggregateMetrics.released += this.metrics.released;
    aggregateMetrics.alreadyDeleted += this.metrics.alreadyDeleted;
    return { ...this.metrics };
  }
}

export function withDisposableScope<T>(
  operation: (scope: DisposableScope) => T,
): T {
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
