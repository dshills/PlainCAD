import { expect, test, type Page } from "@playwright/test";
import { createEmptyDocument } from "../src/cad/document/CadDocument";
import type { CommandRequest, CommandResponse, JsonValue } from "../src/commands/registry";

type NativeState = { session: number; document: { id: string }; history: { undo: number }; rebuild: { native: boolean; bodies: { bounds: { min: number[]; max: number[] }; assertions: { valid: boolean; solidCount: number; volume: number } }[] } };
async function command(page: Page, id: string, args: JsonValue = {}): Promise<JsonValue> {
  const response = await page.evaluate(async (text) => {
    const request = JSON.parse(text) as CommandRequest;
    const discovery = await window.plaincadCommands.list();
    if (!discovery.ok) throw new Error(discovery.error.message);
    return window.plaincadCommands.execute({ ...request, session: (discovery.value as { session: number }).session });
  }, JSON.stringify({ command: id, arguments: args })) as CommandResponse;
  expect(response.ok, JSON.stringify(response)).toBe(true);
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}
async function native(page: Page, volume: number, min: number[], max: number[], radialTolerance?: number) {
  const state = await command(page, "runtime.awaitNative") as unknown as NativeState;
  expect(state.rebuild.native).toBe(true);
  expect(state.rebuild.bodies).toHaveLength(1);
  const body = state.rebuild.bodies[0];
  expect(body.assertions.valid).toBe(true);
  expect(body.assertions.solidCount).toBe(1);
  expect(body.assertions.volume).toBeCloseTo(volume, 5);
  min.forEach((n, i) => radialTolerance && i < 2 ? expect(Math.abs(body.bounds.min[i] - n)).toBeLessThan(radialTolerance) : expect(body.bounds.min[i]).toBeCloseTo(n, 5));
  max.forEach((n, i) => radialTolerance && i < 2 ? expect(Math.abs(body.bounds.max[i] - n)).toBeLessThan(radialTolerance) : expect(body.bounds.max[i]).toBeCloseTo(n, 5));
}
export function semanticCadCommandAcceptance() {
  test("semantic commands produce editable native parts, scoped holes, placements and save/open geometry", async ({ page }) => {
    await page.goto("/");
    await command(page, "document.import", { text: JSON.stringify(createEmptyDocument("Semantic plate")) });
    const width = await command(page, "cad.parameter.add", { name: "plate_width", expression: "20mm" }) as { id: string };
    const component = await command(page, "cad.component.create", { name: "Plate" }) as { id: string };
    const outline = await command(page, "cad.sketch.create", { name: "Outline", componentId: component.id, plane: "XY" }) as { id: string };
    const rectangle = await command(page, "cad.sketch.rectangle", { sketchId: outline.id, width: "plate_width", height: "10mm" }) as { profileIds: string[] };
    const extrusion = await command(page, "cad.feature.extrude", { sketchId: outline.id, profileId: rectangle.profileIds[0], distance: "5mm" }) as { id: string; bodyId: string };
    await native(page, 1000, [0, 0, 0], [20, 10, 5]);
    const drill = await command(page, "cad.sketch.create", { name: "Drill", componentId: component.id, plane: "XY" }) as { id: string };
    const point = await command(page, "cad.sketch.point", { sketchId: drill.id, point: { x: "10mm", y: "5mm" } }) as { id: string };
    await command(page, "cad.feature.hole", { sketchId: drill.id, centerPointIds: [point.id], targetBodyIds: [extrusion.bodyId], diameter: "2mm", throughAll: true });
    await native(page, 1000 - 5 * Math.PI, [0, 0, 0], [20, 10, 5]);
    await command(page, "cad.parameter.update", { parameterId: width.id, expression: "30mm" });
    await command(page, "cad.component.place", { componentId: component.id, translation: [30, 0, 0], rotation: [0, 0, 0] });
    await native(page, 1500 - 5 * Math.PI, [30, 0, 0], [60, 10, 5]);
    const saved = await command(page, "document.serialize") as { text: string };
    await command(page, "document.import", { text: saved.text });
    await native(page, 1500 - 5 * Math.PI, [30, 0, 0], [60, 10, 5]);
    await command(page, "cad.feature.update", { featureId: extrusion.id, distance: "8mm" });
    await native(page, 2400 - 8 * Math.PI, [30, 0, 0], [60, 10, 8]);
    await command(page, "history.undo");
    await native(page, 1500 - 5 * Math.PI, [30, 0, 0], [60, 10, 5]);
  });
  test("semantic revolve preserves XZ orientation and native edge treatments change actual solids", async ({ page }) => {
    await page.goto("/");
    await command(page, "document.import", { text: JSON.stringify(createEmptyDocument("Semantic cylinder")) });
    const sketch = await command(page, "cad.sketch.create", { name: "Revolve section", plane: "XZ" }) as { id: string };
    await command(page, "cad.sketch.rectangle", { sketchId: sketch.id, origin: { x: "5mm", y: "0mm" }, width: "5mm", height: "10mm" });
    await command(page, "cad.feature.revolve", { sketchId: sketch.id, angle: "360deg", axis: "Z" });
    // Mesh samples approximate curved extrema; native BRep volume remains exact.
    await native(page, 750 * Math.PI, [-10, -10, 0], [10, 10, 10], 0.03);
    await command(page, "document.import", { text: JSON.stringify(createEmptyDocument("Semantic fillet")) });
    const outline = await command(page, "cad.sketch.create", { name: "Outline", plane: "XY" }) as { id: string };
    await command(page, "cad.sketch.rectangle", { sketchId: outline.id, width: "20mm", height: "10mm" });
    const base = await command(page, "cad.feature.extrude", { sketchId: outline.id, distance: "5mm" }) as { id: string };
    await native(page, 1000, [0, 0, 0], [20, 10, 5]);
    await command(page, "cad.feature.fillet", { edges: [{ featureId: base.id, role: "endCapPerimeter" }], radius: "1mm" });
    const rounded = await command(page, "runtime.awaitNative") as unknown as NativeState;
    expect(rounded.rebuild.native).toBe(true);
    expect(rounded.rebuild.bodies).toHaveLength(1);
    expect(rounded.rebuild.bodies[0].assertions.valid).toBe(true);
    expect(rounded.rebuild.bodies[0].assertions.solidCount).toBe(1);
    expect(rounded.rebuild.bodies[0].assertions.volume).toBeLessThan(990);
    expect(rounded.rebuild.bodies[0].assertions.volume).toBeGreaterThan(970);
    await command(page, "history.undo");
    await native(page, 1000, [0, 0, 0], [20, 10, 5]);
    await command(page, "cad.feature.chamfer", { edges: [{ featureId: base.id, role: "endCapPerimeter" }], distance: "1mm" });
    const bevel = await command(page, "runtime.awaitNative") as unknown as NativeState;
    expect(bevel.rebuild.native).toBe(true);
    expect(bevel.rebuild.bodies).toHaveLength(1);
    expect(bevel.rebuild.bodies[0].assertions.valid).toBe(true);
    expect(bevel.rebuild.bodies[0].assertions.solidCount).toBe(1);
    expect(bevel.rebuild.bodies[0].assertions.volume).toBeLessThan(975);
    expect(bevel.rebuild.bodies[0].assertions.volume).toBeGreaterThan(965);
  });
}
