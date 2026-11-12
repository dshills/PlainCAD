import type { LeadScrewDimensions } from "../hardware/leadScrewSettings";
import type { GeometryAssertions } from "./KernelAdapter";
import { withDisposableScope } from "./disposableScope";
import { measureShape, volumeTolerance } from "./occtGeometry";
import { helicalBandVolume, helicalTool } from "./nativeThreads";

const TAU = 2 * Math.PI;
const axis = { x: 0, y: 0, z: 1 };

function nutGrooveHalfWidth(d: LeadScrewDimensions, radius: number): number {
  return d.pitch / 4 + d.slope * (d.major - radius) + d.clearance * (1 + d.slope);
}

/** The nut's groove is the complement of the screw's ridge with radial and flank clearance. */
export function createNativeLeadPart(
  oc: Record<string, any>, d: LeadScrewDimensions, nut: boolean, progress?: (stage: string) => void,
): { native: any; proof: GeometryAssertions } {
  return withDisposableScope(scope => {
    const direction = scope.use(new oc.gp_Dir_4(0, 0, 1));
    const cylinder = (r: number, length: number, z = 0) => {
      const p = scope.use(new oc.gp_Pnt_3(0, 0, z));
      const frame = scope.use(new oc.gp_Ax2_3(p, direction));
      const maker = scope.use(new oc.BRepPrimAPI_MakeCylinder_3(frame, r, length));
      return scope.use(maker.Shape());
    };
    const cut = (base: any, tool: any, local = scope) => {
      const builder = local.use(new oc.BRepAlgoAPI_Cut_3(base, tool));
      if (!builder.IsDone()) throw new Error("OpenCascade could not cut the lead screw or nut. Try a shorter length.");
      return local.use(builder.Shape());
    };
    const stockLength = nut ? d.nutLength : d.screwLength;
    const stock = cylinder(nut ? d.nutOuter : d.major, stockLength);
    let native = nut ? cut(stock, cylinder(d.bore, stockLength)) : stock;
    let proof = measureShape(oc, native);
    const nominal = Math.PI * stockLength * (nut ? d.nutOuter ** 2 - d.bore ** 2 : d.major ** 2);
    if (proof.solidCount !== 1 || Math.abs(proof.volume - nominal) > volumeTolerance(nominal))
      throw new Error("Lead screw blank or nut stock failed native dimensional validation.");

    const start = d.pitch * .65, endMargin = d.pitch * .85;
    const length = stockLength - start - endMargin;
    const toolOverlap = d.pitch * .05;
    const inner = nut ? d.bore : d.minor;
    const outer = nut ? d.major + d.clearance : d.major;
    const cutterInner = nut ? inner - toolOverlap : inner;
    const cutterOuter = nut ? outer : outer + toolOverlap;
    const halfWidth = (r: number) => nut
      ? nutGrooveHalfWidth(d, r)
      : d.pitch / 4 + d.slope * (r - d.major);
    const expected = helicalBandVolume({
      radius: nut ? d.bore : d.major, pitch: d.lead, length, offset: 0, innerRadius: inner, outerRadius: outer,
      innerHalfWidth: halfWidth(inner), outerHalfWidth: halfWidth(outer),
    });
    const a = halfWidth(cutterInner), b = halfWidth(cutterOuter);
    for (let index = 0; index < d.starts; index += 1) {
      progress?.(nut ? "lead_nut_thread" : "lead_screw_thread");
      const phase = (index + (nut ? 0 : .5)) * TAU / d.starts;
      const before = proof.volume;
      const next = withDisposableScope(local => {
        const tool = helicalTool(oc, local, { origin: { x: 0, y: 0, z: start }, axis,
          radial: { x: Math.cos(phase), y: Math.sin(phase), z: 0 },
          lead: d.lead, length, hand: d.hand,
          profile: [[cutterInner, -a], [cutterOuter, -b], [cutterOuter, b], [cutterInner, a]] });
        if (measureShape(oc, tool).solidCount !== 1) throw new Error("The helical tool is not one native solid.");
        const shape = cut(native, tool, local);
        const measured = measureShape(oc, shape);
        const delta = before - measured.volume;
        if (measured.solidCount !== 1 || Math.abs(delta - expected) > Math.max(1e-6, expected * .015))
          throw new Error("The lead screw did not cut the expected groove volume. Reduce the length, starts or clearance.");
        return { shape: local.release(shape), proof: measured };
      });
      if (native !== stock) scope.release(native).delete();
      native = scope.use(next.shape);
      proof = next.proof;
    }

    // Reliefs overlap the helical grooves so the nut has a through passage.
    progress?.(nut ? "lead_nut_reliefs" : "lead_screw_tip");
    const lip = d.pitch * .025;
    const reliefRadius = nut ? outer + lip : inner - lip;
    const frontEnd = start + Math.max(a, b) + d.pitch * .01;
    const rearStart = stockLength - endMargin - Math.max(a, b) - d.pitch * .01;
    const front = cylinder(reliefRadius, frontEnd + lip, -lip);
    let finished = nut ? cut(native, front) : cut(native, cut(cylinder(cutterOuter, frontEnd + lip, -lip), front));
    if (nut) finished = cut(finished, cylinder(reliefRadius, stockLength - rearStart + lip, rearStart));
    const finalProof = measureShape(oc, finished);
    if (finalProof.solidCount !== 1 || proof.volume - finalProof.volume <= volumeTolerance(proof.volume))
      throw new Error("Lead screw entry or nut end relief failed native validation.");

    // Check a full ridge/groove pair on each start near the middle of the
    // engagement and just before the far end of the threaded section.
    const classifier = scope.use(new oc.BRepClass3d_SolidClassifier_1());
    classifier.Load(finished);
    const r = (d.bore + d.major) / 2;
    const classify = (z: number, angle: number, radius: number) => {
      const p = scope.use(new oc.gp_Pnt_3(radius * Math.cos(angle), radius * Math.sin(angle), z));
      classifier.Perform(p, 1e-7);
      return scope.use(classifier.State()).value;
    };
    const states = oc.TopAbs_State;
    for (const z of [stockLength / 2, rearStart - d.pitch * .1]) {
      for (let index = 0; index < d.starts; index += 1) {
        const ridge = index * TAU / d.starts + d.hand * TAU * (z - start) / d.lead;
        const valley = ridge + Math.PI / d.starts;
        if (classify(z, nut ? ridge : valley, r) !== states.TopAbs_OUT.value ||
            classify(z, nut ? valley : ridge, r) !== states.TopAbs_IN.value)
          throw new Error("Native lead screw or nut did not retain the expected thread phase and starts.");
      }
    }
    if (nut) for (const z of [d.pitch * .02, stockLength - d.pitch * .02]) {
      for (let index = 0; index < 4; index += 1)
        if (classify(z, index * TAU / 4, d.major) !== states.TopAbs_OUT.value)
          throw new Error("The matching nut needs open reliefs at both ends.");
    }
    return { native: scope.release(finished), proof: finalProof };
  });
}

