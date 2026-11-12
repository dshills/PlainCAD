import { measureNativeBores, type NativeBore } from "./nativeDrawing";
import type { Point3, SketchPlaneTransform } from "../sketch/planes";
import { KERNEL_LINEAR_TOLERANCE } from "../sketch/tolerances";
import { withDisposableScope, type DisposableScope } from "./disposableScope";
import { dot, near, planarFaces, surfaceArea } from "./occtGeometry";
import { PocketFloorMismatchError } from "./KernelAdapter";

const MAX_FACE_SCAN = 4096;
const MAX_BORE_EDGES = 256;
const floorLost = "Pocket floor is missing, trimmed, split or ambiguous. Reselect a supported upstream face.";

/** Require one oriented native face equal to the complete authored finite floor. */
export function validateNativePocketFloor(
  oc: Record<string, any>, shape: any, plane: SketchPlaneTransform,
  createExpectedFace: (scope: DisposableScope) => any,
) {
  withDisposableScope(scope => {
    const faces = planarFaces(oc, shape, plane, scope, MAX_FACE_SCAN);
    if (!faces.length) throw new PocketFloorMismatchError(floorLost);
    if (faces.length !== 1) throw new Error(floorLost);
    const face = faces[0], orientation = scope.use(face.Orientation_1()).value;
    if (![oc.TopAbs_Orientation.TopAbs_FORWARD.value, oc.TopAbs_Orientation.TopAbs_REVERSED.value].includes(orientation)) throw new Error(floorLost);
    const surface = scope.use(new oc.BRepAdaptor_Surface_2(face, true));
    const at = scope.use(new oc.gp_Pnt_3(0, 0, 0));
    const du = scope.use(new oc.gp_Vec_4(0, 0, 0)), dv = scope.use(new oc.gp_Vec_4(0, 0, 0));
    surface.D1((surface.FirstUParameter() + surface.LastUParameter()) / 2, (surface.FirstVParameter() + surface.LastVParameter()) / 2, at, du, dv);
    const normal = { x: du.Y() * dv.Z() - du.Z() * dv.Y(), y: du.Z() * dv.X() - du.X() * dv.Z(), z: du.X() * dv.Y() - du.Y() * dv.X() };
    const facing = dot(normal, plane.normal) * (orientation === oc.TopAbs_Orientation.TopAbs_REVERSED.value ? -1 : 1);
    if (!Number.isFinite(facing) || facing === 0) throw new Error(floorLost);
    if (facing < 0) throw new PocketFloorMismatchError(floorLost);
    const expected = createExpectedFace(scope), expectedArea = surfaceArea(oc, expected, scope);
    const tolerance = Math.max(KERNEL_LINEAR_TOLERANCE ** 2, expectedArea * 1e-8);
    const actualArea = surfaceArea(oc, face, scope);
    if (!Number.isFinite(expectedArea) || expectedArea <= tolerance || !Number.isFinite(actualArea)) throw new Error(floorLost);
    if (Math.abs(expectedArea - actualArea) > tolerance) throw new PocketFloorMismatchError(floorLost);
    const common = scope.use(new oc.BRepAlgoAPI_Common_3(expected, face));
    if (!common.IsDone()) throw new Error(floorLost);
    const shared = scope.use(common.Shape()), sharedArea = surfaceArea(oc, shared, scope);
    if (!Number.isFinite(sharedArea)) throw new Error(floorLost);
    if (Math.abs(expectedArea - sharedArea) > tolerance) throw new PocketFloorMismatchError(floorLost);
  });
}

function arrayPoint(coords: readonly number[]): Point3 { return { x: coords[0], y: coords[1], z: coords[2] }; }

export interface NativeHoleRimEvidence { center: Point3; radius: number; outward: Point3 }

/** Inspect only the boundary of a complete inward cylinder. This proves adjacency,
 * and shares one scan of each native shape across all authored Hole candidates. */
export function measureNativeBoreRims(oc: Record<string, any>, shape: any): NativeHoleRimEvidence[] {
  const rims: NativeHoleRimEvidence[] = [];
  measureNativeBores(oc, shape, (bore, face) => rims.push(...completeBoreRims(oc, bore, face)));
  return rims;
}

function completeBoreRims(oc: Record<string, any>, bore: NativeBore, face: any): NativeHoleRimEvidence[] {
  const start = arrayPoint(bore.start), direction = arrayPoint(bore.direction);
  const ends = [
    { center: start, outward: { x: -direction.x, y: -direction.y, z: -direction.z } },
    { center: { x: start.x + direction.x * bore.length, y: start.y + direction.y * bore.length, z: start.z + direction.z * bore.length }, outward: direction },
  ];
  const radius = bore.diameter / 2, tolerance = Math.max(KERNEL_LINEAR_TOLERANCE, radius * 1e-9);
  return withDisposableScope(scope => {
    const explorer = scope.use(new oc.TopExp_Explorer_2(face, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    const retained: any[] = [], matches: NativeHoleRimEvidence[] = [], ambiguous = new Set<number>();
    let count = 0;
    for (; explorer.More(); explorer.Next()) {
      if (++count > MAX_BORE_EDGES) return [];
      withDisposableScope(edgeScope => {
        const current = edgeScope.use(explorer.Current()), edge = edgeScope.use(oc.TopoDS.Edge_1(current));
        if (retained.some(previous => previous.IsSame(edge))) return;
        const curve = edgeScope.use(new oc.BRepAdaptor_Curve_2(edge));
        if (curve.GetType().value !== oc.GeomAbs_CurveType.GeomAbs_Circle.value) return;
        const sweep = curve.LastParameter() - curve.FirstParameter();
        if (!Number.isFinite(sweep) || Math.abs(sweep - 2 * Math.PI) > 1e-7) return;
        const circle = edgeScope.use(curve.Circle()), axis = edgeScope.use(circle.Axis());
        const origin = edgeScope.use(axis.Location()), normal = edgeScope.use(axis.Direction());
        const exactCenter = { x: origin.X(), y: origin.Y(), z: origin.Z() }, exactRadius = circle.Radius();
        const parallel = Math.abs(dot({ x: normal.X(), y: normal.Y(), z: normal.Z() }, direction));
        if (!Number.isFinite(exactRadius) || exactRadius <= 0 || Math.abs(exactRadius - radius) > tolerance ||
            !Number.isFinite(parallel) || Math.abs(parallel - 1) > 1e-8) return;
        const atStart = near(ends[0].center, exactCenter), atEnd = near(ends[1].center, exactCenter);
        if (atStart === atEnd) return;
        const index = atStart ? 0 : 1;
        if (retained[index]) { ambiguous.add(index); return; }
        retained[index] = scope.use(edgeScope.release(edge));
        matches[index] = { center: exactCenter, radius: exactRadius, outward: ends[index].outward };
      });
    }
    return matches.filter((_, index) => !ambiguous.has(index));
  });
}

export function matchNativeHoleRim(evidence: readonly NativeHoleRimEvidence[], center: Point3, outward: Point3, radius: number): NativeHoleRimEvidence | undefined {
  const tolerance = Math.max(KERNEL_LINEAR_TOLERANCE, radius * 1e-9);
  const matches = evidence.filter(rim => Math.abs(rim.radius - radius) <= tolerance && near(rim.center, center) && dot(rim.outward, outward) > 1 - 1e-8);
  return matches.length === 1 ? matches[0] : undefined;
}
