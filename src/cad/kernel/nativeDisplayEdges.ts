import { withDisposableScope, type DisposableScope } from "./disposableScope";

const MAX_EDGE_USES = 12_000;
const MAX_SEGMENTS_PER_EDGE = 768;
export const MAX_BODY_EDGE_SEGMENTS = 8_000;
export const MAX_PROJECT_EDGE_SEGMENTS = 60_000;
export const MAX_PROJECT_EDGE_USES = 40_000;
type Vertex = [number, number, number];
interface EdgeUse { edge: any; face: any }
interface EdgeRecord extends EdgeUse { neighbor?: EdgeUse; nonManifold?: boolean }
export interface DisplayEdgeBudget { edgeUses: number }

/** Runtime display lines from the finished BRep. Face triangulation boundaries
 * keep the lines coincident with the solid mesh. Faces without a triangulation
 * use samples on the native curve instead. */
export function nativeDisplayEdges(oc: Record<string, any>, shape: unknown, maxSegments: number, budget?: DisplayEdgeBudget): Float32Array {
  return withDisposableScope(scope => {
    const groups = new Map<number, EdgeRecord[]>();
    const { TopAbs_FACE, TopAbs_EDGE, TopAbs_SHAPE } = oc.TopAbs_ShapeEnum;
    const faces = scope.use(new oc.TopExp_Explorer_2(shape, TopAbs_FACE, TopAbs_SHAPE));
    let edgeUses = 0;
    for (; faces.More(); faces.Next()) {
      withDisposableScope(faceScope => {
        const face = faceScope.use(oc.TopoDS.Face_1(faceScope.use(faces.Current())));
        let retained = false;
        const retainFace = () => {
          if (!retained) { scope.use(faceScope.release(face)); retained = true; }
          return face;
        };
        const edges = faceScope.use(new oc.TopExp_Explorer_2(face, TopAbs_EDGE, TopAbs_SHAPE));
        for (; edges.More(); edges.Next()) {
          if (++edgeUses > MAX_EDGE_USES) throw new Error("Native edge traversal exceeds the display budget.");
          if (budget) {
            if (!budget.edgeUses) throw new Error("Project exceeds the native edge traversal budget.");
            budget.edgeUses--;
          }
          withDisposableScope(edgeScope => {
            const edge = edgeScope.use(oc.TopoDS.Edge_1(edgeScope.use(edges.Current())));
            if (oc.BRep_Tool.Degenerated(edge) || oc.BRep_Tool.IsClosed_2(edge, face)) return;
            const hash = edge.HashCode(2_147_483_647);
            const bucket = groups.get(hash) ?? [];
            const record = bucket.find(candidate => candidate.edge.IsSame(edge));
            if (!record) {
              bucket.push({ edge: scope.use(edgeScope.release(edge)), face: retainFace() });
              groups.set(hash, bucket);
            } else if (!record.face.IsSame(face)) {
              if (record.neighbor) {
                if (!record.neighbor.face.IsSame(face)) record.nonManifold = true;
              } else record.neighbor = { edge: scope.use(edgeScope.release(edge)), face: retainFace() };
            }
          });
        }
      });
    }

    const segments: number[] = [];
    for (const bucket of groups.values()) {
      for (const record of bucket) {
        withDisposableScope(edgeScope => {
          if (record.neighbor && !record.nonManifold && isSmooth(oc, record, record.neighbor, edgeScope)) return;
          const points = triangulatedEdge(oc, record, edgeScope) ?? curvePoints(oc, record.edge, edgeScope);
          for (let index = 1; index < points.length; index++) {
            const a = points[index - 1], b = points[index];
            if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 1e-9) continue;
            if (segments.length / 6 >= maxSegments) throw new Error("Native edges exceed the display segment budget.");
            segments.push(...a, ...b);
          }
        });
      }
    }
    return new Float32Array(segments);
  });
}

