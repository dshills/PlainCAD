import { RevolveAxisReference, TopologyRef } from "../document/schema";
import { Point3, SketchPlaneTransform } from "../sketch/planes";
import { SketchProfile } from "../sketch/profileDetection";

export interface KernelShape {
  id: string;
  kernelHandle: unknown;
  metadata?: Record<string, unknown>;
}

export interface TessellationOptions {
  linearDeflection: number;
  angularDeflection: number;
}

export interface GeometryAssertions {
  valid: true;
  volume: number;
  surfaceArea: number;
  solidCount: number;
}

export interface ResolvedRevolveAxis {
  origin: Point3;
  direction: Point3;
}

export interface RenderMesh {
  id: string;
  bodyId: string;
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: number[];
  color?: string;
  geometrySource?: "opencascade" | "fallback";
  kernelOperation?:
    | "box"
    | "extrusion"
    | "revolve"
    | "cut"
    | "fuse"
    | "fillet"
    | "chamfer"
    | "toFace";
  geometryAssertions?: GeometryAssertions;
  bounds: BoundingBox;
}

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface KernelAdapter {
  createBox(width: number, height: number, depth: number): KernelShape;
  extrudeProfile(
    profile: SketchProfile,
    distance: number,
    transform?: SketchPlaneTransform,
  ): KernelShape;
  // resolvedAxis is authoritative for native geometry; axis identifies only the legacy fallback.
  revolveProfile(
    profile: SketchProfile,
    axis: RevolveAxisReference,
    angle: number,
    transform: SketchPlaneTransform,
    resolvedAxis: ResolvedRevolveAxis,
  ): KernelShape;
  extrudeToFace?(
    profile: SketchProfile,
    transform: SketchPlaneTransform,
    target: KernelShape,
    face: SketchPlaneTransform,
  ): KernelShape;
  cut(base: KernelShape, tool: KernelShape): KernelShape;
  cutAll(base: KernelShape, tools: KernelShape[]): KernelShape;
  /** Each tool must hit some target, and every target must lose volume; outputs publish atomically. */
  cutScope?(targets: KernelShape[], tools: KernelShape[]): KernelShape[];
  fuse(a: KernelShape, b: KernelShape): KernelShape;
  hasCommonVolume?(base: KernelShape, tool: KernelShape): boolean;
  /** Atomic connected union; the tool must add volume beyond the union of targets. */
  joinAll?(targets: KernelShape[], tool: KernelShape): KernelShape;
  fillet?(
    shape: KernelShape,
    edgeRefs: TopologyRef[],
    radius: number,
  ): KernelShape;
  chamfer?(
    shape: KernelShape,
    edgeRefs: TopologyRef[],
    distance: number,
  ): KernelShape;
  tessellate(shape: KernelShape, options: TessellationOptions): RenderMesh;
  exportStl(shape: KernelShape): ArrayBuffer;
  disposeShape?(shape: KernelShape): void;
  /** Allocated WASM memory capacity, not live allocations or process memory. */
  getWasmHeapCapacityBytes?(): number | undefined;
  exportStep?(shape: KernelShape): ArrayBuffer;
}

export class HoleScopeError extends Error {
  constructor(
    readonly scope: "center" | "target",
    readonly index: number,
    reason: string,
  ) {
    super(`Hole ${scope} ${index + 1}: ${reason}`);
    this.name = "HoleScopeError";
  }
}
