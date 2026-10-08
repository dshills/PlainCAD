import type { KernelAdapter, KernelShape, RenderMesh } from "../kernel/KernelAdapter";

export interface CachedRuntimeBody {
  shape: KernelShape;
  featureId: string;
  name: string;
  mesh?: RenderMesh;
  planeKey: string;
}

interface Entry {
  key: string;
  version: number;
  bodies: Array<[string, CachedRuntimeBody]>;
  removedIds: string[];
  bytes: number;
}

const DEFAULT_LIMITS = { entries: 128, shapes: 256, bytes: 32 * 1024 * 1024 };

/** Worker-local native ownership. Cache and each rebuild have independent shape
 * wrappers. Failed rebuilds never publish their pending cache entries. */
export class NativeFeatureCache {
  private namespace?: string;
  private epoch?: number;
  private kernel?: KernelAdapter;
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Entry>();
  private nextVersion = 1;
  private bytes = 0;
  private shapes = 0;
  hits = 0;
  misses = 0;
  disposalFailures = 0;

  constructor(private limits = DEFAULT_LIMITS) {}

  begin(namespace: string, kernel: KernelAdapter, epoch?: number) {
    this.disposalFailures = 0;
    if (namespace !== this.namespace || kernel !== this.kernel || epoch !== this.epoch) this.clear();
    this.rollback();
    this.namespace = namespace;
    this.kernel = kernel;
    this.epoch = epoch;
    this.hits = 0;
    this.misses = 0;
  }

  read(key: string): { bodies: Array<[string, CachedRuntimeBody]>; removedIds: string[]; version: number } | undefined {
    const entry = this.entries.get(key);
    if (!entry || !this.kernel?.cloneShape) { this.misses++; return undefined; }
    const bodies: Array<[string, CachedRuntimeBody]> = [];
    try {
      for (const [id, body] of entry.bodies) {
        const mesh = cloneMesh(body.mesh);
        bodies.push([id, { ...body, mesh, shape: this.kernel.cloneShape(body.shape) }]);
      }
    } catch (error) {
      this.disposeBodies(bodies);
      this.remove(key);
      throw error;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return { bodies, removedIds: [...entry.removedIds], version: entry.version };
  }

  stage(key: string, bodies: Array<[string, CachedRuntimeBody]>, removedIds: string[]): number | undefined {
    const version = this.nextVersion++;
    if (!this.kernel?.cloneShape || key.length > 262144 || bodies.some(([, body]) => body.mesh?.geometrySource !== "opencascade" || !body.mesh.geometryAssertions?.valid)) return undefined;
    const bytes = key.length * 2 + bodies.reduce((sum, [, body]) => sum + meshBytes(body.mesh), 0);
    if (bytes > this.limits.bytes || bodies.length > this.limits.shapes) return undefined;
    // Reserve room before creating native copies, including partial-copy paths.
    const previous = this.pending.get(key);
    if (previous) { this.disposeBodies(previous.bodies); this.pending.delete(key); }
    while (this.entries.size + this.pending.size + 1 > this.limits.entries || this.bytes + this.pendingBytes() + bytes > this.limits.bytes || this.shapes + this.pendingShapes() + bodies.length > this.limits.shapes) {
      const committed = this.entries.keys().next().value;
      if (committed !== undefined) { this.remove(committed); continue; }
      const pending = this.pending.keys().next().value;
      if (pending === undefined) break;
      this.disposeBodies(this.pending.get(pending)!.bodies);
      this.pending.delete(pending);
    }
    const owned: Array<[string, CachedRuntimeBody]> = [];
    try {
      for (const [id, body] of bodies) {
        const mesh = cloneMesh(body.mesh);
        owned.push([id, { ...body, mesh, shape: this.kernel.cloneShape(body.shape) }]);
      }
    } catch (error) {
      this.disposeBodies(owned);
      throw error;
    }
    this.pending.set(key, { key, version, bodies: owned, removedIds: [...removedIds], bytes });
    return version;
  }

  finish(success: boolean) {
    if (!success) { this.rollback(); return; }
    for (const [key, entry] of this.pending) {
      this.remove(key);
      while (this.entries.size >= this.limits.entries || this.bytes + entry.bytes > this.limits.bytes || this.shapes + entry.bodies.length > this.limits.shapes) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.remove(oldest);
      }
      this.entries.set(key, entry);
      this.bytes += entry.bytes;
      this.shapes += entry.bodies.length;
    }
    this.pending.clear();
  }

  clear() {
    this.rollback();
    for (const entry of this.entries.values()) this.disposeBodies(entry.bodies);
    this.entries.clear();
    this.bytes = 0;
    this.shapes = 0;
  }

  get size() { return this.entries.size; }
  get retainedShapes() { return this.shapes + this.pendingShapes(); }
  get retainedBytes() { return this.bytes + this.pendingBytes(); }

  private rollback() {
    for (const entry of this.pending.values()) this.disposeBodies(entry.bodies);
    this.pending.clear();
  }
  private pendingBytes() { return [...this.pending.values()].reduce((sum, entry) => sum + entry.bytes, 0); }
  private pendingShapes() { return [...this.pending.values()].reduce((sum, entry) => sum + entry.bodies.length, 0); }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    this.shapes -= entry.bodies.length;
    this.disposeBodies(entry.bodies);
  }
  private disposeBodies(bodies: Array<[string, CachedRuntimeBody]>) {
    for (const [, body] of bodies) try { this.kernel?.disposeShape?.(body.shape); } catch { this.disposalFailures++; }
  }
}

function meshBytes(mesh: RenderMesh | undefined): number {
  return mesh ? (mesh.positions.length + mesh.normals.length + mesh.indices.length) * 8 + 512 : 0;
}

function cloneMesh(mesh: RenderMesh | undefined): RenderMesh | undefined {
  return mesh && { ...mesh, positions: Array.from(mesh.positions), normals: Array.from(mesh.normals), indices: [...mesh.indices], bounds: { min: [...mesh.bounds.min], max: [...mesh.bounds.max] }, geometryAssertions: mesh.geometryAssertions && { ...mesh.geometryAssertions } };
}
