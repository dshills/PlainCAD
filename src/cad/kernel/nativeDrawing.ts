import type { BoundingBox } from "./KernelAdapter";
import { withDisposableScope } from "./disposableScope";
export interface NativeBore { diameter: number; length: number; start: [number, number, number]; direction: [number, number, number] }
export interface NativeDrawingGeometry { bounds: BoundingBox; bores: NativeBore[]; warnings: string[] }
/** Current BRep faces only: authored Hole metadata is insufficient after later booleans. */
export function measureNativeBores(oc: Record<string, any>, shape: any): Pick<NativeDrawingGeometry, "bores" | "warnings"> {
  return withDisposableScope(scope => {
    const bores: NativeBore[] = [], warnings = new Set<string>();
    const explorer = scope.use(new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    let count = 0;
    for (; explorer.More(); explorer.Next()) {
      if (++count > 4096) throw new Error("Drawing exceeds the 4096-face native inspection limit. Select a simpler part.");
      const bore = withDisposableScope(faceScope => {
        const current = faceScope.use(explorer.Current()), face = faceScope.use(oc.TopoDS.Face_1(current)), surface = faceScope.use(new oc.BRepAdaptor_Surface_2(face, true));
        if (surface.GetType().value !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder.value) return;
        const orientation = faceScope.use(face.Orientation_1());
        if (![oc.TopAbs_Orientation.TopAbs_FORWARD.value, oc.TopAbs_Orientation.TopAbs_REVERSED.value].includes(orientation.value)) { warnings.add("Unoriented cylindrical faces need manual bore dimensions."); return; }
        const cylinder = faceScope.use(surface.Cylinder());
        const radius = cylinder.Radius(), firstU = surface.FirstUParameter(), lastU = surface.LastUParameter(), firstV = surface.FirstVParameter(), lastV = surface.LastVParameter(), length = lastV - firstV;
        if (![radius, firstU, lastU, firstV, lastV].every(Number.isFinite) || radius <= 0 || length <= 1e-7) throw new Error("Native cylindrical drawing measurements are invalid.");
        const axis = faceScope.use(cylinder.Axis()), direction = faceScope.use(axis.Direction()), origin = faceScope.use(axis.Location());
        const vector: [number, number, number] = [direction.X(), direction.Y(), direction.Z()];
        // Reversed drilling may also reverse the underlying surface coordinates.
        // Face orientation alone therefore does not identify an internal wall.
        const sample = faceScope.use(new oc.gp_Pnt_3(0, 0, 0)), du = faceScope.use(new oc.gp_Vec_4(0, 0, 0)), dv = faceScope.use(new oc.gp_Vec_4(0, 0, 0));
        surface.D1((firstU + lastU) / 2, (firstV + lastV) / 2, sample, du, dv);
        const n = [du.Y() * dv.Z() - du.Z() * dv.Y(), du.Z() * dv.X() - du.X() * dv.Z(), du.X() * dv.Y() - du.Y() * dv.X()], delta = [sample.X() - origin.X(), sample.Y() - origin.Y(), sample.Z() - origin.Z()], axial = delta.reduce((sum, value, index) => sum + value * vector[index], 0), radial = delta.map((value, index) => value - axial * vector[index]);
        const facing = n.reduce((sum, value, index) => sum + value * radial[index], 0) * (orientation.value === oc.TopAbs_Orientation.TopAbs_REVERSED.value ? -1 : 1);
        if (!Number.isFinite(facing) || Math.abs(facing) <= Math.max(1e-20, Math.hypot(...n) * Math.hypot(...radial) * 1e-8)) throw new Error("Native cylindrical face has an ambiguous material-side normal.");
        if (facing > 0) return;
        const props = faceScope.use(new oc.GProp_GProps_1()); oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
        const expectedArea = 2 * Math.PI * radius * length;
        if (Math.abs(lastU - firstU - 2 * Math.PI) > 1e-7 || Math.abs(props.Mass() - expectedArea) > Math.max(1e-6, expectedArea * 1e-7)) { warnings.add("Trimmed internal cylindrical faces need manual dimensions; incomplete bore callouts are omitted."); return; }
        return { diameter: radius * 2, length, direction: vector, start: [origin.X() + vector[0] * firstV, origin.Y() + vector[1] * firstV, origin.Z() + vector[2] * firstV] as [number, number, number] };
      });
      if (bore) { if (bores.length >= 64) throw new Error("Drawing exceeds the 64-bore callout limit. Select a simpler part."); bores.push(bore); }
    }
    return { bores, warnings: [...warnings] };
  });
}
