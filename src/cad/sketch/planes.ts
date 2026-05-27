import { OriginPlane, SketchPlaneReference } from "../document/schema";

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface SketchPlaneTransform {
  origin: Point3;
  u: Point3;
  v: Point3;
  normal: Point3;
}

export function originPlaneRef(plane: OriginPlane): SketchPlaneReference {
  return { type: "origin", plane };
}

export function sketchPlaneLabel(plane: SketchPlaneReference | OriginPlane): string {
  const ref = normalizeSketchPlane(plane);
  if (ref.type === "origin") return ref.plane;
  if (ref.type === "offset") return `${ref.base} offset`;
  return ref.lost ? "Lost face plane" : "Face plane";
}

export function normalizeSketchPlane(plane: SketchPlaneReference | OriginPlane | undefined): SketchPlaneReference {
  if (!plane) return originPlaneRef("XY");
  if (typeof plane === "string") return originPlaneRef(plane);
  return plane;
}

export function sketchPlaneTransform(plane: SketchPlaneReference | OriginPlane | undefined): SketchPlaneTransform {
  const ref = normalizeSketchPlane(plane);
  if (ref.type === "offset") {
    console.warn("Offset sketch planes require evaluated plane offsets and are not active yet.");
    return transformForOriginPlane(ref.base);
  }
  if (ref.type === "face") {
    console.warn("Face sketch planes require stable face references and are not active yet.");
    return transformForOriginPlane("XY");
  }
  return transformForOriginPlane(ref.plane);
}

export function sketchPointToWorld(plane: SketchPlaneReference | OriginPlane | undefined, x: number, y: number, z = 0): Point3 {
  const transform = sketchPlaneTransform(plane);
  return transformPoint(transform, x, y, z);
}

export function transformPoint(transform: SketchPlaneTransform, x: number, y: number, z = 0): Point3 {
  const vector = sketchVectorToWorld(transform, x, y, z);
  return {
    x: transform.origin.x + vector.x,
    y: transform.origin.y + vector.y,
    z: transform.origin.z + vector.z,
  };
}

export function sketchVectorToWorld(transform: SketchPlaneTransform, x: number, y: number, z = 0): Point3 {
  return {
    x: transform.u.x * x + transform.v.x * y + transform.normal.x * z,
    y: transform.u.y * x + transform.v.y * y + transform.normal.y * z,
    z: transform.u.z * x + transform.v.z * y + transform.normal.z * z,
  };
}

export function worldPointToSketch(plane: SketchPlaneReference | OriginPlane | undefined, point: Point3): { x: number; y: number; z: number } {
  const transform = sketchPlaneTransform(plane);
  const relative = subtract(point, transform.origin);
  return {
    x: dot(relative, transform.u),
    y: dot(relative, transform.v),
    z: dot(relative, transform.normal),
  };
}

function transformForOriginPlane(plane: OriginPlane): SketchPlaneTransform {
  if (plane === "XZ") {
    return {
      origin: vector(0, 0, 0),
      u: vector(1, 0, 0),
      v: vector(0, 0, 1),
      normal: vector(0, -1, 0),
    };
  }
  if (plane === "YZ") {
    return {
      origin: vector(0, 0, 0),
      u: vector(0, 1, 0),
      v: vector(0, 0, 1),
      normal: vector(1, 0, 0),
    };
  }
  return {
    origin: vector(0, 0, 0),
    u: vector(1, 0, 0),
    v: vector(0, 1, 0),
    normal: vector(0, 0, 1),
  };
}

function vector(x: number, y: number, z: number): Point3 {
  return { x, y, z };
}

function subtract(a: Point3, b: Point3): Point3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
