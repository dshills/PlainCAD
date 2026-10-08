import { expect, it } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { createBoxMesh, computeNormals } from "../cad/kernel/meshConversion";
import { assertDrawingMesh, drawingSection, drawingTolerance, DRAWING_VIEWS, orthographicSvg, projectDrawingPoint } from "../cad/inspection/drawingGeometry";
import { buildShopDrawing, escapeDrawingText } from "../cad/inspection/shopDrawing";
import type { RebuildResult } from "../cad/worker/workerProtocol";
const rectangle = { x: 0, y: 0, width: 400, height: 300 };
function source() { const document = createEmptyDocument("Drawing project"), mesh = { ...createBoxMesh("body:box", 20, 10, 5), geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 1000, surfaceArea: 700, solidCount: 1 } }; const result: RebuildResult = { documentId: document.id, success: true, bodies: [{ id: mesh.bodyId, name: '=danger("x") <script>' }], meshes: [mesh], errors: [], warnings: [], durationMs: 0, nativeDrawingGeometry: { bounds: mesh.bounds, bores: [], warnings: [] } }; return { document, mesh, result }; }
it("projects CAD axes with consistent top, front and right orientation", () => {
  const { mesh } = source(), origin = projectDrawingPoint([0, 0, 0], mesh.bounds, DRAWING_VIEWS.top, rectangle), x = projectDrawingPoint([1, 0, 0], mesh.bounds, DRAWING_VIEWS.top, rectangle), y = projectDrawingPoint([0, 1, 0], mesh.bounds, DRAWING_VIEWS.top, rectangle);
  expect(x[0]).toBeGreaterThan(origin[0]); expect(y[1]).toBeLessThan(origin[1]);
  const front = projectDrawingPoint([0, 0, 0], mesh.bounds, DRAWING_VIEWS.front, rectangle); expect(projectDrawingPoint([0, 0, 1], mesh.bounds, DRAWING_VIEWS.front, rectangle)[1]).toBeLessThan(front[1]); expect(projectDrawingPoint([0, 1, 0], mesh.bounds, DRAWING_VIEWS.front, rectangle)[2]).toBe(-1);
  const right = projectDrawingPoint([0, 0, 0], mesh.bounds, DRAWING_VIEWS.right, rectangle); expect(projectDrawingPoint([0, 1, 0], mesh.bounds, DRAWING_VIEWS.right, rectangle)[0]).toBeGreaterThan(right[0]); expect(projectDrawingPoint([1, 0, 0], mesh.bounds, DRAWING_VIEWS.right, rectangle)[2]).toBe(1);
});
it("traces closed sections and subtracts nested inner contours instead of filling holes", () => {
  const { mesh } = source(); expect(drawingSection(mesh, mesh.bounds, 2.5).area).toBe(200);
  const inner = createBoxMesh("inner", 4, 2, 5), positions = [...Array.from(mesh.positions), ...Array.from(inner.positions)], indices = [...mesh.indices, ...inner.indices.map((index, position, array) => mesh.positions.length / 3 + (position % 3 === 0 ? index : position % 3 === 1 ? array[position + 1] : array[position - 1]))];
  const hollow = { ...mesh, positions, indices, normals: computeNormals(positions, indices) }, section = drawingSection(hollow, mesh.bounds, 2.5); expect(section.loops).toHaveLength(2); expect(section.area).toBe(192);
  expect(() => drawingSection(mesh, mesh.bounds, 100)).toThrow(/strictly between/);
});
it("uses current native measurements, escapes SVG text and protects CSV formulas", () => {
  const { document, result } = source(), drawing = buildShopDrawing(document, result, "body:box");
  expect(drawing.dimensions).toEqual([20, 10, 5]); expect(drawing.sectionAreaMm2).toBe(200); expect(drawing.bores).toEqual([]); expect(drawing.bom).toMatchObject([{ quantity: 1, volumeMm3: 1000 }]);
  expect(drawing.svg).toContain("X 20.000 mm"); expect(drawing.svg).not.toContain("<script>"); expect(drawing.bomCsv).toContain('"\'=danger'); expect(escapeDrawingText('"<&')).toBe("&quot;&lt;&amp;");
  expect(() => buildShopDrawing(document, { ...result, nativeDrawingGeometry: undefined }, "body:box")).toThrow(/native/);
  expect(() => buildShopDrawing(document, { ...result, meshes: [{ ...result.meshes[0], geometrySource: "fallback" }] }, "body:box")).toThrow(/native/);
});
it("rejects malformed and excessive mesh data before producing an illustrative view", () => {
  const { mesh } = source(); expect(() => assertDrawingMesh({ ...mesh, indices: Array(60003).fill(0) })).toThrow(/20,000/); expect(() => assertDrawingMesh({ ...mesh, indices: [0, 1, 99999] })).toThrow(/indices/);
  expect(() => assertDrawingMesh({ ...mesh, positions: [NaN, ...Array.from(mesh.positions).slice(1)] })).toThrow(/coordinates/);
  expect(orthographicSvg(mesh, mesh.bounds, DRAWING_VIEWS.top, rectangle)).toMatch(/<path d="M.+L/);
  expect(() => orthographicSvg({ ...mesh, indices: [0, 1, 99999] }, mesh.bounds, DRAWING_VIEWS.top, rectangle)).toThrow(/indices/);
  expect(() => drawingSection({ ...mesh, positions: [NaN, ...Array.from(mesh.positions).slice(1)] }, mesh.bounds, 2.5)).toThrow(/coordinates/);
});
it("keeps the complete visible outline of a steep face despite pixel-centre depth differences", () => {
  const { mesh } = source(), bounds = { min: [0, 0, 0] as [number, number, number], max: [100, 100, 10] as [number, number, number] };
  const positions = [20, 20, 0, 24, 20, 10, 24, 80, 10], indices = [0, 1, 2];
  const steep = { ...mesh, positions, indices, normals: computeNormals(positions, indices), bounds };
  const svg = orthographicSvg(steep, bounds, DRAWING_VIEWS.top, rectangle), a = projectDrawingPoint([20, 20, 0], bounds, DRAWING_VIEWS.top, rectangle), b = projectDrawingPoint([24, 20, 10], bounds, DRAWING_VIEWS.top, rectangle);
  const segments = [...svg.matchAll(/M\s*([-+.\deE]+)[,\s]+([-+.\deE]+)\s*L\s*([-+.\deE]+)[,\s]+([-+.\deE]+)/g)].map(match => match.slice(1).map(Number));
  expect(segments.length, "The SVG outline must contain measurable line segments").toBeGreaterThan(0);
  const near = (x: number, y: number, point: readonly number[]) => Math.hypot(x - point[0], y - point[1]) < 0.02;
  expect(segments.some(([x1, y1, x2, y2]) => (near(x1, y1, a) && near(x2, y2, b)) || (near(x1, y1, b) && near(x2, y2, a)))).toBe(true);
});
it("closes sections when coincident triangle endpoints straddle a welding cell boundary", () => {
  const { mesh } = source(), tolerance = drawingTolerance(mesh.bounds);
  expect(drawingSection(mesh, mesh.bounds, 2.5).area).toBeCloseTo(200, 5);
  for (const boundary of [0, 0.5]) {
    const positions = mesh.indices.flatMap((index, vertex) => {
      // Integer-mm box corners already lie on this fixture's 1 µm grid.
      // Snapping preserves its width; the common offset translates the box.
      const x = Math.round(mesh.positions[index * 3] / tolerance) * tolerance + tolerance * (boundary + (vertex % 2 ? 0.002 : -0.002));
      return [x, mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]];
    }), indices = mesh.indices.map((_, index) => index);
    const nearShared = { ...mesh, positions, indices, normals: computeNormals(positions, indices) };
    expect(drawingSection(nearShared, mesh.bounds, 2.5).area).toBeCloseTo(200, 5);
  }
});
