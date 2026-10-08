import type { CadDocument, ComponentPlacement, FittedPartFeature } from "../document/schema";
import { bodyComponentId, featureComponentId } from "../document/components";
import { IDENTITY_PLACEMENT, withComponentPlacement } from "../document/componentPlacement";
import { TESSELLATION_LOD } from "../kernel/tessellationCache";
import type { RenderMesh, BoundingBox, KernelAdapter, KernelShape } from "../kernel/KernelAdapter";
import type { Quantity } from "../parameters/units";
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";

export interface FittedBox { min: [number, number, number]; size: [number, number, number] }
export interface FittedPartPlan { boxes: FittedBox[]; operation: "cut" | "fuse"; volume: number }
export function fittedPartPlan(bounds: BoundingBox, clearance: number, wall: number, style: FittedPartFeature["style"]): FittedPartPlan {
  const sizes = bounds.max.map((n, i) => n - bounds.min[i]);
  if (![...bounds.min, ...bounds.max, clearance, wall].every(Number.isFinite) || sizes.some(n => n <= 1e-5) || clearance < 0 || clearance > 1e6 || wall < 1e-5 || wall > 1e6) throw new Error("Fit requires a finite solid envelope, clearance from 0–1,000,000 mm and wall thickness from 0.00001–1,000,000 mm.");
  const [x, y, z] = bounds.min, [w, d, h] = sizes;
  const width = w + 2 * (clearance + wall), depth = d + 2 * (clearance + wall), innerWidth = w + 2 * clearance, innerDepth = d + 2 * clearance;
  const min: [number, number, number] = [x - clearance - wall, y - clearance - wall, z - clearance - wall];
  let plan: FittedPartPlan;
  if (style === "bracket") {
    const height = h + clearance + wall;
    plan = { boxes: [{ min, size: [width, depth, wall] }, { min, size: [width, wall, height] }], operation: "fuse", volume: width * depth * wall + width * wall * (height - wall) };
  } else if (style === "adapter") {
    const height = h + 2 * clearance;
    plan = { boxes: [{ min: [min[0], min[1], z - clearance], size: [width, depth, height] }, { min: [x - clearance, y - clearance, z - clearance - wall], size: [innerWidth, innerDepth, height + 2 * wall] }], operation: "cut", volume: (width * depth - innerWidth * innerDepth) * height };
  } else if (style === "enclosure") {
    const innerHeight = h + 2 * clearance, height = innerHeight + wall;
    plan = { boxes: [{ min, size: [width, depth, height] }, { min: [x - clearance, y - clearance, z - clearance], size: [innerWidth, innerDepth, innerHeight + wall] }], operation: "cut", volume: width * depth * height - innerWidth * innerDepth * innerHeight };
  } else throw new Error("Choose an open enclosure, L bracket or open adapter sleeve.");
  if (!Number.isFinite(plan.volume) || plan.volume <= 0 || plan.boxes.some(box => box.size.some(n => n <= 0 || n > 1e8) || box.min.some((n, i) => Math.abs(n) > 1e8 || Math.abs(n + box.size[i]) > 1e8))) throw new Error("Fitted part exceeds the supported finite geometry bounds. Reduce clearance or wall thickness.");
  return plan;
}
export function createFittedPartShape(feature: FittedPartFeature, source: KernelShape, kernel: KernelAdapter, parameters: Record<string, Quantity>, owned: Set<KernelShape>): { shape: KernelShape; mesh: RenderMesh } {
  if (!kernel.nativeBounds || !kernel.placeShape) throw new Error("Fitted parts require native OpenCascade solid bounds and transforms.");
  const length = (field: "clearance" | "wallThickness") => {
    const evaluated = evaluateExpressionRef(feature[field], { parameters });
    if (evaluated.error || evaluated.quantity?.dimension !== "length") throw new Error(evaluated.error ?? `${field} must resolve to millimeters.`);
    return evaluated.quantity.value;
  };
  const plan = fittedPartPlan(kernel.nativeBounds(source), length("clearance"), length("wallThickness"), feature.style);
  const boxes = plan.boxes.map(box => {
    const shape = kernel.createBox(...box.size); owned.add(shape);
    // createBox is centered in XY and starts at Z=0. Place its minimum at the planned corner.
    const translated = kernel.placeShape!(shape, { translation: [box.min[0] + box.size[0] / 2, box.min[1] + box.size[1] / 2, box.min[2]], rotation: [0, 0, 0] }); owned.add(translated); return translated;
  });
  const result = plan.operation === "cut" ? kernel.cut(boxes[0], boxes[1]) : kernel.fuse(boxes[0], boxes[1]); owned.add(result);
  const mesh = kernel.tessellate(result, TESSELLATION_LOD.default), proof = mesh.geometryAssertions;
  if (mesh.geometrySource !== "opencascade" || !proof?.valid || proof.solidCount !== 1 || Math.abs(proof.volume - plan.volume) > Math.max(1e-7, plan.volume * 1e-8)) throw new Error("Fitted geometry failed native validity, solid-count or exact-volume checks.");
  return { shape: result, mesh };
}
/** A fitted component follows the reference's resolved pose without saving transient geometry. */
export function followFittedPlacements(document: CadDocument): CadDocument {
  let positioned = document;
  const pending = document.features.filter((feature): feature is FittedPartFeature => feature.type === "fit" && !feature.suppressed && feature.followSourcePlacement);
  const children = new Set(pending.map(feature => featureComponentId(document, feature)));
  const complete = new Set<string>();
  while (pending.length) {
    const index = pending.findIndex(feature => { const parent = bodyComponentId(document, feature.sourceBodyId); return parent && (!children.has(parent) || complete.has(parent)); });
    if (index < 0) throw new Error("Fitted reference placement cycle or missing source. Repair the fitted part reference.");
    const [feature] = pending.splice(index, 1), parent = bodyComponentId(document, feature.sourceBodyId)!;
    const placement: ComponentPlacement = positioned.components[parent]?.placement ?? IDENTITY_PLACEMENT;
    positioned = withComponentPlacement(positioned, featureComponentId(document, feature), placement); complete.add(featureComponentId(document, feature));
  }
  return positioned;
}