function isSmooth(oc: Record<string, any>, a: EdgeUse, b: EdgeUse, scope: DisposableScope): boolean {
  const continuity = oc.BRep_Tool.Continuity_1(a.edge, a.face, b.face);
  if (continuity.value > oc.GeomAbs_Shape.GeomAbs_C0.value) return true;
  // STEP and Boolean results may leave tangent joins without a continuity tag.
  // Compare oriented normals at matching interior samples of the shared edge.
  if (!oc.BRep_Tool.SameParameter(a.edge)) return false;
  try {
    const normal = (use: EdgeUse) => {
      const curve = scope.use(new oc.BRepAdaptor_Curve2d_2(use.edge, use.face));
      const surface = scope.use(new oc.BRepAdaptor_Surface_2(use.face, true));
      const point = scope.use(new oc.gp_Pnt_1());
      const du = scope.use(new oc.gp_Vec_1()), dv = scope.use(new oc.gp_Vec_1());
      const first = curve.FirstParameter(), last = curve.LastParameter();
      const sign = use.face.Orientation_1().value === oc.TopAbs_Orientation.TopAbs_REVERSED.value ? -1 : 1;
      return (fraction: number) => withDisposableScope(sample => {
        const uv = sample.use(curve.Value(first + fraction * (last - first)));
        surface.D1(uv.X(), uv.Y(), point, du, dv);
        const n = sample.use(du.Crossed(dv)), length = n.Magnitude();
        return length > 1e-12 ? { point: coordinates(point), normal: [sign * n.X() / length, sign * n.Y() / length, sign * n.Z() / length] } : undefined;
      });
    };
    const first = normal(a), second = normal(b);
    return [0.25, 0.5, 0.75].every(fraction => {
      const x = first(fraction), y = second(fraction);
      return x && y && Math.hypot(...x.point.map((coordinate, axis) => coordinate - y.point[axis])) <= 1e-6 &&
        x.normal.reduce((dot, coordinate, axis) => dot + coordinate * y.normal[axis], 0) > 0.99999;
    });
  } catch {
    return false;
  }
}

function coordinates(point: any): Vertex {
  const result: Vertex = [point.X(), point.Y(), point.Z()];
  if (!result.every(Number.isFinite)) throw new Error("A native edge has nonfinite coordinates.");
  return result;
}

function triangulatedEdge(oc: Record<string, any>, { edge, face }: EdgeUse, scope: DisposableScope): Vertex[] | undefined {
  const location = scope.use(new oc.TopLoc_Location_1());
  const triangulation = scope.use(oc.BRep_Tool.Triangulation(face, location));
  if (triangulation.IsNull()) return undefined;
  const handle = scope.use(oc.BRep_Tool.PolygonOnTriangulation_1(edge, triangulation, location));
  if (handle.IsNull()) return undefined;
  // Borrowed triangulation and polygon objects are owned by the handles.
  const polygon = handle.get(), mesh = triangulation.get();
  if (polygon.NbNodes() > MAX_SEGMENTS_PER_EDGE + 1) throw new Error("A native edge exceeds the per-curve display budget.");
  const nodes = scope.use(polygon.Nodes());
  const transform = scope.use(location.Transformation());
  const points: Vertex[] = [];
  for (let index = nodes.Lower(); index <= nodes.Upper(); index++) {
    points.push(withDisposableScope(sample => {
      const point = sample.use(mesh.Node(nodes.Value(index)));
      point.Transform(transform);
      return coordinates(point);
    }));
  }
  return points;
}

function curvePoints(oc: Record<string, any>, edge: any, scope: DisposableScope): Vertex[] {
  const curve = scope.use(new oc.BRepAdaptor_Curve_2(edge));
  const first = curve.FirstParameter(), last = curve.LastParameter();
  if (!Number.isFinite(first) || !Number.isFinite(last) || !(last > first))
    throw new Error("A native edge has an invalid parameter range.");
  const divisions = curve.GetType().value === oc.GeomAbs_CurveType.GeomAbs_Line.value ? 1 : 64;
  return Array.from({ length: divisions + 1 }, (_, i) => withDisposableScope(sample =>
    coordinates(sample.use(curve.Value(first + (last - first) * i / divisions)))));
}
