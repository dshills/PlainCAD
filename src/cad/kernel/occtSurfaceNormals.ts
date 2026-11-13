import { withDisposableScope } from "./disposableScope";

/** BRepAdaptor_Surface includes the face location in D1. Preserve the face's
 * orientation and keep the per-face vertex splits from triangulation. */
export function occtSurfaceNormals(
  oc: Record<string, any>, face: any, triangulation: any, reversed: boolean,
): Float32Array | undefined {
  if (!triangulation.HasUVNodes()) return;
  return withDisposableScope(scope => {
    const surface = scope.use(new oc.BRepAdaptor_Surface_2(face, true));
    const point = scope.use(new oc.gp_Pnt_3(0, 0, 0));
    const du = scope.use(new oc.gp_Vec_4(0, 0, 0));
    const dv = scope.use(new oc.gp_Vec_4(0, 0, 0));
    const count = triangulation.NbNodes(), normals = new Float32Array(count * 3);
    const planar = scope.use(surface.GetType()).value === oc.GeomAbs_SurfaceType.GeomAbs_Plane.value;
    for (let index = 1; index <= (planar ? 1 : count); index++) {
      const uv = triangulation.UVNode(index);
      try {
        surface.D1(uv.X(), uv.Y(), point, du, dv);
        const [ux, uy, uz, vx, vy, vz] = [du.X(), du.Y(), du.Z(), dv.X(), dv.Y(), dv.Z()];
        const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
        const length = Math.hypot(x, y, z);
        if (length > 0 && Number.isFinite(length)) {
          const sign = reversed ? -1 : 1;
          normals.set([sign * (x / length), sign * (y / length), sign * (z / length)], (index - 1) * 3);
        }
      } catch {
        // A singular or unavailable derivative retains the mesh-derived normal.
      } finally {
        uv.delete();
      }
    }
    if (planar) for (let offset = 3; offset < normals.length; offset += 3) normals.copyWithin(offset, 0, 3);
    return normals;
  });
}
