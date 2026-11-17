import wasmUrl from "./plainsolid-kernel.wasm?url";
import { rectangularShellDimensions, requireShellOpening } from "../features/shellFeature";
import type { NativeStepExport } from "./nativeStep";
import type { LeadScrewDimensions } from "../hardware/leadScrewSettings";
import type { ThreadDimensions } from "../hardware/threadSettings";
import type { ComponentPlacement, TopologyRef, RevolveAxisReference, ThreadFeature } from "../document/schema";
import { placementTransform } from "../document/componentPlacement";
import { createId } from "../document/ids";
import type { KernelAdapter, KernelShape, RenderMesh, GeometryAssertions, BoundingBox, TessellationOptions, ResolvedRevolveAxis } from "./KernelAdapter";
import { HoleScopeError, PocketFloorMismatchError } from "./KernelAdapter";
import { withDisposableScope } from "./disposableScope";
import { assertMeshBudget } from "../resourceLimits";
import type { SketchProfile, ProfileLoop } from "../sketch/profileDetection";
import { transformPoint, type SketchPlaneTransform } from "../sketch/planes";

type Proof = { handle: string; geometryAssertions: GeometryAssertions; bounds: BoundingBox };
type Handle = {
  proof: Proof;
  operation: RenderMesh["kernelOperation"];
  edgeProofIdentity: string;
  disposed?: boolean;
  extrusion?: { profile: SketchProfile; distance: number; transform: SketchPlaneTransform };
};
type Runtime = typeof globalThis & {
  Go?: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> };
  plainSolidCall?: (request: string) => string;
};
const runtime = globalThis as Runtime;
let initialization: Promise<void> | undefined;
let wasmMemory: WebAssembly.Memory | undefined;

