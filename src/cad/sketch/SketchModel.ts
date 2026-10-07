import { assertEditableGeometry } from "./projectedGeometry";
import { ConstraintType, ExpressionRef, OriginPlane, Sketch, SketchPlaneReference } from "../document/schema";
import { createId } from "../document/ids";
import { originPlaneRef } from "./planes";

export function expressionRef(expression: string, unit = "mm"): ExpressionRef {
  return { expression, unit };
}

export function createXySketch(name = "Sketch"): Sketch {
  return createSketchOnPlane(name, "XY");
}

export function createSketchOnPlane(
  name = "Sketch",
  plane: OriginPlane | SketchPlaneReference = "XY",
): Sketch {
  return {
    id: createId("sketch"),
    name,
    plane: typeof plane === "string" ? originPlaneRef(plane) : plane,
    createdAt: new Date().toISOString(),
    entities: {},
    constraints: [],
    dimensions: [],
    solveMode: "driving",
  };
}

/** Reserved generated-center namespace. Persist IDs unchanged: deletion uses this
 * provenance plus construction/midpoint topology to preserve borrowed sketch points.
 * createId writes the prefix followed by an underscore; both helpers reserve that format. */
export const RECTANGLE_CENTER_POINT_PREFIX = "rectangleCenter";
export const RECTANGLE_CENTER_LINK_PREFIX = "rectangleCenterLink";
export const RECTANGLE_CENTER_DIAGONAL_PREFIX = "rectangleCenterDiagonal";

export function addPoint(sketch: Sketch, x: string, y: string, idPrefix = "point"): { sketch: Sketch; pointId: string } {
  const pointId = createId(idPrefix);
  return {
    pointId,
    sketch: {
      ...sketch,
      entities: {
        ...sketch.entities,
        [pointId]: { id: pointId, type: "point", x: expressionRef(x), y: expressionRef(y) },
      },
    },
  };
}

export function addLine(sketch: Sketch, startPointId: string, endPointId: string, idPrefix = "line"): { sketch: Sketch; lineId: string } {
  const lineId = createId(idPrefix);
  return {
    lineId,
    sketch: {
      ...sketch,
      entities: { ...sketch.entities, [lineId]: { id: lineId, type: "line", startPointId, endPointId } },
    },
  };
}

export function addCircle(sketch: Sketch, centerPointId: string, radiusExpression: string): { sketch: Sketch; circleId: string } {
  const circleId = createId("circle");
  return {
    circleId,
    sketch: {
      ...sketch,
      entities: {
        ...sketch.entities,
        [circleId]: { id: circleId, type: "circle", centerPointId, radius: expressionRef(radiusExpression) },
      },
    },
  };
}

export function addCenterRectangle(sketch: Sketch, width: string, height: string): Sketch {
  let next = sketch;
  const p1 = addPoint(next, `-(${width}) / 2`, `-(${height}) / 2`);
  next = p1.sketch;
  const p2 = addPoint(next, `(${width}) / 2`, `-(${height}) / 2`);
  next = p2.sketch;
  const p3 = addPoint(next, `(${width}) / 2`, `(${height}) / 2`);
  next = p3.sketch;
  const p4 = addPoint(next, `-(${width}) / 2`, `(${height}) / 2`);
  next = p4.sketch;
  next = addLine(next, p1.pointId, p2.pointId).sketch;
  next = addLine(next, p2.pointId, p3.pointId).sketch;
  next = addLine(next, p3.pointId, p4.pointId).sketch;
  next = addLine(next, p4.pointId, p1.pointId).sketch;
  return next;
}

export function addCornerRectangle(sketch: Sketch, width: string, height: string): Sketch {
  let next = sketch;
  const p1 = addPoint(next, "0mm", "0mm");
  next = p1.sketch;
  const p2 = addPoint(next, width, "0mm");
  next = p2.sketch;
  const p3 = addPoint(next, width, height);
  next = p3.sketch;
  const p4 = addPoint(next, "0mm", height);
  next = p4.sketch;
  next = addLine(next, p1.pointId, p2.pointId).sketch;
  next = addLine(next, p2.pointId, p3.pointId).sketch;
  next = addLine(next, p3.pointId, p4.pointId).sketch;
  next = addLine(next, p4.pointId, p1.pointId).sketch;
  return next;
}

export function addCircleAt(sketch: Sketch, x: string, y: string, radius: string): Sketch {
  const center = addPoint(sketch, x, y);
  return addCircle(center.sketch, center.pointId, radius).sketch;
}

export function addConstraint(
  sketch: Sketch,
  type: ConstraintType,
  input: { entityIds?: string[]; pointIds?: string[] },
): Sketch {
  assertEditableGeometry(sketch, [...(input.entityIds ?? []), ...(input.pointIds ?? [])]);
  return {
    ...sketch,
    constraints: [
      ...sketch.constraints,
      {
        id: createId("constraint"),
        type,
        entityIds: input.entityIds ?? [],
        pointIds: input.pointIds ?? [],
      },
    ],
  };
}

export function addArc(
  sketch: Sketch,
  centerPointId: string,
  startPointId: string,
  endPointId: string,
  clockwise = false,
): { sketch: Sketch; arcId: string } {
  const arcId = createId("arc");
  return {
    arcId,
    sketch: {
      ...sketch,
      entities: {
        ...sketch.entities,
        [arcId]: {
          id: arcId,
          type: "arc",
          centerPointId,
          startPointId,
          endPointId,
          clockwise,
        },
      },
    },
  };
}

export function setConstruction(
  sketch: Sketch,
  entityId: string,
  construction: boolean,
): Sketch {
  assertEditableGeometry(sketch, [entityId]);
  const entity = sketch.entities[entityId];
  return entity
    ? {
        ...sketch,
        entities: {
          ...sketch.entities,
          [entityId]: { ...entity, construction },
        },
      }
    : sketch;
}
