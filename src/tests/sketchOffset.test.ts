import { expect, it } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addArc, addCircleAt, addCornerRectangle, addLine, addPoint, createSketchOnPlane, createXySketch } from "../cad/sketch/SketchModel";
import { addCanvasGeometry } from "../cad/sketch/canvasGeometry";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { buildSketchOffset, sketchOffsetProfiles } from "../cad/sketch/sketchOffset";
import { serializeProject } from "../persistence/exportProject";
function fixture(circle = false) {
  const sketch = circle ? addCircleAt(createXySketch("Circle"), "0mm", "0mm", "10mm") : addCornerRectangle(createXySketch("Rectangle"), "24mm", "16mm");
  const document = upsertSketch(createEmptyDocument(), sketch), profiles = detectProfiles(solveSketch(sketch, {})).profiles;
  return { document, sketch, profile: profiles[0] };
}
it("creates real outward/inward convex closed contours without modifying source IDs or intent", () => {
  const { document, sketch, profile } = fixture();
  for (const direction of ["outward", "inward"] as const) {
    const plan = buildSketchOffset(document, sketch.id, profile.id, { direction, distance: "2mm", holes: "reject" });
    expect(plan.copiedEntityIds).toHaveLength(8);
    expect(plan.base).toBe(document);
    for (const [id, entity] of Object.entries(sketch.entities)) expect(plan.document.sketches[sketch.id].entities[id]).toEqual(entity);
    expect(plan.document.sketches[sketch.id].constraints).toEqual(sketch.constraints);
    expect(plan.document.sketches[sketch.id].dimensions).toEqual(sketch.dimensions);
    const profiles = detectProfiles(solveSketch(plan.document.sketches[sketch.id], {})).profiles;
    expect(profiles).toHaveLength(1); expect(profiles[0].innerLoops).toHaveLength(1);
    expect(profiles[0].bounds).toEqual(direction === "outward" ? { minX: -2, maxX: 26, minY: -2, maxY: 18 } : { minX: 0, maxX: 24, minY: 0, maxY: 16 });
    expect(JSON.parse(serializeProject(plan.document)).sketches[sketch.id]).toEqual(plan.document.sketches[sketch.id]);
  }
});
it("keeps circle radius and distance parameter bindings editable and naturally diagnoses a collapsed inward radius", () => {
  const { document, sketch, profile } = fixture(true);
  const source = Object.values(sketch.entities).find((entity) => entity.type === "circle")!;
  const base = upsertSketch({ ...document, parameters: {
    radius: { id: "radius_parameter", name: "radius", expression: "10mm", value: 10, unit: "mm" },
    wall: { id: "wall_parameter", name: "wall", expression: "2mm", value: 2, unit: "mm" },
  } }, { ...sketch, entities: { ...sketch.entities, [source.id]: { ...source, radius: { expression: "radius", unit: "mm" } } } });
  const plan = buildSketchOffset(base, sketch.id, profile.id, { direction: "inward", distance: "wall", holes: "reject" });
  const circle = Object.values(plan.document.sketches[sketch.id].entities).find((entity) => entity.type === "circle" && entity.id !== source.id)!;
  if (circle.type !== "circle") throw new Error("Missing copied circle");
  expect(circle.radius.parameterRefs).toMatchObject({ radius: "radius_parameter", wall: "wall_parameter" });
  const edited = { ...plan.document, parameters: { ...plan.document.parameters, wall: { ...plan.document.parameters.wall, expression: "3mm" } } };
  expect(solveSketch(edited.sketches[sketch.id], evaluateParameters(edited.parameters).values).circles.find((item) => item.id === circle.id)?.radius).toBeCloseTo(7, 8);
  const collapsed = { ...edited, parameters: { ...edited.parameters, wall: { ...edited.parameters.wall, expression: "11mm" } } };
  expect(solveSketch(collapsed.sketches[sketch.id], evaluateParameters(collapsed.parameters).values).errors.some((error) => error.severity === "error")).toBe(true);
});
it("supports concave miter contours and rejects collapsed copies", () => {
  const { document, sketch, profile } = fixture();
  expect(() => buildSketchOffset(document, sketch.id, profile.id, { direction: "inward", distance: "8mm", holes: "reject" })).toThrow(/collapses|self-intersect/);
  const base = createXySketch("Concave");
  let next = base;
  const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 20 }, { x: 0, y: 20 }];
  for (let index = 0; index < points.length; index++) next = addCanvasGeometry(next, solveSketch(next, {}), "line", [points[index], points[(index + 1) % points.length]]).sketch;
  const source = upsertSketch(createEmptyDocument(), next), chosen = detectProfiles(solveSketch(next, {})).profiles[0];
  for (const direction of ["inward", "outward"] as const) {
    const plan = buildSketchOffset(source, next.id, chosen.id, { direction, distance: "1mm", holes: "reject" });
    const copied = solveSketch(plan.document.sketches[next.id], {}).lines.filter((line) => plan.copiedEntityIds.includes(line.id));
    expect(copied.map((line) => [line.start.x, line.start.y]).sort()).toEqual((direction === "outward" ? [[-1, -1], [21, -1], [21, 6], [6, 6], [6, 21], [-1, 21]] : [[1, 1], [19, 1], [19, 4], [4, 4], [4, 19], [1, 19]]).sort());
    expect(detectProfiles(solveSketch(plan.document.sketches[next.id], {})).profiles[0].innerLoops).toHaveLength(1);
  }
  expect(() => buildSketchOffset(source, next.id, chosen.id, { direction: "inward", distance: "3mm", holes: "reject" })).toThrow(/collapses|self-intersect/);
});
it("diagnoses an unrelated open analytic arc while preserving construction arcs", () => {
  const { document, sketch, profile } = fixture();
  const center = addPoint(sketch, "50mm", "0mm"), start = addPoint(center.sketch, "60mm", "0mm"), end = addPoint(start.sketch, "50mm", "10mm");
  const arc = addArc(end.sketch, center.pointId, start.pointId, end.pointId);
  expect(() => sketchOffsetProfiles(upsertSketch(document, arc.sketch), sketch.id)).toThrow(/Repair sketch/);
  const construction = { ...arc.sketch, entities: { ...arc.sketch.entities, [arc.arcId]: { ...arc.sketch.entities[arc.arcId], construction: true } } };
  const plan = buildSketchOffset(upsertSketch(document, construction), sketch.id, profile.id, { direction: "outward", distance: "2mm", holes: "reject" });
  expect(plan.document.sketches[sketch.id].entities[arc.arcId]).toEqual(construction.entities[arc.arcId]);
});
it("offsets a clockwise authored polygon and retains original dimension/constraint intent", () => {
  let sketch = createXySketch("Clockwise");
  const points = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 0 }];
  for (let index = 0; index < points.length; index++) sketch = addCanvasGeometry(sketch, solveSketch(sketch, {}), "line", [points[index], points[(index + 1) % points.length]]).sketch;
  const first = Object.values(sketch.entities).find((entity) => entity.type === "line")!;
  sketch = { ...sketch, constraints: [{ id: "vertical_constraint", type: "vertical", entityIds: [first.id], pointIds: [] }], dimensions: [{ id: "height_dimension", type: "length", entityIds: [first.id], expression: { expression: "10mm", unit: "mm" } }] };
  const document = upsertSketch(createEmptyDocument(), sketch), profile = sketchOffsetProfiles(document, sketch.id).profiles[0];
  const plan = buildSketchOffset(document, sketch.id, profile.id, { direction: "outward", distance: "2mm", holes: "reject" });
  expect(sketchOffsetProfiles(plan.document, sketch.id).profiles[0].bounds).toEqual({ minX: -2, maxX: 22, minY: -2, maxY: 12 });
  expect(plan.document.sketches[sketch.id].constraints).toEqual(sketch.constraints);
  expect(plan.document.sketches[sketch.id].dimensions).toEqual(sketch.dimensions);
});
it("requires explicit holes policy and preserves every existing hole", () => {
  const { document, sketch } = fixture();
  const holed = addCircleAt(sketch, "12mm", "8mm", "2mm"), source = upsertSketch(document, holed);
  const profile = detectProfiles(solveSketch(holed, {})).profiles[0];
  expect(() => buildSketchOffset(source, sketch.id, profile.id, { direction: "outward", distance: "2mm", holes: "reject" })).toThrow(/contains holes/);
  const plan = buildSketchOffset(source, sketch.id, profile.id, { direction: "outward", distance: "2mm", holes: "outerOnly" });
  for (const [id, entity] of Object.entries(holed.entities)) expect(plan.document.sketches[sketch.id].entities[id]).toEqual(entity);
  expect(plan.changes.join(" ")).toContain("Existing holes retain");
});
it("rejects parameter-bound polygon distance and collisions with nearby geometry", () => {
  const { document, sketch, profile } = fixture();
  const parameterized = { ...document, parameters: { wall: { id: "wall_parameter", name: "wall", expression: "2mm", value: 2, unit: "mm" } } };
  expect(() => buildSketchOffset(parameterized, sketch.id, profile.id, { direction: "outward", distance: "wall", holes: "reject" })).toThrow(/literal length/);
  const nearby = addCanvasGeometry(sketch, solveSketch(sketch, {}), "rectangle", [{ x: 25, y: 5 }, { x: 35, y: 10 }]).sketch;
  const source = upsertSketch(document, nearby), chosen = detectProfiles(solveSketch(nearby, {})).profiles.find((item) => item.bounds.minX === 0)!;
  expect(() => buildSketchOffset(source, sketch.id, chosen.id, { direction: "outward", distance: "2mm", holes: "reject" })).toThrow(/intersects/);
});
it("accepts literal arithmetic and project bare-length units while preserving canonical geometry", () => {
  const { document, sketch, profile } = fixture();
  const plan = buildSketchOffset({ ...document, unitSettings: { ...document.unitSettings, length: "cm" } }, sketch.id, profile.id, { direction: "outward", distance: "0.2", holes: "reject" });
  expect(detectProfiles(solveSketch(plan.document.sketches[sketch.id], {})).profiles[0].bounds.minX).toBeCloseTo(-2, 12);
  const arithmetic = buildSketchOffset(document, sketch.id, profile.id, { direction: "outward", distance: "1mm + 1mm", holes: "reject" });
  expect(detectProfiles(solveSketch(arithmetic.document.sketches[sketch.id], {})).profiles[0].bounds.minX).toBeCloseTo(-2, 12);
  expect(() => buildSketchOffset(document, sketch.id, profile.id, { direction: "outward", distance: "-1mm", holes: "reject" })).toThrow(/positive/);
});
it("qualifies scalar parameter radius and distance with their authored units before combining them", () => {
  const { document, sketch, profile } = fixture(true);
  const source = Object.values(sketch.entities).find((entity) => entity.type === "circle")!;
  const base = upsertSketch({ ...document, unitSettings: { ...document.unitSettings, length: "cm" }, parameters: {
    count: { id: "count_parameter", name: "count", expression: "10", value: 10, unit: "" },
    gap: { id: "gap_parameter", name: "gap", expression: "2", value: 2, unit: "" },
  } }, { ...sketch, entities: { ...sketch.entities, [source.id]: { ...source, radius: { expression: "count", authoredUnit: "cm", unit: "cm" } } } });
  const plan = buildSketchOffset(base, sketch.id, profile.id, { direction: "outward", distance: "gap", holes: "reject" });
  const circle = Object.values(plan.document.sketches[sketch.id].entities).find((entity) => entity.type === "circle" && entity.id !== source.id)!;
  if (circle.type !== "circle") throw new Error("Missing copied circle");
  expect(circle.radius.parameterRefs).toMatchObject({ count: "count_parameter", gap: "gap_parameter" });
  expect(solveSketch(plan.document.sketches[sketch.id], evaluateParameters(plan.document.parameters).values).circles.find((item) => item.id === circle.id)?.radius).toBeCloseTo(120, 8);
  const edited = { ...plan.document, parameters: { ...plan.document.parameters, gap: { ...plan.document.parameters.gap, expression: "3" } } };
  expect(solveSketch(edited.sketches[sketch.id], evaluateParameters(edited.parameters).values).circles.find((item) => item.id === circle.id)?.radius).toBeCloseTo(130, 8);
});
it("writes tiny numeric coordinates as parser-supported decimal literals", () => {
  const { document, sketch, profile } = fixture(true);
  const center = Object.values(sketch.entities).find((entity) => entity.type === "point")!;
  const source = upsertSketch(document, { ...sketch, entities: { ...sketch.entities, [center.id]: { ...center, x: { expression: "0.000000000000001", authoredUnit: "mm", unit: "mm" } } } });
  const plan = buildSketchOffset(source, sketch.id, profile.id, { direction: "outward", distance: "2mm", holes: "reject" });
  const copy = Object.values(plan.document.sketches[sketch.id].entities).find((entity) => entity.type === "point" && entity.id !== center.id)!;
  if (copy.type !== "point") throw new Error("Missing copied point");
  expect(copy.x.expression).not.toMatch(/e[+-]\d/);
  expect(solveSketch(plan.document.sketches[sketch.id], {}).errors.filter((error) => error.severity === "error")).toEqual([]);
});

