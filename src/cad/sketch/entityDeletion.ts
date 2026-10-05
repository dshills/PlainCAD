import type { CadDocument, Sketch, SketchEntity } from "../document/schema";

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

/** Remove attached curves and their unused points without sweeping standalone points. */
export function planSketchEntitiesDeletion(
  sketch: Sketch,
  selectedIds: readonly string[],
  document: Pick<CadDocument, "features">,
) {
  if (!selectedIds.length)
    throw new Error("Select sketch geometry before deleting.");
  const entityIds = new Set(selectedIds);
  for (const id of entityIds) {
    if (!sketch.entities[id])
      throw new Error("Sketch item was removed. Select a current item.");
  }
  const selectedPoints = new Set(
    selectedIds.filter((id) => sketch.entities[id].type === "point"),
  );
  for (const candidate of Object.values(sketch.entities)) {
    if (pointReferences(candidate).some((id) => selectedPoints.has(id)))
      entityIds.add(candidate.id);
  }
  const referencesDeletedBy =
    (deleted: ReadonlySet<string>) =>
    (reference: { entityIds: string[]; pointIds?: string[] }) =>
      reference.entityIds.some((id) => deleted.has(id)) ||
      reference.pointIds?.some((id) => deleted.has(id)) === true;
  // Determine surviving references before adding candidate orphan points.
  const initiallyDeleted = new Set(entityIds);
  const referencesInitiallyDeleted = referencesDeletedBy(initiallyDeleted);
  const retainedPointIds = new Set<string>();
  for (const candidate of Object.values(sketch.entities)) {
    if (!entityIds.has(candidate.id))
      pointReferences(candidate).forEach((id) => retainedPointIds.add(id));
  }
  for (const reference of [...sketch.constraints, ...sketch.dimensions]) {
    if (!referencesInitiallyDeleted(reference)) {
      [...reference.entityIds, ...(reference.pointIds ?? [])].forEach((id) =>
        retainedPointIds.add(id),
      );
    }
  }
  for (const feature of document.features) {
    if (feature.type === "hole" && feature.sketchId === sketch.id)
      feature.centerPointIds.forEach((id) => retainedPointIds.add(id));
  }
  // Only points belonging to removed curves are candidates for automatic cleanup.
  for (const id of [...entityIds]) {
    for (const pointId of pointReferences(sketch.entities[id])) {
      if (
        sketch.entities[pointId]?.type === "point" &&
        !retainedPointIds.has(pointId)
      )
        entityIds.add(pointId);
    }
  }
  const referencesDeleted = referencesDeletedBy(entityIds);
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

export function deleteSketchEntities(
  sketch: Sketch,
  entityIds: readonly string[],
  document: Pick<CadDocument, "features">,
): Sketch {
  const plan = planSketchEntitiesDeletion(sketch, entityIds, document);
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

export function planSketchEntityDeletion(
  sketch: Sketch,
  entityId: string,
  document: Pick<CadDocument, "features">,
) {
  return planSketchEntitiesDeletion(sketch, [entityId], document);
}
export function deleteSketchEntity(
  sketch: Sketch,
  entityId: string,
  document: Pick<CadDocument, "features">,
): Sketch {
  return deleteSketchEntities(sketch, [entityId], document);
}
