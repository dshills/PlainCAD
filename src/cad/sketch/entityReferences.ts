import type { Sketch, SketchEntity } from "../document/schema";

export type SketchPointReferenceField =
  "centerPointId" | "startPointId" | "endPointId";
export interface SketchPointReference {
  field: SketchPointReferenceField;
  label: string;
  pointId: string;
}
export function sketchPointReferences(
  entity: SketchEntity,
): SketchPointReference[] {
  const refs: SketchPointReference[] = [];
  if (entity.type === "circle" || entity.type === "arc")
    refs.push({
      field: "centerPointId",
      label: "Center point",
      pointId: entity.centerPointId,
    });
  if (entity.type === "line" || entity.type === "arc")
    refs.push(
      {
        field: "startPointId",
        label: "Start point",
        pointId: entity.startPointId,
      },
      { field: "endPointId", label: "End point", pointId: entity.endPointId },
    );
  return refs;
}
// Geometry validation stays in the solver/rebuild so invalid edits remain visible and undoable.
export function replaceSketchPointReference(
  sketch: Sketch,
  entityId: string,
  field: SketchPointReferenceField,
  pointId: string,
): Sketch {
  const entity = sketch.entities[entityId];
  if (
    !entity ||
    sketch.entities[pointId]?.type !== "point" ||
    !sketchPointReferences(entity).some(
      (ref) => ref.field === field && ref.pointId !== pointId,
    )
  )
    return sketch;
  return {
    ...sketch,
    entities: {
      ...sketch.entities,
      [entityId]: { ...entity, [field]: pointId },
    },
  };
}
export function setArcDirection(
  sketch: Sketch,
  entityId: string,
  clockwise: boolean,
): Sketch {
  const entity = sketch.entities[entityId];
  if (entity?.type !== "arc" || entity.clockwise === clockwise) return sketch;
  return {
    ...sketch,
    entities: { ...sketch.entities, [entityId]: { ...entity, clockwise } },
  };
}
