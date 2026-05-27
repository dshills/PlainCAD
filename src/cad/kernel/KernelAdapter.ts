import { RevolveAxisReference, TopologyRef } from "../document/schema";
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

export interface RenderMesh {
  id: string;
  bodyId: string;
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: number[];
  color?: string;
  bounds: BoundingBox;
}

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface KernelAdapter {
  createBox(width: number, height: number, depth: number): KernelShape;
  extrudeProfile(profile: SketchProfile, distance: number): KernelShape;
  revolveProfile(profile: SketchProfile, axis: RevolveAxisReference, angle: number): KernelShape;
  cut(base: KernelShape, tool: KernelShape): KernelShape;
  cutAll(base: KernelShape, tools: KernelShape[]): KernelShape;
  fuse(a: KernelShape, b: KernelShape): KernelShape;
  fillet?(shape: KernelShape, edgeRefs: TopologyRef[], radius: number): KernelShape;
  chamfer?(shape: KernelShape, edgeRefs: TopologyRef[], distance: number): KernelShape;
  tessellate(shape: KernelShape, options: TessellationOptions): RenderMesh;
  exportStl(shape: KernelShape): ArrayBuffer;
  disposeShape?(shape: KernelShape): void;
  exportStep?(shape: KernelShape): ArrayBuffer;
}
