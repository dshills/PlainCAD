import type { AvailableCapEdge, KernelAdapter, KernelShape } from "../kernel/KernelAdapter";

/** A bounded cache of values, never shapes/handles. Exact signatures include
 * authored entity IDs so a geometrically identical replacement cannot retarget. */
export class NativeEdgeProofCache {
  private namespace?: string;
  private kernel?: KernelAdapter;
  private entries = new Map<string, { edges: AvailableCapEdge[]; cost: number }>();
  private bytes = 0;
  hits = 0;
  misses = 0;

  begin(namespace: string, kernel: KernelAdapter) {
    if (namespace !== this.namespace || kernel !== this.kernel) {
      this.entries.clear();
      this.bytes = 0;
    }
    this.namespace = namespace;
    this.kernel = kernel;
    this.hits = 0;
    this.misses = 0;
  }

  read(kernel: KernelAdapter, shape: KernelShape): AvailableCapEdge[] {
    const signature = kernel.edgeProofSignature?.(shape);
    const previous = signature === undefined ? undefined : this.entries.get(signature);
    if (previous) {
      this.hits++;
      this.entries.delete(signature!);
      this.entries.set(signature!, previous);
      // AvailableCapEdge deliberately contains only flat string fields.
      return previous.edges.map((edge) => ({ ...edge }));
    }
    this.misses++;
    const edges = kernel.availableExtrudeCapEdges?.(shape) ?? [];
    if (signature !== undefined && signature.length <= 262144) {
      const values = edges.map((edge) => ({ ...edge }));
      const cost = signature.length * 2 + JSON.stringify(values).length * 2;
      if (cost <= 4 * 1024 * 1024) {
        while (this.entries.size >= 64 || this.bytes + cost > 4 * 1024 * 1024) {
          const oldest = this.entries.entries().next().value;
          if (!oldest) break;
          this.bytes -= oldest[1].cost;
          this.entries.delete(oldest[0]);
        }
        this.entries.set(signature, { edges: values, cost });
        this.bytes += cost;
      }
    }
    return edges;
  }
}
