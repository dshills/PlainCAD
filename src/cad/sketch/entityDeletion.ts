import type { CadDocument, Sketch, SketchEntity, SketchLine } from "../document/schema";
import { RECTANGLE_CENTER_DIAGONAL_PREFIX, RECTANGLE_CENTER_LINK_PREFIX, RECTANGLE_CENTER_POINT_PREFIX } from "./SketchModel";

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

/** Cleanup only generated center helpers; borrowed points keep their authored intent. */
function removeCenterRectangleSupports(
  sketch: Sketch,
  entityIds: Set<string>,
  document: Pick<CadDocument, "features">,
) {
  // Center rectangles use a construction diagonal with a midpoint. Removing
  // every outline edge also removes this support; shared/external centers survive.
  for (const midpoint of sketch.constraints.filter((c) => c.type === "midpoint")) {
    const diagonal = sketch.entities[midpoint.entityIds[0]],
      centerId = midpoint.pointIds?.[0];
    if (diagonal?.type !== "line" || !diagonal.construction || !centerId ||
        !diagonal.id.startsWith(`${RECTANGLE_CENTER_DIAGONAL_PREFIX}_`)) continue;
    const outlines = Object.values(sketch.entities).filter((entity): entity is SketchLine => entity.type === "line" &&
      entity.id !== diagonal.id && entityIds.has(entity.id));
    const adjacent = (id: string) => outlines.filter((line) => line.startPointId === id || line.endPointId === id);
    const fromStart = adjacent(diagonal.startPointId);
    if (fromStart.length !== 2) continue;
    const middleIds = fromStart.map((line) => line.startPointId === diagonal.startPointId ? line.endPointId : line.startPointId);
    const toEnd = middleIds.map((id) => outlines.find((line) =>
      (line.startPointId === id && line.endPointId === diagonal.endPointId) ||
      (line.endPointId === id && line.startPointId === diagonal.endPointId)));
    if (middleIds[0] === middleIds[1] || toEnd.some((line) => !line)) continue;
    const rectangle = [...fromStart, ...toEnd.filter((line): line is SketchLine => Boolean(line))];
    if (new Set(rectangle.map((line) => line.id)).size !== 4 || rectangle.some((line) =>
      !sketch.constraints.some((c) => (c.type === "horizontal" || c.type === "vertical") && c.entityIds.includes(line.id)))) continue;
    if (!entityIds.has(diagonal.id) && [...sketch.constraints, ...sketch.dimensions].some((reference) =>
      reference.id !== midpoint.id && reference.entityIds.includes(diagonal.id))) continue;
    entityIds.add(diagonal.id);
    const center = sketch.entities[centerId];
    const externalReference = Object.values(sketch.entities).some((entity) => !entityIds.has(entity.id) && pointReferences(entity).includes(centerId)) ||
      [...sketch.constraints, ...sketch.dimensions].some((reference) =>
        !(reference.id.startsWith(`${RECTANGLE_CENTER_LINK_PREFIX}_`) && reference.pointIds?.[1] === centerId) &&
        !(reference.type === "fixed" && reference.entityIds.length === 0 &&
          reference.pointIds?.length === 1 && reference.pointIds[0] === centerId) &&
        !reference.entityIds.some((id) => entityIds.has(id)) &&
        [...reference.entityIds, ...(reference.pointIds ?? [])].includes(centerId)) ||
      document.features.some((feature) => feature.type === "hole" && feature.sketchId === sketch.id && feature.centerPointIds.includes(centerId));
    if (center?.type === "point" && center.construction &&
        centerId.startsWith(`${RECTANGLE_CENTER_POINT_PREFIX}_`) && !externalReference) entityIds.add(centerId);
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
  for (const projection of sketch.projections ?? []) {
    const present = projection.members.map((member) => member.targetEntityId).filter((id) => sketch.entities[id]);
    if (!present.some((id) => entityIds.has(id))) continue;
    const curves = present.filter((id) => sketch.entities[id].type !== "point");
    if (!curves.every((id) => entityIds.has(id))) throw new Error("Delete the complete linked projection, or break its link before deleting individual geometry.");
    present.forEach((id) => entityIds.add(id));
  }
  for (const id of entityIds) {
    if (!sketch.entities[id])
      throw new Error("Sketch item was removed. Select a current item.");
  }
  const selectedPoints = new Set(
    [...entityIds].filter((id) => sketch.entities[id].type === "point"),
  );
  for (const candidate of Object.values(sketch.entities)) {
    if (pointReferences(candidate).some((id) => selectedPoints.has(id)))
      entityIds.add(candidate.id);
  }
  removeCenterRectangleSupports(sketch, entityIds, document);
  const referencesDeletedBy =
    (deleted: ReadonlySet<string>) =>
    (reference: { entityIds: string[]; pointIds?: string[] }) =>
      reference.entityIds.some((id) => deleted.has(id)) ||
      reference.pointIds?.some((id) => deleted.has(id)) === true;
  // A helper may outlive its first rectangle when another rectangle borrows it.
  // After the final owned link is removed, clean that generated support too.
  const centerCandidates = new Set(sketch.constraints.filter(referencesDeletedBy(entityIds))
    .flatMap((reference) => [...reference.entityIds, ...(reference.pointIds ?? [])]));
  for (const pointId of centerCandidates) {
    const point = sketch.entities[pointId];
    if (point?.type !== "point" || !point.construction ||
        !point.id.startsWith(`${RECTANGLE_CENTER_POINT_PREFIX}_`) || entityIds.has(point.id)) continue;
    const stillUsed = Object.values(sketch.entities).some((entity) => !entityIds.has(entity.id) && pointReferences(entity).includes(point.id)) ||
      [...sketch.constraints, ...sketch.dimensions].some((reference) =>
        !referencesDeletedBy(entityIds)(reference) &&
        !(reference.type === "fixed" && reference.entityIds.length === 0 &&
          reference.pointIds?.length === 1 && reference.pointIds[0] === point.id) &&
        !(reference.id.startsWith(`${RECTANGLE_CENTER_LINK_PREFIX}_`) && reference.pointIds?.[1] === point.id) &&
        [...reference.entityIds, ...(reference.pointIds ?? [])].includes(point.id)) ||
      document.features.some((feature) => feature.type === "hole" && feature.sketchId === sketch.id && feature.centerPointIds.includes(point.id));
    if (!stillUsed) {
      entityIds.add(point.id);
      for (const reference of sketch.constraints.filter((c) => c.id.startsWith(`${RECTANGLE_CENTER_LINK_PREFIX}_`) && c.pointIds?.includes(point.id)))
        reference.pointIds?.forEach((id) => centerCandidates.add(id));
    }
  }
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
    ...(sketch.projections ? { projections: sketch.projections.filter((p) => !p.members.some((m) => plan.entityIds.has(m.targetEntityId))) } : {}),
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
