import { TopologyRef } from "../document/schema";
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
  positions: number[];
  normals: number[];
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
  cut(base: KernelShape, tool: KernelShape): KernelShape;
  fuse(a: KernelShape, b: KernelShape): KernelShape;
  fillet?(shape: KernelShape, edgeRefs: TopologyRef[], radius: number): KernelShape;
  tessellate(shape: KernelShape, options: TessellationOptions): RenderMesh;
  exportStl(shape: KernelShape): ArrayBuffer;
  exportStep?(shape: KernelShape): ArrayBuffer;
}