/** Check the nominal clearance envelope against the actual native flank geometry. */
export function assertNativeLeadPair(oc: Record<string, any>, screw: any, nut: any, d: LeadScrewDimensions, progress?: (stage: string) => void) {
  progress?.("lead_pair_fit");
  withDisposableScope(scope => {
    const shaft = scope.use(new oc.BRepClass3d_SolidClassifier_1());
    const sleeve = scope.use(new oc.BRepClass3d_SolidClassifier_1());
    shaft.Load(screw);
    sleeve.Load(nut);
    const states = oc.TopAbs_State;
    const classify = (classifier: any, z: number, angle: number, radius: number, inside: boolean) =>
      withDisposableScope(sample => {
        const point = sample.use(new oc.gp_Pnt_3(radius * Math.cos(angle), radius * Math.sin(angle), z));
        classifier.Perform(point, 1e-7);
        return sample.use(classifier.State()).value === (inside ? states.TopAbs_IN.value : states.TopAbs_OUT.value);
      });

    // The gap is constant over the shared radial band. Verify both flanks
    // at two axial and radial stations on the native solids. The individual
    // cuts already verify the phase of every start near both ends.
    const start = .65 * d.pitch;
    const end = d.nutLength - .85 * d.pitch;
    for (const fraction of [1 / 3, 2 / 3]) {
      progress?.("lead_pair_flanks");
      const z = start + (end - start) * fraction;
      const ridge = d.hand * TAU * (z - start) / d.lead;
      const r = d.bore + (d.major - d.bore) * fraction;
      const opening = nutGrooveHalfWidth(d, r);
      const ridgeWidth = d.pitch / 4 + d.slope * (d.major - r);
      const gap = opening - ridgeWidth;
      const occupied = (offset: number, screwIn: boolean, nutIn: boolean) => {
        const angle = ridge + offset * TAU / d.lead;
        return classify(shaft, z, angle, r, screwIn) && classify(sleeve, z, angle, r, nutIn);
      };
      if (!(gap > 0 && opening < d.pitch / 2) || !occupied(0, true, false) ||
          !occupied(d.pitch / 2, false, true) || ![-1, 1].every(sign =>
            occupied(sign * (ridgeWidth - gap / 2), true, false) &&
            occupied(sign * (ridgeWidth + gap / 2), false, false) &&
            occupied(sign * (opening + (d.pitch / 2 - opening) / 2), false, true)))
        throw new Error("Native lead screw and nut flanks do not match the clearance envelope. Adjust the radial clearance or dimensions.");
    }
  });
}