function request<T>(args: Record<string, unknown>): T {
  if (!runtime.plainSolidCall) throw new Error("PlainSolid WebAssembly is not initialized.");
  const response = JSON.parse(runtime.plainSolidCall(JSON.stringify(args)));
  if (!response.ok) throw new Error(`PlainSolid ${response.error.code}: ${response.error.message}`);
  return response.result as T;
}
function handle(shape: KernelShape): Handle { return shape.kernelHandle as Handle; }
function owned(proof: Proof, operation: RenderMesh["kernelOperation"], id = createId("shape")): KernelShape {
  return { id, kernelHandle: { proof, operation, edgeProofIdentity: proof.handle } satisfies Handle };
}
const xyz = (point: { x: number; y: number; z: number }) => [point.x, point.y, point.z];
const defaultPlane: SketchPlaneTransform = { origin: { x: 0, y: 0, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };

function continuesStraight(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): boolean {
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
  return ux * vy === uy * vx && ux * vx + uy * vy > 0;
}

function straightLoopCorners(segments: NonNullable<ProfileLoop["segments"]>) {
  return segments.flatMap((segment, i) => {
    const previous = segments[(i + segments.length - 1) % segments.length];
    const connected = previous.end.x === segment.start.x && previous.end.y === segment.start.y;
    return connected && continuesStraight(previous.start, segment.start, segment.end) ? [] : [segment.start];
  });
}

function mixedExtrusionRequest(profile: SketchProfile, distance: number, transform: SketchPlaneTransform): Record<string, unknown> | undefined {
  type Point = { x: number; y: number };
  type Arc = Extract<NonNullable<ProfileLoop["segments"]>[number], { type: "arc" }>;
  const epsilon = 1e-8;
  const close = (a: number, b: number) => Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b));
  const same = (a: Point, b: Point) => close(a.x, b.x) && close(a.y, b.y);
  const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
  const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
  const scale = (a: Point, value: number): Point => ({ x: a.x * value, y: a.y * value });
  const length = (a: Point) => Math.hypot(a.x, a.y);
  const fail = (): never => { throw new Error("Mixed extrusion requires a supported closed line-and-arc loop or a profile with valid interior loops."); };
  const validateLoop = (loop: ProfileLoop) => {
    const segments = loop.segments;
    if (!segments?.length) return fail();
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (![segment.start.x, segment.start.y, segment.end.x, segment.end.y].every(Number.isFinite) || !same(segment.end, segments[(i + 1) % segments.length].start)) fail();
      if (segment.type === "arc") {
        if (![segment.center.x, segment.center.y, segment.radius, segment.startAngle, segment.sweep].every(Number.isFinite) || segment.radius <= 0 || segment.sweep === 0 || Math.abs(segment.sweep) >= 2 * Math.PI) fail();
        const pointAt = (angle: number) => ({ x: segment.center.x + segment.radius * Math.cos(angle), y: segment.center.y + segment.radius * Math.sin(angle) });
        if (!same(segment.start, pointAt(segment.startAngle)) || !same(segment.end, pointAt(segment.startAngle + segment.sweep))) fail();
      }
    }
    return segments;
  };
  const capsule = (loop: ProfileLoop) => {
    const segments = validateLoop(loop), arcs = segments.filter((segment): segment is Arc => segment.type === "arc");
    if (segments.length !== 4 || arcs.length !== 2 || arcs.some(arc => !close(Math.abs(arc.sweep), Math.PI)) || !close(arcs[0].radius, arcs[1].radius)) return fail();
    let left = arcs[0], right = arcs[1];
    const axis = subtract(right.center, left.center), separation = length(axis);
    if (!Number.isFinite(separation) || separation <= epsilon) return fail();
    const u = scale(axis, 1 / separation), v = { x: -u.y, y: u.x }, radius = left.radius;
    for (const [arc, sign] of [[left, -1], [right, 1]] as const) {
      const midpoint = { x: Math.cos(arc.startAngle + arc.sweep / 2), y: Math.sin(arc.startAngle + arc.sweep / 2) };
      if (!close(dot(midpoint, u), sign)) fail();
      for (const endpoint of [arc.start, arc.end]) {
        const radial = subtract(endpoint, arc.center);
        if (!close(dot(radial, u), 0) || !close(Math.abs(dot(radial, v)), radius)) fail();
      }
    }
    // The two lines must be the actual external tangents, not diagonals.
    for (const line of segments.filter(segment => segment.type === "line")) {
      const a = subtract(line.start, left.center), b = subtract(line.end, left.center);
      if (!close(dot(a, v), dot(b, v)) || !close(Math.abs(dot(a, v)), radius) || !close(Math.abs(dot(subtract(line.end, line.start), u)), separation)) fail();
    }
    return { center: left.center, right: right.center, radius, separation, u };
  };
  const circleHoles = () => {
    const missingCircle = (): never => { throw new Error("Inner circle profile is missing a unique valid circle definition."); };
    if (profile.innerLoops.length !== profile.holes.length) return missingCircle();
    const used = new Set<string>();
    const circles = profile.innerLoops.map(loop => {
      if (loop.type !== "circle" || loop.entityIds.length !== 1 || used.has(loop.entityIds[0])) return missingCircle();
      const id = loop.entityIds[0], matches = profile.holes.filter(hole => hole.id === id);
      if (matches.length !== 1) return missingCircle();
      used.add(id);
      const hole = matches[0];
      if (![hole.x, hole.y, hole.radius].every(Number.isFinite) || hole.radius <= 0) return missingCircle();
      return { center: [hole.x, hole.y], radius: hole.radius };
    });
    return circles;
  };
  const common = { origin: xyz(transform.origin), normal: xyz(transform.normal), xDirection: xyz(transform.u), height: distance };
  const localFrame = (center: Point, u: Point) => ({
    ...common,
    origin: xyz(transformPoint(transform, center.x, center.y)),
    xDirection: xyz({ x: transform.u.x * u.x + transform.v.x * u.y, y: transform.u.y * u.x + transform.v.y * u.y, z: transform.u.z * u.x + transform.v.z * u.y }),
  });
  if (profile.outerLoop.type === "circle") {
    if (!profile.innerLoops.length && !profile.holes.length) return undefined;
    const { minX, minY, maxX, maxY } = profile.bounds, diameter = maxX - minX;
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || diameter <= 0 || !close(diameter, maxY - minY)) return fail();
    return { op: "mixedExtrude", profile: { ...common, kind: "disk", center: [(minX + maxX) / 2, (minY + maxY) / 2], radius: diameter / 2, circles: circleHoles() } };
  }
  const arcs = profile.outerLoop.segments?.filter((segment): segment is Arc => segment.type === "arc") ?? [];
  if (!arcs.length) {
    if (!profile.innerLoops.some(loop => loop.type === "circle")) return undefined;
    const segments = validateLoop(profile.outerLoop);
    return { op: "mixedExtrude", profile: { ...common, kind: "polygon", outer: straightLoopCorners(segments).map(point => [point.x, point.y]), circles: circleHoles() } };
  }
  const arcLoop = () => {
    if (profile.innerLoops.length || profile.holes.length) return fail();
    const segments = validateLoop(profile.outerLoop);
    const point = (p: Point) => [p.x, p.y];
    return { op: "mixedExtrude", profile: { ...common, kind: "arcLoop",
      segments: segments.map((segment, i) => ({
        start: point(segment.start), end: point(segments[(i + 1) % segments.length].start),
        ...(segment.type === "arc" ? { center: point(segment.center), radius: segment.radius,
          startAngle: segment.startAngle, sweep: segment.sweep } : {}),
      })),
    } };
  };
  if (arcs.length === 1) {
    const segments = validateLoop(profile.outerLoop), arc = arcs[0];
    if (segments.length !== 2 || profile.innerLoops.length || profile.holes.length) return arcLoop();
    if (Math.abs(arc.sweep) !== Math.PI) {
      // Keep the solved arc and its chord exactly; a near-semicircle is not a
      // semicircle and must not be snapped by loosening the classifier tolerance.
      return { op: "mixedExtrude", profile: { ...common, kind: "circularSegment", center: [arc.center.x, arc.center.y], radius: arc.radius, startAngle: arc.startAngle, sweep: arc.sweep } };
    }
    const u = scale(subtract(arc.start, arc.center), Math.sign(arc.sweep) / arc.radius);
    return { op: "mixedExtrude", profile: { ...localFrame(arc.center, u), kind: "semicircle", center: [0, 0], radius: arc.radius } };
  }
  if (arcs.length === 4) {
    const segments = validateLoop(profile.outerLoop), lines = segments.filter(segment => segment.type === "line");
    if (segments.length !== 8 || lines.length !== 4 || arcs.some(arc => Math.abs(arc.sweep) !== Math.PI / 2)) return arcLoop();
    // This bounded family is proved from authored cardinal endpoints, not from
    // sampled bounds or a tolerance-based replacement of an arbitrary arc.
    const points = segments.flatMap(segment => [segment.start, segment.end]);
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const exact = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
    const corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
    const incoming = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }];
    const outgoing = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
    const radii: number[] = [], starts: Point[] = [], ends: Point[] = [], used = new Set<Arc>();
    for (let i = 0; i < 4; i++) {
      const corner = corners[i], a = incoming[i], b = outgoing[i];
      const matches = arcs.filter(arc => {
        const radius = arc.radius;
        const center = { x: corner.x + radius * (a.x + b.x), y: corner.y + radius * (a.y + b.y) };
        const start = { x: corner.x + radius * a.x, y: corner.y + radius * a.y };
        const end = { x: corner.x + radius * b.x, y: corner.y + radius * b.y };
        return exact(arc.center, center) && ((arc.sweep > 0 && exact(arc.start, start) && exact(arc.end, end)) || (arc.sweep < 0 && exact(arc.start, end) && exact(arc.end, start)));
      });
      if (matches.length !== 1 || used.has(matches[0])) return arcLoop();
      const arc = matches[0], radius = arc.radius; used.add(arc); radii.push(radius);
      starts.push({ x: corner.x + radius * a.x, y: corner.y + radius * a.y });
      ends.push({ x: corner.x + radius * b.x, y: corner.y + radius * b.y });
    }
    const usedLines = new Set<typeof lines[number]>();
    for (let i = 0; i < 4; i++) {
      const a = ends[i], b = starts[(i + 1) % 4];
      const matches = lines.filter(line => (exact(line.start, a) && exact(line.end, b)) || (exact(line.start, b) && exact(line.end, a)));
      if (matches.length !== 1 || usedLines.has(matches[0]) || exact(a, b)) return arcLoop();
      usedLines.add(matches[0]);
    }
    return { op: "mixedExtrude", profile: { ...common, kind: "roundedRectangle", min: [minX, minY], max: [maxX, maxY], radii, circles: circleHoles() } };
  }
  if (arcs.length !== 2 || profile.outerLoop.segments?.length !== 4 ||
      arcs.some(arc => !close(Math.abs(arc.sweep), Math.PI)) || !close(arcs[0].radius, arcs[1].radius)) return arcLoop();
  let outer: ReturnType<typeof capsule>;
  try {
    outer = capsule(profile.outerLoop);
  } catch (error) {
    if (profile.innerLoops.length || profile.holes.length) throw error;
    return arcLoop();
  }
  let innerRadius: number | undefined;
  if (profile.innerLoops.length) {
    if (profile.innerLoops.length !== 1 || profile.innerLoops[0].type !== "polygon" || profile.holes.length) return fail();
    const inner = capsule(profile.innerLoops[0]);
    if (!((same(inner.center, outer.center) && same(inner.right, outer.right)) || (same(inner.center, outer.right) && same(inner.right, outer.center))) || inner.radius >= outer.radius) return fail();
    innerRadius = inner.radius;
  } else if (profile.holes.length) return fail();
  return { op: "mixedExtrude", profile: { ...localFrame(outer.center, outer.u), kind: "capsule", center: [0, 0], right: [outer.separation, 0], radius: outer.radius, innerRadius } };
}

