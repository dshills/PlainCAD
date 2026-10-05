import type { Sketch, SketchEntity } from "../document/schema";

function pointReferences(entity: SketchEntity): string[] {
  switch (entity.type) {
    case "point":
      return [];
    case "line":
      return [entity.startPointId, entity.endPointId];
    case "circle":
      return [entity.centerPointId];
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId];
  }
}

/** Explicit point deletion cascades to attached curves. Other points keep their IDs. */
export function planSketchEntityDeletion(sketch: Sketch, entityId: string) {
  const entity = sketch.entities[entityId];
  if (!entity)
    throw new Error("Sketch item was removed. Select a current item.");
  const entityIds = new Set([entityId]);
  if (entity.type === "point") {
    for (const candidate of Object.values(sketch.entities)) {
      if (pointReferences(candidate).includes(entityId))
        entityIds.add(candidate.id);
    }
  }
  const referencesDeleted = (reference: {
    entityIds: string[];
    pointIds?: string[];
  }) =>
    reference.entityIds.some((id) => entityIds.has(id)) ||
    reference.pointIds?.some((id) => entityIds.has(id)) === true;
  return {
    entityIds,
    constraintIds: new Set(
      sketch.constraints.filter(referencesDeleted).map((c) => c.id),
    ),
    dimensionIds: new Set(
      sketch.dimensions.filter(referencesDeleted).map((d) => d.id),
    ),
  };
}

export function deleteSketchEntity(sketch: Sketch, entityId: string): Sketch {
  const plan = planSketchEntityDeletion(sketch, entityId);
  return {
    ...sketch,
    entities: Object.fromEntries(
      Object.entries(sketch.entities).filter(([id]) => !plan.entityIds.has(id)),
    ),
    constraints: sketch.constraints.filter(
      (c) => !plan.constraintIds.has(c.id),
    ),
    dimensions: sketch.dimensions.filter((d) => !plan.dimensionIds.has(d.id)),
  };
}
