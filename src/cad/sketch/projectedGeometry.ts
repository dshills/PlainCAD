import type { Sketch } from "../document/schema";

export function projectedGeometryOwner(sketch: Sketch, entityId: string) {
  return sketch.projections?.find((projection) => projection.members.some((member) => member.targetEntityId === entityId));
}
export function assertEditableGeometry(sketch: Sketch, ids: readonly string[]) {
  if (ids.some((id) => projectedGeometryOwner(sketch, id)))
    throw new Error("Projected geometry follows its source. Edit the source, break its link, or delete the complete projection.");
}