function capsule(plane: "XY" | "XZ" | "YZ", clockwise = false) {
  let sketch = createSketchOnPlane("Analytic capsule", plane);
  const ids: string[] = [];
  for (const [x, y] of [[-10, -5], [10, -5], [10, 5], [-10, 5], [10, 0], [-10, 0]]) {
    const added = addPoint(sketch, `${x}mm`, `${y}mm`); sketch = added.sketch; ids.push(added.pointId);
  }
  sketch = addLine(sketch, clockwise ? ids[1] : ids[0], clockwise ? ids[0] : ids[1]).sketch;
  sketch = addArc(sketch, ids[4], clockwise ? ids[2] : ids[1], clockwise ? ids[1] : ids[2], clockwise).sketch;
  sketch = addLine(sketch, clockwise ? ids[3] : ids[2], clockwise ? ids[2] : ids[3]).sketch;
  sketch = addArc(sketch, ids[5], clockwise ? ids[0] : ids[3], clockwise ? ids[3] : ids[0], clockwise).sketch;
  return sketch;
}
it("copies analytic mixed contours in every principal plane and preserves exact circular supports, source intent and file round trips", () => {
  for (const plane of ["XY", "XZ", "YZ"] as const) for (const clockwise of [false, true]) for (const direction of ["inward", "outward"] as const) {
    const sketch = capsule(plane, clockwise), document = upsertSketch(createEmptyDocument(), sketch);
    const profile = sketchOffsetProfiles(document, sketch.id).profiles[0];
    const plan = buildSketchOffset(document, sketch.id, profile.id, { direction, distance: "1mm", holes: "reject" });
    const solved = solveSketch(plan.document.sketches[sketch.id], {});
    const arcs = solved.arcs.filter((arc) => plan.copiedEntityIds.includes(arc.id));
    expect(arcs).toHaveLength(2); expect(plan.copiedEntityIds).toHaveLength(10);
    for (const arc of arcs) {
      expect(arc.radius).toBeCloseTo(direction === "outward" ? 6 : 4, 12);
      expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI, 12);
      expect(arc.center.y).toBeCloseTo(0, 12); expect(Math.abs(arc.center.x)).toBeCloseTo(10, 12);
    }
    expect(solved.lines.filter((line) => plan.copiedEntityIds.includes(line.id))).toHaveLength(2);
    expect(detectProfiles(solved).profiles[0].innerLoops).toHaveLength(1);
    expect(plan.document.sketches[sketch.id].plane).toEqual(sketch.plane);
    for (const [id, entity] of Object.entries(sketch.entities)) expect(plan.document.sketches[sketch.id].entities[id]).toEqual(entity);
    expect(JSON.parse(serializeProject(plan.document)).sketches[sketch.id]).toEqual(plan.document.sketches[sketch.id]);
  }
});
it("diagnoses collapsed analytic radii and nonsmooth arc corners without adding approximate geometry", () => {
  const sketch = capsule("XY"), document = upsertSketch(createEmptyDocument(), sketch), profile = sketchOffsetProfiles(document, sketch.id).profiles[0];
  expect(() => buildSketchOffset(document, sketch.id, profile.id, { direction: "inward", distance: "5mm", holes: "reject" })).toThrow(/arc radius/);
  let nonsmooth = createXySketch("Semicircle");
  const a = addPoint(nonsmooth, "0mm", "-5mm"), b = addPoint(a.sketch, "0mm", "5mm"), center = addPoint(b.sketch, "0mm", "0mm");
  nonsmooth = addArc(center.sketch, center.pointId, a.pointId, b.pointId).sketch;
  nonsmooth = addLine(nonsmooth, b.pointId, a.pointId).sketch;
  const other = upsertSketch(createEmptyDocument(), nonsmooth), chosen = sketchOffsetProfiles(other, nonsmooth.id).profiles[0];
  expect(() => buildSketchOffset(other, nonsmooth.id, chosen.id, { direction: "outward", distance: "1mm", holes: "reject" })).toThrow(/tangent joins/);
});
it("ignores an intersecting construction arc and rejects the same disconnected authored arc", () => {
  const { document, sketch, profile } = fixture();
  const a = addPoint(sketch, "26mm", "0mm"), b = addPoint(a.sketch, "26mm", "16mm"), center = addPoint(b.sketch, "26mm", "8mm");
  const arc = addArc(center.sketch, center.pointId, b.pointId, a.pointId).sketch;
  const construction = { ...arc, entities: { ...arc.entities, [Object.values(arc.entities).find((entity) => entity.type === "arc")!.id]: { ...Object.values(arc.entities).find((entity) => entity.type === "arc")!, construction: true } } };
  // Construction arc is ignored; authored disconnected arc remains an explicit invalid sketch.
  expect(buildSketchOffset(upsertSketch(document, construction), sketch.id, profile.id, { direction: "outward", distance: "2mm", holes: "reject" }).copiedEntityIds).toHaveLength(8);
  expect(() => sketchOffsetProfiles(upsertSketch(document, arc), sketch.id)).toThrow(/Repair sketch/);
});
it("rejects contacts with a separate authored analytic arc loop using finite curves", () => {
  const { document, sketch } = fixture(), extra = capsule("XY"), solved = solveSketch(extra, {});
  const translated = Object.fromEntries(Object.entries(extra.entities).map(([id, entity]) => [id, entity.type === "point" ? { ...entity, x: { expression: `${solved.points[id].x + 40}mm`, authoredUnit: "mm" as const, unit: "mm" as const }, y: { expression: `${solved.points[id].y + 8}mm`, authoredUnit: "mm" as const, unit: "mm" as const } } : entity]));
  const combined = { ...sketch, entities: { ...sketch.entities, ...translated } }, source = upsertSketch(document, combined);
  const chosen = sketchOffsetProfiles(source, sketch.id).profiles.find((profile) => profile.bounds.minX === 0)!;
  expect(() => buildSketchOffset(source, sketch.id, chosen.id, { direction: "outward", distance: "2mm", holes: "reject" })).toThrow(/intersects or touches/);
  expect(buildSketchOffset(source, sketch.id, chosen.id, { direction: "outward", distance: "0.5mm", holes: "reject" }).copiedEntityIds).toHaveLength(8);
});
it("retains tangent joins between two whole analytic arcs sharing a circular support", () => {
  const center = addPoint(createXySketch("Two arc circle"), "0mm", "0mm"), a = addPoint(center.sketch, "5mm", "0mm"), b = addPoint(a.sketch, "-5mm", "0mm");
  let sketch = addArc(b.sketch, center.pointId, a.pointId, b.pointId).sketch;
  sketch = addArc(sketch, center.pointId, b.pointId, a.pointId).sketch;
  const document = upsertSketch(createEmptyDocument(), sketch), profile = sketchOffsetProfiles(document, sketch.id).profiles[0];
  const plan = buildSketchOffset(document, sketch.id, profile.id, { direction: "outward", distance: "1mm", holes: "reject" });
  expect(solveSketch(plan.document.sketches[sketch.id], {}).arcs.filter((arc) => plan.copiedEntityIds.includes(arc.id)).map((arc) => arc.radius)).toEqual([6, 6]);
  expect(sketchOffsetProfiles(plan.document, sketch.id).profiles[0].innerLoops).toHaveLength(1);
});