export class PlainSolidKernel implements KernelAdapter {
  static readonly source = "plainsolid";
  static readonly requiresWorker = true;
  static readonly liveHandleLimit = 256;

  static async initialize(): Promise<void> {
    initialization ??= (async () => {
      // Dynamic module import works in both module workers and the window.
      await import("./wasm_exec.js");
      if (!runtime.Go) throw new Error("Go WebAssembly runtime did not initialize.");
      const go = new runtime.Go();
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error(`PlainSolid WASM fetch failed: ${response.status}`);
      const compiled = await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject);
      const memory = compiled.instance.exports.mem;
      if (memory instanceof WebAssembly.Memory) wasmMemory = memory;
      void go.run(compiled.instance);
      if (!runtime.plainSolidCall) throw new Error("PlainSolid WASM did not install its dispatcher.");
      request({ op: "capabilities" });
    })();
    return initialization;
  }
  static isInitialized() { return typeof runtime.plainSolidCall === "function"; }
  static stepExportDiagnostic(): string | undefined { return this.isInitialized() ? undefined : "PlainSolid WebAssembly is not initialized."; }
  static stepImportDiagnostic(): string | undefined { return this.isInitialized() ? undefined : "PlainSolid WebAssembly is not initialized."; }
  static shellAvailable() { return this.isInitialized(); }
  static threadsAvailable() { return Boolean(runtime.plainSolidCall); }

  createBox(width: number, height: number, depth: number): KernelShape {
    return owned(request({ op: "box", min: [-width / 2, -height / 2, 0], max: [width / 2, height / 2, depth] }), "box");
  }
  extrudeProfile(profile: SketchProfile, distance: number, transform = defaultPlane): KernelShape {
    if (!Number.isFinite(distance) || distance <= 0) throw new Error("Extrude distance must be a positive finite length.");
    const mixed = mixedExtrusionRequest(profile, distance, transform);
    if (mixed) {
      const shape = owned(request(mixed), "extrusion");
      handle(shape).extrusion = { profile: structuredClone(profile), distance, transform: structuredClone(transform) };
      return shape;
    }
    if (profile.outerLoop.type === "circle") {
      if (profile.innerLoops.length || profile.holes.length)
        throw new Error("PlainSolid circular extrusion does not yet support inner loops.");
      const { minX, maxX, minY, maxY } = profile.bounds;
      const diameter = maxX - minX, otherDiameter = maxY - minY;
      if (![minX, maxX, minY, maxY, diameter, otherDiameter, distance].every(Number.isFinite) || diameter <= 0 || otherDiameter <= 0 || distance === 0 ||
          Math.abs(diameter - otherDiameter) > 1e-8 * Math.max(1, diameter, otherDiameter))
        throw new Error("Circular extrusion requires a finite circle and nonzero distance.");
      const center = transformPoint(transform, minX + diameter / 2, minY + otherDiameter / 2);
      const shape = owned(request({ op: "circle", origin: xyz(center), normal: xyz(transform.normal), radius: diameter / 2, height: distance }), "extrusion");
      handle(shape).extrusion = { profile: structuredClone(profile), distance, transform: structuredClone(transform) };
      return shape;
    }
    const loop = (boundary: ProfileLoop) => {
      if (boundary.type !== "polygon" || !boundary.segments?.length || boundary.segments.some(segment => segment.type !== "line"))
        throw new Error("PlainSolid adapter requires exact straight polygon loops or a single full circle; mixed arcs and curved inner loops are unsupported.");
      return straightLoopCorners(boundary.segments).map(point => xyz(transformPoint(transform, point.x, point.y)));
    };
    const shape = owned(request({ op: "prism", outer: loop(profile.outerLoop), holes: profile.innerLoops.map(loop), offset: xyz(transform.normal).map(value => value * distance) }), "extrusion");
    handle(shape).extrusion = { profile: structuredClone(profile), distance, transform: structuredClone(transform) };
    return shape;
  }
  cloneShape(shape: KernelShape): KernelShape {
    const metadata = shape.metadata === undefined ? undefined : structuredClone(shape.metadata);
    const copy = this.retainExtrusion(
      owned(request({ op: "clone", handle: handle(shape).proof.handle }), handle(shape).operation, shape.id),
      shape,
    );
    handle(copy).edgeProofIdentity = handle(shape).edgeProofIdentity;
    if (metadata !== undefined) copy.metadata = metadata;
    return copy;
  }
  placeShape(shape: KernelShape, placement: ComponentPlacement): KernelShape {
    const metadata = shape.metadata === undefined ? undefined : structuredClone(shape.metadata);
    const frame = placementTransform(placement);
    const matrix = (["x", "y", "z"] as const).map(axis => [frame.u[axis], frame.v[axis], frame.normal[axis], frame.origin[axis]]);
    const result = this.retainExtrusion(
      owned(request({ op: "transform", handle: handle(shape).proof.handle, matrix }), handle(shape).operation, shape.id),
      shape,
    );
    // A cached native feature can be placed again on every rebuild. Its
    // immutable source and exact placement determine the same edge proof.
    handle(result).edgeProofIdentity = JSON.stringify([handle(shape).edgeProofIdentity, matrix]);
    if (metadata !== undefined) result.metadata = metadata;
    const source = handle(result).extrusion;
    if (source) {
      const vector = (v: { x: number; y: number; z: number }) => ({
        x: frame.u.x * v.x + frame.v.x * v.y + frame.normal.x * v.z,
        y: frame.u.y * v.x + frame.v.y * v.y + frame.normal.y * v.z,
        z: frame.u.z * v.x + frame.v.z * v.y + frame.normal.z * v.z,
      });
      const t = source.transform;
      source.transform = {
        origin: transformPoint(frame, t.origin.x, t.origin.y, t.origin.z),
        u: vector(t.u), v: vector(t.v), normal: vector(t.normal),
      };
    }
    return result;
  }
  private retainExtrusion(result: KernelShape, source: KernelShape): KernelShape {
    if (handle(source).extrusion) handle(result).extrusion = structuredClone(handle(source).extrusion);
    return result;
  }
  nativeBounds(shape: KernelShape): BoundingBox { return request<Proof>({ op: "inspect", handle: handle(shape).proof.handle }).bounds; }
  private boolean(base: KernelShape, tool: KernelShape, op: "cut" | "fuse", exportUnion = false): KernelShape {
    const a = request<Proof>({ op: "inspect", handle: handle(base).proof.handle });
    const b = request<Proof>({ op: "inspect", handle: handle(tool).proof.handle });
    return withDisposableScope(scope => {
      const result = request<Proof>({ op, a: a.handle, b: b.handle });
      const allocation = scope.use({ delete: () => request({ op: "dispose", handle: result.handle }) });
      const before = a.geometryAssertions.volume, after = result.geometryAssertions;
      const tolerance = Math.max(1e-9, Math.abs(before) * 1e-10);
      if (!after.valid || !Number.isFinite(after.volume) || after.volume <= 1e-12 || after.solidCount < 1)
        throw new Error("Boolean operation produced no solid volume.");
      if (op === "cut" && before - after.volume <= tolerance)
        throw new Error("Boolean cut removed no volume. Move the tool into the target body.");
      if (op === "fuse" && !exportUnion && after.solidCount !== 1)
        throw new Error("Boolean join requires connected solids.");
      if (op === "fuse" && !exportUnion && after.volume - before <= tolerance)
        throw new Error("Boolean join added no volume. The tool is already contained in the target body.");
      if (op === "fuse" && (after.volume > before + b.geometryAssertions.volume + tolerance || after.volume < Math.max(before, b.geometryAssertions.volume) - tolerance))
        throw new Error("Boolean union produced an inconsistent solid volume.");
      const output = this.retainExtrusion(owned(result, op, base.id), base);
      scope.release(allocation);
      return output;
    });
  }
  cut(base: KernelShape, tool: KernelShape): KernelShape { return this.boolean(base, tool, "cut"); }
  fuse(base: KernelShape, tool: KernelShape): KernelShape { return this.boolean(base, tool, "fuse"); }
  unionForExport(base: KernelShape, tool: KernelShape): KernelShape { return this.boolean(base, tool, "fuse", true); }
  cutAll(base: KernelShape, tools: KernelShape[]): KernelShape {
    let current = this.cloneShape(base);
    try { for (const tool of tools) { const next = this.cut(current, tool); this.disposeShape(current); current = next; } return current; }
    catch (error) { this.disposeShape(current); throw error; }
  }
  tessellate(shape: KernelShape, options: TessellationOptions): RenderMesh {
    const mesh = request<Omit<RenderMesh, "id" | "bodyId">>({ op: "mesh", handle: handle(shape).proof.handle, linearDeflection: options.linearDeflection, angularDeflection: options.angularDeflection,
      analyticNormals: "analyticNormals" in options && options.analyticNormals === true });
    assertMeshBudget(mesh.positions.length / 3, mesh.indices.length / 3);
    return { ...mesh, id: shape.id, bodyId: shape.id, geometrySource: "plainsolid", kernelOperation: handle(shape).operation };
  }
  nativeDisplayEdges(shape: KernelShape, maxSegments: number, budget?: { edgeUses: number }): Float32Array {
    const maxEdgeUses = Math.min(12_000, budget?.edgeUses ?? 12_000);
    if (maxEdgeUses <= 0) return new Float32Array();
    let result: { segments: number[]; edgeUses: number };
    try {
      result = request({
        op: "displayEdges", handle: handle(shape).proof.handle, maxEdgeUses, maxEdgeSegments: maxSegments,
      });
    } catch (error) {
      // The bridge cannot report partial work in an error response.
      if (budget) budget.edgeUses -= maxEdgeUses;
      throw error;
    }
    if (budget) budget.edgeUses -= result.edgeUses;
    const segments = Float32Array.from(result.segments);
    if (!segments.every(Number.isFinite)) throw new Error("A native edge exceeds the display coordinate range.");
    return segments;
  }
  exportStl(shape: KernelShape): ArrayBuffer {
    const { base64 } = request<{ base64: string }>({ op: "stl", handle: handle(shape).proof.handle, linearDeflection: 0.5, angularDeflection: 0.2 });
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0)).buffer;
  }
  disposeShape(shape: KernelShape) {
    const state = handle(shape);
    if (state.disposed) return;
    request({ op: "dispose", handle: state.proof.handle });
    state.disposed = true;
  }
  // Unproved reference queries reject or return no eligible references.
  validatePlanarFace(shape: KernelShape, plane: SketchPlaneTransform): void {
    request({ op: "planarFace", handle: handle(shape).proof.handle, origin: xyz(plane.origin), normal: xyz(plane.normal) });
  }
  validatePocketFloor(shape: KernelShape, plane: SketchPlaneTransform, profile: SketchProfile): void {
    const segments = profile.outerLoop.segments;
    if (!segments?.length || segments.some(segment => segment.type !== "line") || profile.innerLoops.length)
      throw new Error("Pocket floor proof requires one bounded straight profile.");
    const outer = segments.map(segment => xyz(transformPoint(plane, segment.start.x, segment.start.y)));
    try {
      request({ op: "pocketFloor", handle: handle(shape).proof.handle, origin: xyz(plane.origin), normal: xyz(plane.normal), outer });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PlainSolid MISMATCH:"))
        throw new PocketFloorMismatchError(error.message);
      throw error;
    }
  }
  measureHoleRim(shape: KernelShape, center: { x: number; y: number; z: number }, outward: { x: number; y: number; z: number }, radius: number) {
    const rim = request<{ center: [number, number, number]; radius: number } | null | undefined>({
      op: "holeRim", handle: handle(shape).proof.handle, center: xyz(center), normal: xyz(outward), radius,
    });
    if (!rim) return undefined;
    const [x, y, z] = rim.center;
    return { center: { x, y, z }, radius: rim.radius };
  }
  private capEdge(shape: KernelShape, ref: TopologyRef): { edgeStart: number[]; edgeEnd: number[]; normal: number[] } {
    const source = handle(shape).extrusion;
    if (!source || ref.kind !== "edge" || ref.repairRequired || !ref.sourceEntityId ||
        (ref.role !== "startCapPerimeter" && ref.role !== "endCapPerimeter"))
      throw new Error("Edge treatment requires one authored straight cap edge on its original extrusion.");
    const segments = source.profile.outerLoop.type === "polygon" ? source.profile.outerLoop.segments ?? [] : [];
    const matches = segments.filter(segment => segment.id === ref.sourceEntityId);
    if (matches.length !== 1 || matches[0].type !== "line")
      throw new Error("Edge reference was lost or is ambiguous. Reselect the current feature-owned perimeter.");
    const segment = matches[0];
    const height = ref.role === "startCapPerimeter" ? 0 : source.distance;
    return {
      edgeStart: xyz(transformPoint(source.transform, segment.start.x, segment.start.y, height)),
      edgeEnd: xyz(transformPoint(source.transform, segment.end.x, segment.end.y, height)),
      normal: xyz(source.transform.normal).map(value => value * Math.sign(source.distance)),
    };
  }
  private profileEdges(shape: KernelShape, ref: TopologyRef): { edgeStart: number[]; edgeEnd: number[]; normal: number[] }[] {
    const source = handle(shape).extrusion;
    if (!source || ref.kind !== "edge" || ref.role !== "profileEdge" || ref.repairRequired || !ref.sourceEntityId)
      throw new Error("Profile edge treatment requires an authored straight segment on its original extrusion.");
    const segments = source.profile.outerLoop.type === "polygon" ? source.profile.outerLoop.segments ?? [] : [];
    const matches = segments.filter(segment => segment.id === ref.sourceEntityId);
    if (matches.length !== 1 || matches[0].type !== "line")
      throw new Error("Authored profile edge is missing, ambiguous, or curved; repair the edge reference.");
    const segment = matches[0];
    const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) === 0)
      throw new Error("Profile edge treatment requires a nondegenerate straight segment.");
    // A profile-line reference owns the two axial edges at its endpoints.
    // Reorient the stock frame using the line's in-plane perpendicular; its
    // longitudinal axis is now the extrusion direction, including signed depth.
    const normal = xyz({ x: source.transform.u.x * dy - source.transform.v.x * dx,
      y: source.transform.u.y * dy - source.transform.v.y * dx,
      z: source.transform.u.z * dy - source.transform.v.z * dx });
    const edges = [segment.start, segment.end].map(point => ({
      edgeStart: xyz(transformPoint(source.transform, point.x, point.y, 0)),
      edgeEnd: xyz(transformPoint(source.transform, point.x, point.y, source.distance)), normal,
    }));
    if (edges.some(edge => !request<{ available: boolean }>({
      op: "edgeAvailable", handle: handle(shape).proof.handle, ...edge,
    }).available))
      throw new Error("Some selected edges are not sharp treatment contours. Reselect sharp edges.");
    return edges;
  }
  availableExtrudeCapEdges(shape: KernelShape): ReturnType<NonNullable<KernelAdapter["availableExtrudeCapEdges"]>> {
    const source = handle(shape).extrusion;
    if (!source) return [];
    const loop = source.profile.outerLoop;
    // A complete convex ring of shallow line turns is a single selection
    // contour. Do not offer one member as an independently propagating edge.
    // This is deliberately loop-wide: an isolated shallow authored corner in
    // an ordinary profile keeps its individual reference. Actual treatment
    // support is still checked separately by the native operation.
    const shallowRing = (() => {
      if (loop.type !== "polygon" || !loop.segments || loop.segments.length < 3) return false;
      let winding = 0;
      let turnSum = 0;
      for (let index = 0; index < loop.segments.length; index++) {
        const current = loop.segments[index];
        const next = loop.segments[(index + 1) % loop.segments.length];
        if (current.type !== "line" || next.type !== "line" ||
            current.end.x !== next.start.x || current.end.y !== next.start.y) return false;
        const ax = current.end.x - current.start.x, ay = current.end.y - current.start.y;
        const bx = next.end.x - next.start.x, by = next.end.y - next.start.y;
        if (![ax, ay, bx, by].every(Number.isFinite) || Math.hypot(ax, ay) === 0 || Math.hypot(bx, by) === 0) return false;
        const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
        if (!Number.isFinite(turn) || turn === 0 || Math.abs(turn) > 0.1) return false;
        if (winding && Math.sign(turn) !== winding) return false;
        winding = Math.sign(turn);
        turnSum += turn;
      }
      return Math.abs(Math.abs(turnSum) - 2 * Math.PI) < 1e-8;
    })();
    const edges: ReturnType<NonNullable<KernelAdapter["availableExtrudeCapEdges"]>> = [];
    for (const role of ["endCapPerimeter", "startCapPerimeter"] as const) {
      // An untouched extrusion's immutable construction recipe proves its full
      // boundary. Also resolve the actual retained native cap before exposing it.
      // Boolean/treatment results keep source metadata but cannot use this proof.
      if (handle(shape).operation === "extrusion") {
        const end = role === "endCapPerimeter";
        const normalSign = (end ? 1 : -1) * Math.sign(source.distance);
        this.validatePlanarFace(shape, {
          ...source.transform,
          origin: transformPoint(source.transform, 0, 0, end ? source.distance : 0),
          normal: { x: source.transform.normal.x * normalSign, y: source.transform.normal.y * normalSign, z: source.transform.normal.z * normalSign },
        });
        edges.push({ role });
        // A single authored full circle is the exact retained rim of this
        // untouched analytic extrusion, not a sampled display boundary.
        if (loop.type === "circle" && loop.entityIds.length === 1)
          edges.push({ role, sourceEntityId: loop.entityIds[0] });
      }
      if (loop.type !== "polygon") continue;
      const complete: typeof edges = [];
      for (const segment of loop.segments ?? []) {
        if (segment.type !== "line") continue;
        const ref: TopologyRef = { featureId: "proof", kind: "edge", transientId: "proof", role, sourceEntityId: segment.id };
        const { available } = request<{ available: boolean }>({
          op: "edgeAvailable", handle: handle(shape).proof.handle, ...this.capEdge(shape, ref),
        });
        if (available) complete.push({ role, sourceEntityId: segment.id });
      }
      if (handle(shape).operation !== "extrusion" && !source.profile.innerLoops.length &&
          loop.segments?.length === 4 && complete.length === 4)
        edges.push({ role });
      // Suppress members only after every actual native edge and the complete
      // untouched cap were proven. A modified or incomplete boundary cannot
      // acquire a group merely from its authored recipe.
      if (!(handle(shape).operation === "extrusion" && shallowRing && complete.length === loop.segments?.length))
        edges.push(...complete);
    }
    return edges;
  }
  // The bridge clones immutable native geometry. Authored references are also
  // cloned, so only a true clone shares this identity with its source.
  edgeProofSignature(shape: KernelShape): string | undefined { return handle(shape).edgeProofIdentity; }
  hasCommonVolume(base: KernelShape, tool: KernelShape): boolean {
    const a = request<Proof>({ op: "inspect", handle: handle(base).proof.handle });
    const b = request<Proof>({ op: "inspect", handle: handle(tool).proof.handle });
    const upper = Math.min(a.geometryAssertions.volume, b.geometryAssertions.volume);
    const tolerance = Math.max(1e-9, Math.abs(upper) * 1e-10);
    const { volume } = request<{ volume: number }>({ op: "overlapVolume", a: a.handle, b: b.handle });
    if (!Number.isFinite(volume) || volume < -tolerance || volume > upper + tolerance)
      throw new Error("Scope intersection produced inconsistent volume.");
    return volume > tolerance;
  }
  cutScope(targets: KernelShape[], tools: KernelShape[]): KernelShape[] {
    if (!targets.length || !tools.length)
      throw new Error("Hole scope requires target bodies and center tools.");
    const pending = new Set<KernelShape>();
    const hits = targets.map(() => tools.map(() => false));
    const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
    try {
      if (targets.length === 1) {
        // The exact intersection proof establishes every center against the
        // same source. A single atomic native batch proves the final topology.
        for (const [toolIndex, tool] of tools.entries()) {
          try {
            if (!this.hasCommonVolume(targets[0], tool))
              throw new Error("Boolean cut removed no volume. Move the tool into the target body.");
            hits[0][toolIndex] = true;
          } catch (error) { throw new HoleScopeError("center", toolIndex, reason(error)); }
        }
      } else {
        // Every center is proved against the original scope, never an intermediate
        // result. A missed individual body is allowed; an unused center is not.
        for (const [toolIndex, tool] of tools.entries()) {
          let hit = false;
          try {
            for (const [targetIndex, target] of targets.entries()) {
              if (!this.hasCommonVolume(target, tool)) continue;
              const probe = this.cut(target, tool);
              pending.add(probe);
              this.disposeShape(probe);
              pending.delete(probe);
              hits[targetIndex][toolIndex] = true;
              hit = true;
            }
            if (!hit) throw new Error("Boolean cut removed no volume. Move the tool into the target body.");
          } catch (error) { throw new HoleScopeError("center", toolIndex, reason(error)); }
        }
      }
      const outputs = targets.map((target, targetIndex) => {
        try {
          if (!hits[targetIndex].some(Boolean))
            throw new Error("Boolean cut removed no volume. Move a tool into the target body.");
          // Original-scope probes establish each center's authored intent.
          // Union the hit tools atomically so overlapping or redundant tools
          // need not remove additional material in an arbitrary sequential order.
          const before = request<Proof>({ op: "inspect", handle: handle(target).proof.handle });
          const result = request<Proof>({ op: "cutMany", a: before.handle, tools: tools.filter((_, index) => hits[targetIndex][index]).map(tool => handle(tool).proof.handle) });
          const output = this.retainExtrusion(owned(result, "cut", target.id), target);
          pending.add(output);
          const after = result.geometryAssertions;
          const tolerance = Math.max(1e-9, Math.abs(before.geometryAssertions.volume) * 1e-10);
          if (!after.valid || !Number.isFinite(after.volume) || after.volume <= 1e-12 || after.solidCount < 1)
            throw new Error("Boolean operation produced no solid volume.");
          if (before.geometryAssertions.volume - after.volume <= tolerance)
            throw new Error("Boolean cut removed no volume. Move the tools into the target body.");
          return output;
        } catch (error) { throw new HoleScopeError("target", targetIndex, reason(error)); }
      });
      for (const output of outputs) pending.delete(output);
      return outputs;
    } finally { for (const shape of pending) this.disposeShape(shape); }
  }
  joinAll(targets: KernelShape[], tool: KernelShape): KernelShape {
    if (!targets.length) throw new Error("Boolean join requires target bodies.");
    if (targets.length === 1) return this.fuse(targets[0], tool);
    const result = request<Proof>({
      op: "joinAll",
      handles: targets.map(target => handle(target).proof.handle),
      b: handle(tool).proof.handle,
    });
    try {
      return this.retainExtrusion(owned(result, "fuse", targets[0].id), targets[0]);
    } catch (error) {
      request({ op: "dispose", handle: result.handle });
      throw error;
    }
  }
  nativeDrawingGeometry(shape: KernelShape): ReturnType<NonNullable<KernelAdapter["nativeDrawingGeometry"]>> {
    return request({ op: "drawingGeometry", handle: handle(shape).proof.handle });
  }
  getWasmHeapCapacityBytes() { return wasmMemory?.buffer.byteLength; }
  revolveProfile(profile: SketchProfile, _axis: RevolveAxisReference, angle: number, transform: SketchPlaneTransform, resolvedAxis: ResolvedRevolveAxis): KernelShape {
    if (profile.innerLoops.length || profile.holes.length)
      throw new Error("Revolution of profiles with inner loops is unsupported.");
    const args = { origin: xyz(resolvedAxis.origin), direction: xyz(resolvedAxis.direction), angle };
    if (profile.outerLoop.type === "circle") {
      const { minX, minY, maxX, maxY } = profile.bounds, diameter = maxX - minX;
      if (![minX, minY, maxX, maxY, diameter].every(Number.isFinite) || diameter <= 0 || Math.abs(diameter - (maxY - minY)) > 1e-8 * Math.max(1, diameter))
        throw new Error("Circular revolution requires a finite circle.");
      const center = transformPoint(transform, (minX + maxX) / 2, (minY + maxY) / 2);
      return owned(request({ ...args, op: "revolveCircle", normal: xyz(transform.normal), center: xyz(center), radius: diameter / 2 }), "revolve");
    }
    const segments = profile.outerLoop.segments;
    if (!segments?.length || segments.some(segment => segment.type !== "line"))
      throw new Error("Revolution requires an exact straight polygon or full circle.");
    return owned(request({ ...args, op: "revolvePolygon", outer: segments.map(segment => xyz(transformPoint(transform, segment.start.x, segment.start.y))) }), "revolve");
  }
  extrudeToFace(profile: SketchProfile, transform: SketchPlaneTransform, target: KernelShape, face: SketchPlaneTransform): KernelShape {
    const boundary = (loop: ProfileLoop) => {
      if (loop.type !== "polygon" || !loop.segments?.length || loop.segments.some(segment => segment.type !== "line"))
        throw new Error("To-face extrusion requires exact straight polygon loops or a single full circle.");
      return loop.segments.map(segment => xyz(transformPoint(transform, segment.start.x, segment.start.y)));
    };
    const args = { b: handle(target).proof.handle, origin: xyz(face.origin), normal: xyz(face.normal), direction: xyz(transform.normal) };
    const terminate = (geometry: Record<string, unknown>): Proof => {
      try {
        return request<Proof>({ ...args, ...geometry });
      } catch (error) {
        if (error instanceof Error && error.message.endsWith("brep: termination face does not cover the projected profile"))
          throw new Error("Extrude profile extends outside the finite target face or crosses a face hole. Reselect a covering planar face.");
        if (error instanceof Error && error.message.includes("brep: termination must be strictly ahead of every source vertex:"))
          throw new Error("Extrude to face requires the entire profile to lie before the target in the positive extrusion direction.");
        throw error;
      }
    };
    let proof: Proof;
    if (profile.outerLoop.type === "circle") {
      if (profile.innerLoops.length || profile.holes.length)
        throw new Error("Circular to-face extrusion does not support inner loops.");
      const { minX, maxX, minY, maxY } = profile.bounds;
      const diameter = maxX - minX, otherDiameter = maxY - minY;
      if (![minX, maxX, minY, maxY, diameter, otherDiameter].every(Number.isFinite) || diameter <= 0 || otherDiameter <= 0 ||
          Math.abs(diameter - otherDiameter) > 1e-8 * Math.max(1, diameter, otherDiameter))
        throw new Error("Circular to-face extrusion requires a finite circle.");
      const center = transformPoint(transform, minX + diameter / 2, minY + otherDiameter / 2);
      proof = terminate({ op: "circleToFace", center: xyz(center), radius: diameter / 2 });
    } else {
      proof = terminate({ op: "prismToFace", outer: boundary(profile.outerLoop), holes: profile.innerLoops.map(boundary) });
    }
    const result = owned(proof, "toFace");
    const dot = (a: typeof face.normal, b: typeof face.normal) => a.x * b.x + a.y * b.y + a.z * b.z;
    const denominator = dot(transform.normal, face.normal);
    // Only a parallel cap has a constant authored extrusion distance.
    if (Math.abs(dot(transform.u, face.normal)) <= 1e-12 && Math.abs(dot(transform.v, face.normal)) <= 1e-12 && Math.abs(denominator) > 1e-12) {
      const delta = { x: face.origin.x - transform.origin.x, y: face.origin.y - transform.origin.y, z: face.origin.z - transform.origin.z };
      handle(result).extrusion = { profile: structuredClone(profile), distance: dot(delta, face.normal) / denominator, transform: structuredClone(transform) };
    }
    return result;
  }
  private treatEdge(shape: KernelShape, refs: TopologyRef[], size: number, operation: "fillet" | "chamfer"): KernelShape {
    try {
      if (!refs.length || !Number.isFinite(size) || size <= 0)
        throw new Error("Edge treatment requires authored cap edges and a positive finite size.");
      if (refs.some(ref => ref.featureId !== refs[0].featureId))
        throw new Error("Edge treatment references must share one source feature.");
      // Resolve all authored references before publishing any native result.
      // The bridge validates the complete batch against the original solid.
      const source = handle(shape).extrusion;
      const circularRims = source?.profile.outerLoop.type === "circle" &&
        !source.profile.innerLoops.length && !source.profile.holes.length &&
        refs.every(ref => (!ref.sourceEntityId || (source.profile.outerLoop.entityIds.length === 1 &&
          ref.sourceEntityId === source.profile.outerLoop.entityIds[0])) && !ref.repairRequired && ref.kind === "edge" &&
          (ref.role === "startCapPerimeter" || ref.role === "endCapPerimeter"));
      const roundedCandidate = source && refs.length === 1 &&
        refs[0].role === (operation === "fillet" ? "endCapPerimeter" : "startCapPerimeter") && !refs[0].sourceEntityId && !refs[0].repairRequired &&
        refs[0].kind === "edge" && source.profile.outerLoop.segments?.length === 8 &&
        source.profile.outerLoop.segments.filter(segment => segment.type === "arc").length === 4;
      const roundedPerimeter = roundedCandidate &&
        (mixedExtrusionRequest(source.profile, source.distance, source.transform)?.profile as { kind?: string } | undefined)?.kind === "roundedRectangle";
      const annularPerimeter = operation === "chamfer" && source && refs.length === 1 &&
        refs[0].kind === "edge" && !refs[0].sourceEntityId && !refs[0].repairRequired &&
        (refs[0].role === "startCapPerimeter" || refs[0].role === "endCapPerimeter") &&
        source.profile.outerLoop.type === "circle" && source.profile.innerLoops.length === 1 &&
        source.profile.innerLoops[0].type === "circle";
      let perimeter: TopologyRef[] | undefined;
      for (const ref of refs) {
        if (ref.sourceEntityId || circularRims || roundedPerimeter || annularPerimeter) continue;
        if (!source || source.profile.innerLoops.length || source.profile.outerLoop.type !== "polygon")
          throw new Error("This complete perimeter is unsupported; select individual authored cap edges.");
        const segments = source.profile.outerLoop.segments ?? [];
        if (!segments.length || segments.some(segment => segment.type !== "line"))
          throw new Error("This complete perimeter is unsupported; select individual authored straight cap edges.");
        const available = this.availableExtrudeCapEdges(shape);
        if (segments.some(segment => !available.some(edge => edge.role === ref.role && edge.sourceEntityId === segment.id)))
          throw new Error("The complete perimeter contains an edge that was lost or is ambiguous. Select a surviving authored edge.");
        if (refs.length !== 1 || segments.length !== 4)
          throw new Error("A complete nonparallel perimeter is unsupported; select individual parallel authored cap edges.");
        perimeter = segments.map(segment => ({ ...ref, sourceEntityId: segment.id }));
      }
      const before = request<Proof>({ op: "inspect", handle: handle(shape).proof.handle });
      let result: Proof;
      if (annularPerimeter && source) {
        const end = refs[0].role === "endCapPerimeter";
        result = request({ op: "capChamfer", handle: before.handle,
          normal: xyz(source.transform.normal).map(value => value * (end ? 1 : -1) * Math.sign(source.distance)),
          origin: xyz(transformPoint(source.transform, 0, 0, end ? source.distance : 0)), distance: size });
      } else if (roundedPerimeter && source) {
        const end = refs[0].role === "endCapPerimeter";
        result = request({ op: end ? "capFillet" : "capChamfer", handle: before.handle,
          normal: xyz(source.transform.normal).map(value => value * (end ? 1 : -1) * Math.sign(source.distance)),
          origin: xyz(transformPoint(source.transform, 0, 0, end ? source.distance : 0)),
          ...(end ? { radius: size } : { distance: size }) });
      } else if (circularRims && source) {
        const bounds = source.profile.bounds;
        const x = (bounds.minX + bounds.maxX) / 2, y = (bounds.minY + bounds.maxY) / 2;
        const roles = [...new Set(refs.map(ref => ref.role))];
        const rimCenters = roles.map(role => xyz(transformPoint(source.transform, x, y, role === "endCapPerimeter" ? source.distance : 0)));
        result = request({ op: operation === "fillet" ? "filletCylinderRims" : "chamferCylinderRims",
          handle: before.handle, normal: xyz(source.transform.normal), rimCenters,
          [operation === "fillet" ? "radius" : "distance"]: size });
      } else {
        const edges = (perimeter ?? refs).flatMap(ref => ref.role === "profileEdge" ? this.profileEdges(shape, ref) : [this.capEdge(shape, ref)]);
        const normal = perimeter?.[0].role === "startCapPerimeter" ? edges[0].normal.map(value => -value) : edges[0].normal;
        result = request({
          op: perimeter ? (operation === "fillet" ? "capFillet" : "capChamfer") : operation, handle: before.handle, normal,
          edges: edges.map(edge => ({ start: edge.edgeStart, end: edge.edgeEnd })),
          ...(source && refs.every(ref => ref.role === "profileEdge") ? { direction: xyz(source.transform.normal) } : {}),
          [operation === "fillet" ? "radius" : "distance"]: size,
        });
      }
      try {
        const after = result.geometryAssertions;
        const volumeTolerance = Math.max(1e-9, before.geometryAssertions.volume * 1e-10);
        const areaTolerance = Math.max(1e-9, before.geometryAssertions.surfaceArea * 1e-10);
        if (!after.valid || !Number.isFinite(after.volume) || after.volume <= 0 ||
            !Number.isFinite(after.surfaceArea) || after.surfaceArea <= 0 ||
            after.solidCount !== before.geometryAssertions.solidCount ||
            (Math.abs(before.geometryAssertions.volume - after.volume) <= volumeTolerance &&
             Math.abs(before.geometryAssertions.surfaceArea - after.surfaceArea) <= areaTolerance))
          throw new Error("Edge treatment did not retain valid changed solid geometry.");
        return this.retainExtrusion(owned(result, operation, shape.id), shape);
      } catch (error) {
        request({ op: "dispose", handle: result.handle });
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.includes(`${operation} failed`) ? message : `${operation} failed: ${message}`);
    }
  }
  fillet(shape: KernelShape, refs: TopologyRef[], radius: number): KernelShape { return this.treatEdge(shape, refs, radius, "fillet"); }
  chamfer(shape: KernelShape, refs: TopologyRef[], distance: number): KernelShape { return this.treatEdge(shape, refs, distance, "chamfer"); }
  shell(shape: KernelShape, opening: "startCap" | "endCap", wall: number): KernelShape {
    requireShellOpening(opening);
    const source = handle(shape).extrusion;
    const dimensions = source && rectangularShellDimensions(source.profile);
    if (!source || !dimensions || handle(shape).operation !== "extrusion" || source.distance <= 0)
      throw new Error("Shell requires one unmodified native positive rectangular extrusion without holes.");
    const [width, height] = dimensions, depth = source.distance;
    if (!Number.isFinite(wall) || wall < 1e-6) throw new Error("Wall thickness must be at least 0.000001 mm.");
    if (Math.min(width - 2 * wall, height - 2 * wall, depth - wall) <= 1e-6)
      throw new Error("Wall thickness collapses the cavity.");
    const before = handle(shape).proof.geometryAssertions;
    const original = width * height * depth;
    const removed = (width - 2 * wall) * (height - 2 * wall) * (depth - wall);
    const expected = original - removed;
    const tolerance = Math.max(1e-9, Math.abs(before.volume) * 1e-10);
    if (removed <= tolerance || expected <= tolerance) throw new Error("Shell requires measurable wall and cavity volumes.");
    if (before.solidCount !== 1 || Math.abs(before.volume - original) > Math.max(1e-7, original * 1e-8))
      throw new Error("Shell requires one unchanged rectangular solid.");
    const result = request<Proof>({ op: "shell", handle: handle(shape).proof.handle, openFace: opening === "startCap" ? 0 : 1, wall });
    if (result.geometryAssertions.solidCount !== 1 || before.volume - result.geometryAssertions.volume <= tolerance || Math.abs(result.geometryAssertions.volume - expected) > Math.max(1e-7, expected * 1e-8)) {
      request({ op: "dispose", handle: result.handle });
      throw new Error("Shell did not produce its expected cavity volume.");
    }
    return owned(result, "shell", shape.id);
  }
  thread(shape: KernelShape, settings: Pick<ThreadFeature, "side" | "hand">, dimensions: ThreadDimensions): KernelShape {
    const proof = request<Proof>({ op: "thread", handle: handle(shape).proof.handle, thread: { ...dimensions, side: settings.side, hand: settings.hand } });
    return owned(proof, "thread", shape.id);
  }
  leadPart(dimensions: LeadScrewDimensions, nut: boolean, progress?: (stage: string) => void): KernelShape {
    progress?.(nut ? "lead_nut_thread" : "lead_screw_thread");
    return owned(request({ op: "leadPart", lead: dimensions, nut }), nut ? "leadNut" : "leadScrew");
  }
  assertLeadPair(screw: KernelShape, nut: KernelShape, dimensions: LeadScrewDimensions, progress?: (stage: string) => void): void {
    progress?.("lead_pair_fit");
    request({ op: "assertLeadPair", a: handle(screw).proof.handle, b: handle(nut).proof.handle, lead: dimensions });
  }
  importStep(source: string): KernelShape {
    if (typeof globalThis.document !== "undefined") throw new Error("STEP import requires an isolated browser worker.");
    return owned(request({ op: "importStep", source }), "stepImport");
  }
  exportStep(shapes: readonly KernelShape[]): NativeStepExport {
    if (typeof globalThis.document !== "undefined") throw new Error("STEP export requires an isolated browser worker.");
    const handles = shapes.map(shape => {
      const native = handle(shape);
      if (!native?.proof || typeof native.proof.handle !== "string" || native.disposed)
        throw new Error("STEP export accepts native solids only.");
      return native.proof.handle;
    });
    if (new Set(handles).size !== handles.length) throw new Error("STEP export requires unique native bodies.");
    const result = request<Omit<NativeStepExport, "bytes"> & { base64: string }>({ op: "exportStep", handles });
    return { bytes: Uint8Array.from(atob(result.base64), character => character.charCodeAt(0)).buffer, before: result.before, after: result.after, units: result.units };
  }
}

export { PlainSolidKernel as NativeKernel };
