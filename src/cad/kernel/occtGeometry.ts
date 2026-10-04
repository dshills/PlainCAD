import { GeometryAssertions } from "./KernelAdapter";
import { DisposableScope, withDisposableScope } from "./disposableScope";
import { Point3, SketchPlaneTransform } from "../sketch/planes";
import { KERNEL_LINEAR_TOLERANCE } from "../sketch/tolerances";

export function measureShape(
  oc: Record<string, any>,
  shape: any,
): GeometryAssertions {
  return withDisposableScope((scope) => {
    if (!shape || shape.IsNull())
      throw new Error("OpenCascade produced invalid geometry.");
    const analyzer = scope.use(new oc.BRepCheck_Analyzer(shape, true));
    if (!analyzer.IsValid_2())
      throw new Error("OpenCascade produced invalid geometry.");
    const props = scope.use(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(shape, props, true, false, false);
    const volume = props.Mass();
    const explorer = scope.use(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_SOLID,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    let solidCount = 0;
    for (; explorer.More(); explorer.Next()) solidCount++;
    if (!Number.isFinite(volume) || volume <= 1e-12 || solidCount === 0)
      throw new Error(
        "Operation produced no solid volume. Adjust the feature or its target.",
      );
    return {
      valid: true,
      volume,
      surfaceArea: surfaceArea(oc, shape, scope),
      solidCount,
    };
  });
}

export function volumeTolerance(volume: number): number {
  return Math.max(1e-9, Math.abs(volume) * 1e-10);
}

export function surfaceArea(
  oc: Record<string, any>,
  shape: any,
  scope: DisposableScope,
): number {
  const props = scope.use(new oc.GProp_GProps_1());
  oc.BRepGProp.SurfaceProperties_1(shape, props, false, false);
  return props.Mass();
}

export function planarFaces(
  oc: Record<string, any>,
  shape: any,
  plane: SketchPlaneTransform,
  scope: DisposableScope,
): any[] {
  const explorer = scope.use(
    new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    ),
  );
  const faces = [];
  for (; explorer.More(); explorer.Next()) {
    const current = scope.use(explorer.Current());
    const face = scope.use(oc.TopoDS.Face_1(current));
    const surface = scope.use(new oc.BRepAdaptor_Surface_2(face, true));
    if (surface.GetType().value !== oc.GeomAbs_SurfaceType.GeomAbs_Plane.value)
      continue;
    const nativePlane = scope.use(surface.Plane());
    const axis = scope.use(nativePlane.Axis());
    const direction = scope.use(axis.Direction());
    const origin = scope.use(axis.Location());
    const n = { x: direction.X(), y: direction.Y(), z: direction.Z() };
    if (Math.abs(Math.abs(dot(n, plane.normal)) - 1) > 1e-9) continue;
    if (
      Math.abs(
        dot(
          {
            x: origin.X() - plane.origin.x,
            y: origin.Y() - plane.origin.y,
            z: origin.Z() - plane.origin.z,
          },
          n,
        ),
      ) > KERNEL_LINEAR_TOLERANCE
    )
      continue;
    faces.push(face);
  }
  return faces;
}

export function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function subtract(a: Point3, b: Point3): Point3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function near(a: Point3, b: Point3): boolean {
  return (
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= KERNEL_LINEAR_TOLERANCE * 10
  );
}

export interface NativePlanarFaceMeasurement {
  origin: Point3;
  normal: Point3;
  area: number;
}

/** Measure once per current shape; records contain no native handles. */
export function measurePlanarFaces(
  oc: Record<string, any>,
  shape: any,
): NativePlanarFaceMeasurement[] {
  return withDisposableScope((scope) => {
    const records: NativePlanarFaceMeasurement[] = [];
    const explorer = scope.use(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    for (; explorer.More(); explorer.Next()) {
      const current = scope.use(explorer.Current()),
        face = scope.use(oc.TopoDS.Face_1(current));
      const surface = scope.use(new oc.BRepAdaptor_Surface_2(face, true));
      if (
        surface.GetType().value !== oc.GeomAbs_SurfaceType.GeomAbs_Plane.value
      )
        continue;
      const plane = scope.use(surface.Plane()),
        axis = scope.use(plane.Axis()),
        direction = scope.use(axis.Direction()),
        origin = scope.use(axis.Location());
      records.push({
        origin: { x: origin.X(), y: origin.Y(), z: origin.Z() },
        normal: { x: direction.X(), y: direction.Y(), z: direction.Z() },
        area: surfaceArea(oc, face, scope),
      });
    }
    return records;
  });
}
