import type { CadDocument, ExpressionRef, LeadNutFeature, LeadScrewFeature } from "../document/schema";
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";
import type { Quantity } from "../parameters/units";

export const LEAD_SCREW_STYLES = ["trapezoidal", "acme"] as const;
export const LEAD_STARTS = [1, 2, 3, 4] as const;
const LENGTH_EPSILON = 1e-8;

export interface LeadScrewDimensions {
  major: number;
  minor: number;
  bore: number;
  nutOuter: number;
  pitch: number;
  lead: number;
  screwLength: number;
  nutLength: number;
  clearance: number;
  slope: number;
  starts: number;
  hand: 1 | -1;
}

export function leadScrewDimensions(screw: LeadScrewFeature, nut: LeadNutFeature | undefined, parameters: Record<string, Quantity>): LeadScrewDimensions {
  const read = (ref: ExpressionRef, label: string) => {
    const value = evaluateExpressionRef(ref, { parameters });
    if (value.error || value.quantity?.dimension !== "length" || !Number.isFinite(value.quantity.value) || value.quantity.value <= 0)
      throw new Error(value.error ?? `Lead screw ${label} requires a positive length.`);
    return value.quantity.value;
  };
  const major = read(screw.diameter, "diameter") / 2, pitch = read(screw.pitch, "pitch");
  const screwLength = read(screw.screwLength, "length");
  const clearance = nut ? read(nut.clearance, "nut clearance") : pitch * .05;
  const nutLength = nut ? read(nut.nutLength, "nut length") : 5 * pitch;
  const lead = pitch * screw.starts;
  if (pitch < .5 || pitch > 6 || major * 2 < 3 * pitch - LENGTH_EPSILON || major > 25)
    throw new Error("Use a pitch of 0.5–6 mm and a diameter of at least three pitches and at most 50 mm.");
  if (clearance < .025 * pitch - LENGTH_EPSILON || clearance > .10 * pitch + LENGTH_EPSILON)
    throw new Error("Use radial clearance between 2.5% and 10% of the pitch.");
  const maxNutPitches = screw.starts >= 3 ? 6 : 8;
  const maxScrewPitches = screw.starts >= 3 ? 10 : 14;
  if (nut && (nutLength < 4.75 * pitch - LENGTH_EPSILON || nutLength > maxNutPitches * pitch + LENGTH_EPSILON))
    throw new Error(`Use a nut length of 4.75–${maxNutPitches} pitches for the selected number of starts.`);
  if (screwLength < (nut ? nutLength + pitch : 5 * pitch) - LENGTH_EPSILON || screwLength > maxScrewPitches * pitch + LENGTH_EPSILON)
    throw new Error(nut ? `Use a screw at least one pitch longer than the nut and at most ${maxScrewPitches} pitches for the selected number of starts.` :
      `Use a screw length of 5–${maxScrewPitches} pitches for the selected number of starts.`);
  const minor = major - pitch / 2;
  const bore = minor + clearance;
  return { major, minor, bore, nutOuter: major + pitch, pitch, lead, screwLength, nutLength, clearance,
    slope: Math.tan((screw.form === "acme" ? 14.5 : 15) * Math.PI / 180), starts: screw.starts, hand: screw.hand === "left" ? -1 : 1 };
}

export function activeMatchingNuts(document: CadDocument, screwId: string): LeadNutFeature[] {
  return document.features.filter((feature): feature is LeadNutFeature =>
    feature.type === "leadNut" && !feature.suppressed && feature.screwFeatureId === screwId);
}

export function validateLeadScrewEdit(document: CadDocument, screw: LeadScrewFeature, parameters: Record<string, Quantity>) {
  const nuts = activeMatchingNuts(document, screw.id);
  if (screw.suppressed) {
    if (nuts.length) throw new Error("Suppress the matching nuts before suppressing their lead screw.");
    return;
  }
  leadScrewDimensions(screw, undefined, parameters);
  for (const nut of nuts) {
    try {
      leadScrewDimensions(screw, nut, parameters);
    } catch (error) {
      throw new Error(`${nut.name}: ${error instanceof Error ? error.message : String(error)} Suppress that nut, edit the screw, then unsuppress the nut with updated dimensions.`);
    }
  }
}
