import type { ThreadFeature } from "../document/schema";
import type { ThreadDimensions } from "../hardware/threadSettings";
import type { GeometryAssertions } from "./KernelAdapter";
import { withDisposableScope, type DisposableScope } from "./disposableScope";
import { dot, measureShape, subtract, volumeTolerance } from "./occtGeometry";
import type { Point3 } from "../sketch/planes";

const LINEAR_TOLERANCE = 1e-7;
const TAU = 2 * Math.PI;
const asPoint = (value: any): Point3 => ({ x: value.X(), y: value.Y(), z: value.Z() });
const add = (a: Point3, b: Point3, scale: number): Point3 => ({ x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale });
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

export function nativeThreadsAvailable(oc?: Record<string, any>) {
  return typeof oc?.BRepOffsetAPI_MakePipeShell === "function" && typeof oc.BRepBuilderAPI_MakeEdge_31 === "function" &&
    typeof oc.BRepLib?.BuildCurve3d === "function" && typeof oc.BRepClass3d_SolidClassifier_1 === "function";
}

interface CylinderBand {
  start: Point3;
  axis: Point3;
  seam: Point3;
  length: number;
}

/** Match one complete cylindrical surface of the specified material side and radius. */
function cylinderBand(oc: Record<string, any>, source: any, radius: number, internal: boolean): CylinderBand {
  return withDisposableScope(scope => {
    const candidates: CylinderBand[] = [];
    const explorer = scope.use(new oc.TopExp_Explorer_2(source, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    let count = 0;
    for (; explorer.More(); explorer.Next()) {
      if (++count > 256) throw new Error("Thread cylinder inspection exceeds 256 faces. Select a simpler body.");
      const band = withDisposableScope(local => {
        const face = local.use(oc.TopoDS.Face_1(local.use(explorer.Current())));
        const surface = local.use(new oc.BRepAdaptor_Surface_2(face, true));
        if (surface.GetType().value !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder.value) return;
        const cylinder = local.use(surface.Cylinder());
        const r = cylinder.Radius(), u0 = surface.FirstUParameter(), u1 = surface.LastUParameter();
        const v0 = surface.FirstVParameter(), v1 = surface.LastVParameter(), length = v1 - v0;
        if (Math.abs(r - radius) > LINEAR_TOLERANCE || Math.abs(u1 - u0 - TAU) > 1e-8 || !(length > LINEAR_TOLERANCE)) return;
        const props = local.use(new oc.GProp_GProps_1());
        oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
        if (Math.abs(props.Mass() - TAU * r * length) > Math.max(1e-7, TAU * r * length * 1e-8)) return;
        const frame = local.use(cylinder.Position());
        const origin = asPoint(local.use(frame.Location())), axis = asPoint(local.use(frame.Direction()));
        const atSeam = local.use(surface.Value(u0, v0));
        const start = add(origin, axis, v0);
        const seam = add({ x: 0, y: 0, z: 0 }, subtract(asPoint(atSeam), start), 1 / r);
        const point = local.use(new oc.gp_Pnt_3(0, 0, 0));
        const du = local.use(new oc.gp_Vec_4(0, 0, 0)), dv = local.use(new oc.gp_Vec_4(0, 0, 0));
        surface.D1((u0 + u1) / 2, v0, point, du, dv);
        const orientation = local.use(face.Orientation_1()).value;
        const normalSign = orientation === oc.TopAbs_Orientation.TopAbs_FORWARD.value ? 1 :
          orientation === oc.TopAbs_Orientation.TopAbs_REVERSED.value ? -1 : 0;
        const facing = normalSign * dot(cross(asPoint(du), asPoint(dv)), subtract(asPoint(point), start));
        if (Math.abs(facing) <= r * r * 1e-8 || (facing < 0) !== internal) return;
        // Keep the axial direction deterministic across equivalent native parameterizations.
        const dominant = [axis.x, axis.y, axis.z].sort((a, b) => Math.abs(b) - Math.abs(a))[0];
        return dominant < 0 ? { start: add(start, axis, length), axis: add({ x: 0, y: 0, z: 0 }, axis, -1), seam, length } :
          { start, axis, seam, length };
      });
      if (band) candidates.push(band);
    }
    if (candidates.length !== 1)
      throw new Error(candidates.length ? "Several cylinders match this size. Select a body with one matching cylinder." :
        `Select one complete ${internal ? "tap-drill bore" : "nominal-diameter shaft"} of Ø${(2 * radius).toFixed(4)} mm.`);
    const band = candidates[0];
    const classifier = scope.use(new oc.BRepClass3d_SolidClassifier_1());
    classifier.Load(source);
    const isOpen = (z: number) => {
      const p = add(band.start, band.axis, z);
      classifier.Perform(scope.use(new oc.gp_Pnt_3(p.x, p.y, p.z)), LINEAR_TOLERANCE);
      return scope.use(classifier.State()).value === oc.TopAbs_State.TopAbs_OUT.value;
    };
    const step = Math.min(band.length / 4, radius * .01);
    if (isOpen(-step)) return band;
    if (isOpen(band.length + step)) return { ...band, start: add(band.start, band.axis, band.length),
      axis: add({ x: 0, y: 0, z: 0 }, band.axis, -1) };
    throw new Error(internal ? "The tap-drill cylinder has no clear entrance. Select a bore that opens onto the part surface." :
      "The shaft has no free end for a lead-in. Select a shaft with an exposed tip.");
  });
}

interface HelicalSweep {
  origin: Point3;
  axis: Point3;
  radial: Point3;
  lead: number;
  length: number;
  hand: 1 | -1;
  profile: Array<readonly [radius: number, axial: number]>;
}

/** Sweep a radial/axial section using a cylindrical helix and fixed axial binormal. */
export function helicalTool(oc: Record<string, any>, scope: DisposableScope, sweep: HelicalSweep) {
  const point = (p: Point3) => scope.use(new oc.gp_Pnt_3(p.x, p.y, p.z));
  const dir = (p: Point3) => scope.use(new oc.gp_Dir_4(p.x, p.y, p.z));
  const axis = dir(sweep.axis);
  const frame = scope.use(new oc.gp_Ax3_3(point(sweep.origin), axis, dir(sweep.radial)));
  const pathRadius = sweep.profile.reduce((sum, pair) => sum + pair[0], 0) / sweep.profile.length;
  const cylinder = new oc.Geom_CylindricalSurface_1(frame, pathRadius);
  const surface = scope.use(new oc.Handle_Geom_Surface_2(cylinder));
  const rise = sweep.lead / TAU;
  const origin = scope.use(new oc.gp_Pnt2d_3(0, 0)), direction = scope.use(new oc.gp_Dir2d_4(sweep.hand, rise));
  const line = new oc.Geom2d_Line_3(origin, direction);
  const curve = scope.use(new oc.Handle_Geom2d_Curve_2(line));
  const parameter = Math.hypot(1, rise) * sweep.length / rise;
  const edgeMaker = scope.use(new oc.BRepBuilderAPI_MakeEdge_31(curve, surface, 0, parameter));
  if (!edgeMaker.IsDone()) throw new Error("OpenCascade could not construct the helical path.");
  const edge = scope.use(edgeMaker.Edge());
  if (!oc.BRepLib.BuildCurve3d(edge, LINEAR_TOLERANCE, oc.GeomAbs_Shape.GeomAbs_C1, 14, 0))
    throw new Error("OpenCascade could not resolve the 3D helix.");
  const wireMaker = scope.use(new oc.BRepBuilderAPI_MakeWire_2(edge));
  const spine = scope.use(wireMaker.Wire());
  const polygon = scope.use(new oc.BRepBuilderAPI_MakePolygon_1());
  for (const [r, z] of sweep.profile) polygon.Add_1(point(add(add(sweep.origin, sweep.radial, r), sweep.axis, z)));
  polygon.Close();
  const section = scope.use(polygon.Wire());
  const pipe = scope.use(new oc.BRepOffsetAPI_MakePipeShell(spine));
  pipe.SetMode_3(axis);
  pipe.SetTolerance(1e-8, 1e-8, 1e-8);
  pipe.SetMaxDegree(14);
  pipe.SetMaxSegments(128);
  pipe.Add_1(section, false, false);
  pipe.Build();
  if (!pipe.IsDone() || !pipe.MakeSolid()) throw new Error("OpenCascade could not build a closed helical cutter. Shorten the thread.");
  return scope.use(pipe.Shape());
}

/** Volume of the swept section within its nominal cylindrical material band. */
export function helicalBandVolume(d: ThreadDimensions) {
  const h = d.outerRadius - d.innerRadius, w0 = d.innerHalfWidth, w1 = d.outerHalfWidth;
  return 2 * TAU * d.length / d.pitch * h * (d.innerRadius * (w0 + w1) / 2 + h * (w0 + 2 * w1) / 6);
}

export function cutNativeThread(
  oc: Record<string, any>, source: any, settings: Pick<ThreadFeature, "side" | "hand">,
  d: ThreadDimensions, before: GeometryAssertions,
): { native: any; proof: GeometryAssertions } {
  if (!nativeThreadsAvailable(oc)) throw new Error("This OpenCascade build cannot create modeled threads.");
  if (before.solidCount !== 1) throw new Error("Thread requires exactly one native target solid.");
  const internal = settings.side === "internal";
  const band = cylinderBand(oc, source, d.radius, internal);
  const margin = d.pitch * .55;
  if (d.length + d.offset + 2 * margin > band.length + LINEAR_TOLERANCE)
    throw new Error("Thread length and offset exceed this cylinder after reserving runout space at both ends.");
  const origin = add(band.start, band.axis, margin + d.offset);
  const inner = internal ? d.innerRadius - d.pitch * .08 : d.innerRadius;
  const outer = internal ? d.outerRadius : d.outerRadius + d.pitch * .08;
  const slope = (d.outerHalfWidth - d.innerHalfWidth) / (d.outerRadius - d.innerRadius);
  const a = d.innerHalfWidth + (inner - d.innerRadius) * slope, b = d.outerHalfWidth + (outer - d.outerRadius) * slope;
  const hand = settings.hand === "right" ? 1 : -1;
  const expected = helicalBandVolume(d);
  return withDisposableScope(scope => {
    const tool = helicalTool(oc, scope, { origin, axis: band.axis, radial: band.seam, lead: d.pitch, length: d.length,
      hand, profile: [[inner, -a], [outer, -b], [outer, b], [inner, a]] });
    if (measureShape(oc, tool).solidCount !== 1) throw new Error("The helical tool is not one valid solid.");
    const cut = scope.use(new oc.BRepAlgoAPI_Cut_3(source, tool));
    if (!cut.IsDone()) throw new Error("OpenCascade could not cut the modeled thread.");
    const grooved = scope.use(cut.Shape());
    const grooveProof = measureShape(oc, grooved), removed = before.volume - grooveProof.volume;
    if (grooveProof.solidCount !== 1 || removed <= volumeTolerance(before.volume) ||
        Math.abs(removed - expected) > Math.max(1e-6, expected * .01))
      throw new Error("The thread did not remove the expected helical volume. Select an uninterrupted cylinder or shorten the thread.");
    // Open one end of the modeled section. A bore needs radial clearance for
    // a crest and a shaft needs a reduced tip that can enter a pilot bore.
    const entryRadius = internal ? d.outerRadius + d.pitch * .02 : d.innerRadius - d.pitch * .02;
    const entryEnd = margin + d.offset + d.pitch * .19;
    const axis = scope.use(new oc.gp_Dir_4(band.axis.x, band.axis.y, band.axis.z));
    const makeCylinder = (radius: number, depth: number, offset = 0) => {
      const start = add(band.start, band.axis, offset);
      const point = scope.use(new oc.gp_Pnt_3(start.x, start.y, start.z));
      const frame = scope.use(new oc.gp_Ax2_3(point, axis));
      const maker = scope.use(new oc.BRepPrimAPI_MakeCylinder_3(frame, radius, depth));
      return scope.use(maker.Shape());
    };
    const cutAnnulus = (outer: any, inner: any) => {
      const builder = scope.use(new oc.BRepAlgoAPI_Cut_3(outer, inner));
      if (!builder.IsDone()) throw new Error("OpenCascade could not build a thread lead-in verification tool.");
      return scope.use(builder.Shape());
    };
    const overrun = d.pitch * .1;
    const cylinder = makeCylinder(entryRadius, entryEnd + overrun, -overrun);
    let relief = cylinder;
    if (!internal) {
      const outer = makeCylinder(d.outerRadius + d.pitch * .08, entryEnd + overrun, -overrun);
      relief = cutAnnulus(outer, cylinder);
    }
    const opening = scope.use(new oc.BRepAlgoAPI_Cut_3(grooved, relief));
    if (!opening.IsDone()) throw new Error("OpenCascade could not create the thread lead-in.");
    const native = scope.use(opening.Shape()), proof = measureShape(oc, native);
    const entryRemoved = grooveProof.volume - proof.volume;
    const entryArea = Math.PI * Math.abs(entryRadius ** 2 - d.radius ** 2);
    const full = entryArea * entryEnd;
    const preservedRunout = Math.max(0, margin + d.offset - Math.max(d.innerHalfWidth, d.outerHalfWidth));
    if (proof.solidCount !== 1 || entryRemoved < entryArea * preservedRunout * .99 || entryRemoved > full * 1.01)
      throw new Error("The thread lead-in is obstructed, interrupted or would break through the surrounding wall.");
    const retainedRadius = entryRadius + (internal ? 1 : -1) * d.pitch * .01;
    const innerGuard = internal ? entryRadius + d.pitch * .002 : retainedRadius - d.pitch * .005;
    const guardStart = d.pitch * .002, guardDepth = entryEnd - 2 * guardStart;
    const guard = cutAnnulus(makeCylinder(retainedRadius, guardDepth, guardStart), makeCylinder(innerGuard, guardDepth, guardStart));
    const guardVolume = Math.PI * (retainedRadius ** 2 - innerGuard ** 2) * guardDepth;
    const common = scope.use(new oc.BRepAlgoAPI_Common_3(native, guard));
    if (!common.IsDone()) throw new Error("The native thread could not verify retained material around the lead-in.");
    const shared = scope.use(common.Shape());
    let retained = 0;
    try { retained = measureShape(oc, shared).volume; } catch { /* Missing material is rejected below. */ }
    if (Math.abs(retained - guardVolume) > Math.max(1e-8, guardVolume * .001))
      throw new Error("Thread lead-in needs retained material around the entire opening.");
    const stock = scope.use(new oc.BRepClass3d_SolidClassifier_1());
    stock.Load(source);
    // At one axial station the groove must exist on its authored phase, while
    // the opposite side stays solid. Sample two stations to verify handedness.
    const classifier = scope.use(new oc.BRepClass3d_SolidClassifier_1());
    classifier.Load(native);
    const across = cross(band.axis, band.seam), radius = (d.innerRadius + d.outerRadius) / 2;
    const classify = (z: number, angle: number, r = radius, solid = classifier) => {
      const radial = add(add({ x: 0, y: 0, z: 0 }, band.seam, Math.cos(angle)), across, Math.sin(angle));
      const p = add(add(origin, band.axis, z), radial, r);
      solid.Perform(scope.use(new oc.gp_Pnt_3(p.x, p.y, p.z)), LINEAR_TOLERANCE);
      return scope.use(solid.State()).value;
    };
    for (const fraction of [.25, d.length / d.pitch - .25]) {
      const z = d.pitch * fraction, angle = hand * TAU * fraction;
      if (classify(z, angle) !== oc.TopAbs_State.TopAbs_OUT.value ||
          classify(z, angle + Math.PI) !== oc.TopAbs_State.TopAbs_IN.value)
        throw new Error("The native cut did not retain the requested thread pitch and handedness.");
    }
    const entryStart = -(margin + d.offset);
    const entryTestRadius = internal ? d.outerRadius : d.innerRadius;
    const state = oc.TopAbs_State;
    for (let i = 0; i < 8; i += 1) {
      const angle = i * TAU / 8;
      if (classify(entryStart - d.pitch * .05, angle, retainedRadius, stock) !== state.TopAbs_OUT.value ||
          classify(entryStart - d.pitch * .05, angle, entryTestRadius, stock) !== state.TopAbs_OUT.value ||
          classify(entryStart + d.pitch * .05, angle, retainedRadius) !== state.TopAbs_IN.value ||
          classify(d.pitch * .12, angle, retainedRadius) !== state.TopAbs_IN.value)
        throw new Error("Thread lead-in needs an exposed end with retained material around the opening.");
      if (classify(entryStart - d.pitch * .05, angle, entryTestRadius) !== oc.TopAbs_State.TopAbs_OUT.value ||
          classify(entryStart + d.pitch * .05, angle, entryTestRadius) !== oc.TopAbs_State.TopAbs_OUT.value ||
          classify(d.pitch * .12, angle, entryTestRadius) !== oc.TopAbs_State.TopAbs_OUT.value)
        throw new Error("The modeled thread needs a clear lead-in at the selected cylinder end.");
    }
    return { native: scope.release(native), proof };
  });
}
