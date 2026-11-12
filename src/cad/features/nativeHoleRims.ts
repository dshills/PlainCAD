import type { CadDocument } from "../document/schema";
import { targetBodyIds } from "../document/bodyScopes";
import { bodyComponentId, featureComponentId, sketchComponentId } from "../document/components";
import { faceReferenceBodyId, MAX_MACHINED_REFERENCES } from "../document/faceReferences";
import type { KernelAdapter, KernelShape } from "../kernel/KernelAdapter";
import { dot, near } from "../kernel/occtGeometry";
import { evaluateExpressionRef } from "../parameters/expressionEvaluator";
import type { Quantity } from "../parameters/units";
import type { ResolvedSketch } from "../sketch/SketchSolver";
import { transformPoint, type SketchPlaneTransform } from "../sketch/planes";
import { KERNEL_LINEAR_TOLERANCE } from "../sketch/tolerances";
import type { AvailableHoleRim } from "../worker/workerProtocol";

export function currentNativeHoleRims(
  document: CadDocument, kernel: KernelAdapter,
  bodies: ReadonlyMap<string, { shape: KernelShape }>, failedBodies: ReadonlySet<string>,
  solved: ReadonlyMap<string, ResolvedSketch>, planes: ReadonlyMap<string, SketchPlaneTransform>,
  parameters: Record<string, Quantity>,
): AvailableHoleRim[] {
  if (!kernel.measureHoleRim) return [];
  const rims: AvailableHoleRim[] = [];
  let probes = 0;
  for (const feature of document.features) {
    if (feature.type !== "hole" || feature.suppressed || feature.direction !== "negative" || feature.centerPointIds.length !== 1) continue;
    const ids = targetBodyIds(feature), bodyId = ids[0], body = bodies.get(bodyId);
    const sketch = document.sketches[feature.sketchId], plane = planes.get(feature.sketchId);
    const point = solved.get(feature.sketchId)?.points[feature.centerPointIds[0]];
    if (ids.length !== 1 || !body || failedBodies.has(bodyId) || sketch?.plane.type !== "face" || !plane || !point ||
        faceReferenceBodyId(document, sketch.plane) !== bodyId || bodyComponentId(document, bodyId) !== sketchComponentId(document, feature.sketchId) ||
        featureComponentId(document, feature) !== sketchComponentId(document, feature.sketchId)) continue;
    const diameter = evaluateExpressionRef(feature.diameter, { parameters });
    if (diameter.error || diameter.quantity?.dimension !== "length" || !Number.isFinite(diameter.quantity.value) || diameter.quantity.value <= 0) continue;
    if (++probes > MAX_MACHINED_REFERENCES) return [];
    try {
      const rim = kernel.measureHoleRim(body.shape, transformPoint(plane, point.x, point.y), plane.normal, diameter.quantity.value / 2);
      if (!rim) continue;
      rims.push({ id: `hole:${feature.id}:entrance`, featureId: feature.id, bodyId, label: `${feature.name} — hole entrance rim`, plane: { ...plane, origin: rim.center }, radius: rim.radius });
    } catch {
      // A failed or unsupported probe never publishes a measurable edge.
    }
  }
  // A later fill/redrill can make two authored Hole features match the same
  // current circle. Without distinct native ancestry, neither owns that pick.
  return rims.filter((rim, index) => !rims.some((other, otherIndex) => index !== otherIndex &&
    rim.bodyId === other.bodyId && near(rim.plane.origin, other.plane.origin) &&
    Math.abs(Math.abs(dot(rim.plane.normal, other.plane.normal)) - 1) <= 1e-8 &&
    Math.abs(rim.radius - other.radius) <= Math.max(KERNEL_LINEAR_TOLERANCE, rim.radius * 1e-9, other.radius * 1e-9)));
}
