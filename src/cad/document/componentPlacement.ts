import type { CadDocument, ComponentPlacement } from "./schema";
import type { Point3, SketchPlaneTransform } from "../sketch/planes";

export const MAX_COMPONENT_TRANSLATION = 1e8;
export const MAX_COMPONENT_ROTATION = Math.PI * 2;
export const IDENTITY_PLACEMENT: ComponentPlacement = { translation: [0, 0, 0], rotation: [0, 0, 0] };

export function validComponentPlacement(value: unknown): value is ComponentPlacement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const placement = value as Partial<ComponentPlacement>;
  return [[placement.translation, MAX_COMPONENT_TRANSLATION], [placement.rotation, MAX_COMPONENT_ROTATION]].every(([values, limit]) =>
    Array.isArray(values) && values.length === 3 && values.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= (limit as number)));
}

export function placementTransform(placement: ComponentPlacement = IDENTITY_PLACEMENT): SketchPlaneTransform {
  if (!validComponentPlacement(placement)) throw new Error("Component placement is invalid. Reset or repair its numeric position and rotation.");
  const trig = (value: number) => Math.abs(value) < 1e-15 ? 0 : value;
  const [rx, ry, rz] = placement.rotation;
  const cx = trig(Math.cos(rx)), sx = trig(Math.sin(rx)), cy = trig(Math.cos(ry)), sy = trig(Math.sin(ry)), cz = trig(Math.cos(rz)), sz = trig(Math.sin(rz));
  return {
    origin: { x: placement.translation[0], y: placement.translation[1], z: placement.translation[2] },
    u: { x: cz * cy, y: sz * cy, z: -sy },
    v: { x: cz * sy * sx - sz * cx, y: sz * sy * sx + cz * cx, z: cy * sx },
    normal: { x: cz * sy * cx + sz * sx, y: sz * sy * cx - cz * sx, z: cy * cx },
  };
}

export function placedVector(frame: SketchPlaneTransform, vector: Point3): Point3 {
  return { x: frame.u.x * vector.x + frame.v.x * vector.y + frame.normal.x * vector.z, y: frame.u.y * vector.x + frame.v.y * vector.y + frame.normal.y * vector.z, z: frame.u.z * vector.x + frame.v.z * vector.y + frame.normal.z * vector.z };
}

export function placedPoint(frame: SketchPlaneTransform, point: Point3): Point3 {
  const vector = placedVector(frame, point);
  return { x: frame.origin.x + vector.x, y: frame.origin.y + vector.y, z: frame.origin.z + vector.z };
}

export function placePlane(plane: SketchPlaneTransform, placement?: ComponentPlacement): SketchPlaneTransform {
  if (!placement) return plane;
  const frame = placementTransform(placement);
  return { origin: placedPoint(frame, plane.origin), u: placedVector(frame, plane.u), v: placedVector(frame, plane.v), normal: placedVector(frame, plane.normal) };
}

/** Recover the authoritative authored plane from a rigidly positioned worker plane. */
export function unplacePlane(plane: SketchPlaneTransform, placement?: ComponentPlacement): SketchPlaneTransform {
  if (!placement) return plane;
  const frame = placementTransform(placement);
  const vector = (p: Point3): Point3 => ({
    x: p.x * frame.u.x + p.y * frame.u.y + p.z * frame.u.z,
    y: p.x * frame.v.x + p.y * frame.v.y + p.z * frame.v.z,
    z: p.x * frame.normal.x + p.y * frame.normal.y + p.z * frame.normal.z,
  });
  return { origin: vector({ x: plane.origin.x - frame.origin.x, y: plane.origin.y - frame.origin.y, z: plane.origin.z - frame.origin.z }), u: vector(plane.u), v: vector(plane.v), normal: vector(plane.normal) };
}

export function componentPlacementsEqual(document: CadDocument, first: string, second: string): boolean {
  const a = placementTransform(document.components[first]?.placement), b = placementTransform(document.components[second]?.placement);
  return (Object.keys(a) as (keyof SketchPlaneTransform)[]).every(key => (["x", "y", "z"] as const).every(axis => Math.abs(a[key][axis] - b[key][axis]) <= (key === "origin" ? 1e-8 : 1e-12)));
}

export function withComponentPlacement(document: CadDocument, componentId: string, placement: ComponentPlacement): CadDocument {
  if (!Object.hasOwn(document.components, componentId)) throw new Error("Component was lost. Select a current component.");
  if (!validComponentPlacement(placement)) throw new Error("Position or rotation is outside the supported finite placement limits.");
  const current = document.components[componentId].placement ?? IDENTITY_PLACEMENT;
  if (current.translation.every((n, axis) => n === placement.translation[axis]) && current.rotation.every((n, axis) => n === placement.rotation[axis])) return document;
  const identity = placement.translation.every(n => n === 0) && placement.rotation.every(n => n === 0);
  const { placement: _old, ...component } = document.components[componentId];
  return { ...document, components: { ...document.components, [componentId]: { ...component, ...(identity ? {} : { placement: { translation: [...placement.translation], rotation: [...placement.rotation] } }) } } };
}
