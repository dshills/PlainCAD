import { expect, test, type Page } from "@playwright/test";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../src/cad/document/CadDocument";
import { addCircleAt, addCornerRectangle, addLine, addPoint, createSketchOnPlane } from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import type { CadDocument, Sketch } from "../src/cad/document/schema";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

async function load(page: Page, document: CadDocument, sketch: Sketch) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "automatic-preview.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await expect.poll(async () => (await aiSnapshot(page)).document.name).toBe(document.name);
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  await page.evaluate(async (id) => {
    const path = "/src/state/useCadStore.ts", state = (await import(path)).useCadStore.getState();
    state.select({ kind: "sketch", id, documentId: state.history.present.id });
  }, sketch.id);
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
}
function solid(sketch: Sketch, name: string) {
  const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
  if (!profile) throw new Error(`Automatic preview fixture needs a closed profile in ${sketch.name}.`);
  return upsertFeature(upsertSketch(createEmptyDocument(name), sketch), createExtrudeFeature({ name: "Preview source", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } }));
}
async function native(page: Page, volume: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded"); expect(state.result!.errors).toEqual([]);
    expect(state.result!.meshes).toHaveLength(1);
    expect(state.result!.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 6);
  }).toPass();
}

test("offset previews inputs automatically, diagnoses collapse outside Details, and applies only validated native geometry", async ({ page }) => {
  const sketch = addCornerRectangle(createSketchOnPlane("Auto offset", "XY"), "24mm", "16mm");
  await load(page, upsertSketch(createEmptyDocument("Automatic offset"), sketch), sketch);
  const original = await aiSnapshot(page);
  await page.getByRole("button", { name: "Offset sketch outline", exact: true }).click();
  const panel = page.getByRole("region", { name: "Offset sketch outline", exact: true });
  await panel.getByLabel("Outline offset direction").selectOption("inward");
  await panel.getByLabel("Outline offset distance").fill("8mm");
  await expect(panel.getByRole("alert")).toContainText(/collapses|self-intersect/);
  await expect(panel.getByRole("button", { name: "Apply outline offset" })).toBeDisabled();
  await panel.getByLabel("Outline offset distance").fill("2mm");
  await expect(panel.getByRole("button", { name: "Apply outline offset" })).toBeEnabled();
  expect((await aiSnapshot(page)).document).toEqual(original.document);
  await panel.getByLabel("Outline offset distance").fill("3mm");
  await expect(panel.getByRole("button", { name: "Apply outline offset" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Apply outline offset" })).toBeEnabled();
  await panel.getByRole("button", { name: "Cancel outline offset" }).click();
  expect((await aiSnapshot(page)).past).toBe(original.past);
  await page.getByRole("button", { name: "Offset sketch outline", exact: true }).click();
  await panel.getByLabel("Outline offset direction").selectOption("inward");
  await panel.getByLabel("Outline offset distance").fill("2mm");
  await expect(panel.getByRole("button", { name: "Apply outline offset" })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply outline offset" }).click();
  expect((await aiSnapshot(page)).past).toBe(original.past + 1);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("8mm"); await applyExtrusion(page); await native(page, 1152);
});

test("pattern automatically previews current spacing and applies native holes as one undo step", async ({ page }) => {
  const sketch = addCircleAt(addCornerRectangle(createSketchOnPlane("Auto copies", "XY"), "24mm", "16mm"), "4mm", "5mm", "1mm");
  const circle = Object.values(sketch.entities).find((entity) => entity.type === "circle")!;
  await load(page, solid(sketch, "Automatic copies"), sketch); await native(page, (384 - Math.PI) * 8);
  await page.getByRole("button", { name: "Draw tool: select", exact: true }).click();
  await page.getByLabel("Selected sketch item", { exact: true }).selectOption(circle.id);
  const original = await aiSnapshot(page);
  await page.getByRole("button", { name: "Linear pattern selected sketch geometry", exact: true }).click();
  const panel = page.getByRole("region", { name: "Linear sketch pattern", exact: true });
  await panel.getByLabel("Pattern spacing").fill("6mm");
  await expect(panel.getByRole("button", { name: "Apply copies" })).toBeEnabled();
  await expect(panel.getByLabel("Sketch copy status")).toContainText("Native copy preview ready");
  expect((await aiSnapshot(page)).document).toEqual(original.document);
  await panel.getByLabel("Pattern spacing").fill("5mm");
  await expect(panel.getByRole("button", { name: "Apply copies" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Apply copies" })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply copies" }).click(); await native(page, (384 - 3 * Math.PI) * 8);
  expect((await aiSnapshot(page)).past).toBe(original.past + 1);
});

test("trim and extend automatically validate canvas picks before producing a native part", async ({ page }) => {
  let sketch = createSketchOnPlane("Auto trim", "XY"); const curves: string[] = [];
  for (const [x1, y1, x2, y2] of [[-10, 20, 30, 20], [30, 0, 30, 10], [0, 0, 30, 0], [0, 0, 0, 20]]) {
    const a = addPoint(sketch, `${x1}mm`, `${y1}mm`), b = addPoint(a.sketch, `${x2}mm`, `${y2}mm`), line = addLine(b.sketch, a.pointId, b.pointId);
    sketch = line.sketch; curves.push(line.lineId);
  }
  await load(page, upsertSketch(createEmptyDocument("Automatic trim"), sketch), sketch);
  const original = await aiSnapshot(page);
  for (const [mode, id, x, y] of [["trim", curves[0], -5, 20], ["extend", curves[1], 30, 9]] as const) {
    await page.getByRole("button", { name: mode === "trim" ? "Trim sketch lines" : "Extend sketch lines", exact: true }).click();
    const panel = page.getByRole("region", { name: mode === "trim" ? "Trim sketch lines" : "Extend sketch lines", exact: true });
    await panel.getByLabel("Line to edit").selectOption(id);
    const canvas = page.getByRole("group", { name: "Sketch drawing canvas", exact: true }); await canvas.scrollIntoViewIfNeeded();
    const point = await canvas.evaluate((element, point) => {
      const svg = element as SVGSVGElement, matrix = svg.getScreenCTM(); if (!matrix) throw new Error("Sketch projection unavailable");
      const screen = new DOMPoint(point.x, -point.y).matrixTransform(matrix); return { x: screen.x, y: screen.y };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
    await expect(panel.getByRole("button", { name: `Apply ${mode}` })).toBeEnabled();
    await expect(panel.locator("details")).not.toHaveAttribute("open");
    await panel.getByRole("button", { name: `Apply ${mode}` }).click();
  }
  expect((await aiSnapshot(page)).past).toBe(original.past + 2);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("6mm"); await applyExtrusion(page); await native(page, 3600);
});

test("projection automatically validates selected boundaries and construction changes before one immutable Apply", async ({ page }) => {
  const source = addCornerRectangle(createSketchOnPlane("Projection source", "XY"), "30mm", "20mm");
  const target = createSketchOnPlane("Projection target", { type: "offset", base: "XY", offset: { expression: "12mm", unit: "mm" } });
  await load(page, upsertSketch(solid(source, "Automatic projection"), target), target); await native(page, 4800);
  const original = await aiSnapshot(page);
  await page.getByRole("button", { name: "Project part edges into sketch", exact: true }).click();
  const panel = page.getByRole("region", { name: "Project part edges", exact: true });
  await expect(panel.getByLabel("Source part boundary").locator("option")).toHaveCount(3);
  const end = await panel.getByLabel("Source part boundary").locator("option").evaluateAll(options => options.find(option => option.textContent?.includes("End cap"))?.getAttribute("value"));
  expect(end).toBeTruthy(); await panel.getByLabel("Source part boundary").selectOption(end!);
  await expect(panel.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
  expect((await aiSnapshot(page)).document).toEqual(original.document);
  const sameBoundary = panel.getByRole("button", { name: /^Project .*Preview source.*End cap$/ });
  await sameBoundary.focus(); await sameBoundary.press("Enter");
  await expect(panel.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
  await panel.locator("summary").filter({ hasText: /^Details$/ }).click();
  await panel.getByLabel("Construction reference only").check();
  await expect(panel.getByRole("button", { name: "Apply projected boundary" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Apply projected boundary" })).toBeEnabled();
  await panel.getByRole("button", { name: "Apply projected boundary" }).click(); await native(page, 4800);
  const applied = await aiSnapshot(page); expect(applied.past).toBe(original.past + 1);
  expect(applied.document.sketches[target.id].projections![0].construction).toBe(true);
});
