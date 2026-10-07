import { expect, test } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";
import type { Sketch } from "../src/cad/document/schema";

test.use({ storageState: { cookies: [], origins: [] } });

test("workbench guides an open outline through explicit repair to a native solid", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const guide = page.getByRole("region", { name: "Next modeling action" });
  await expect(guide).toHaveAttribute("data-readiness", "empty-project");
  const document = await page.evaluate(async () => {
    const docsPath = "/src/cad/document/CadDocument.ts";
    const sketchPath = "/src/cad/sketch/SketchModel.ts";
    const geometryPath = "/src/cad/sketch/canvasGeometry.ts";
    const solverPath = "/src/cad/sketch/SketchSolver.ts";
    const docs = await import(docsPath);
    const sketches = await import(sketchPath);
    const geometry = await import(geometryPath);
    const solver = await import(solverPath);
    let sketch = sketches.createXySketch("Outline to finish");
    for (const [start, end] of [[[0, 0], [20, 0]], [[20, 0], [20, 10]], [[20, 10], [0, 10]]]) {
      sketch = geometry.addCanvasGeometry(sketch, solver.solveSketch(sketch, {}), "line", [
        { x: start[0], y: start[1] }, { x: end[0], y: end[1] },
      ]).sketch;
    }
    return docs.upsertSketch(docs.createEmptyDocument("Readiness workflow"), sketch);
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "unfinished.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect.poll(async () => (await aiSnapshot(page)).document.id).toBe(document.id);
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: /^Outline to finish/ }).click();
  await expect(guide).toHaveAttribute("data-readiness", "open-sketch");
  await expect(guide.getByRole("button", { name: "Extrude sketch", exact: true })).toBeDisabled();
  await expect(guide).toContainText("usable closed profile");
  await guide.getByRole("button", { name: "Open Issues", exact: true }).click();
  const repair = page.locator(".repair-card").filter({ hasText: "Close this sketch outline" }).first();
  const before = await aiSnapshot(page);
  await repair.getByRole("button", { name: "Show and repair", exact: true }).click();
  await repair.getByRole("button", { name: "Add missing closing edge", exact: true }).click();
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Extrude", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Make solid from finished sketch" })).toHaveCount(0);
  await applyExtrusion(page);
  await expect(async () => {
    const after = await aiSnapshot(page);
    expect(after.status).toBe("succeeded");
    expect(after.past).toBe(before.past + 2);
    expect(after.result?.meshes).toHaveLength(1);
    expect(after.result!.meshes[0]).toMatchObject({
      geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 },
    });
    expect(after.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(2000, 5);
  }).toPass({ timeout: 30000 });
});

test("workbench links a failed sketch to its current driving-dimension repair", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const document = await page.evaluate(async () => {
    const docsPath = "/src/cad/document/CadDocument.ts";
    const sketchPath = "/src/cad/sketch/SketchModel.ts";
    const docs = await import(docsPath), sketches = await import(sketchPath);
    const sketch: Sketch = sketches.addCircleAt(sketches.createXySketch("Conflicting outline"), "0mm", "0mm", "5mm");
    const circle = Object.values(sketch.entities).find((entity) => entity.type === "circle")!;
    sketch.dimensions = [
      { id: "first-radius", type: "radius", entityIds: [circle.id], expression: { expression: "5mm", unit: "mm" } },
      { id: "second-radius", type: "radius", entityIds: [circle.id], expression: { expression: "10mm", unit: "mm" } },
    ];
    return docs.upsertSketch(docs.createEmptyDocument("Broken readiness workflow"), sketch);
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "conflict.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
  });
  const guide = page.getByRole("region", { name: "Next modeling action" });
  await expect(guide).toHaveAttribute("data-readiness", "failed-model");
  await page.getByRole("button", { name: /^Conflicting outline/ }).click();
  await expect(guide).toHaveAttribute("data-readiness", "broken-sketch");
  const before = await aiSnapshot(page);
  await guide.getByRole("button", { name: "Show and repair sketch", exact: true }).click();
  await expect(page.getByRole("region", { name: "Sketch canvas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete this dimension", exact: true }).click();
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Extrude", exact: true })).toBeVisible();
  expect((await aiSnapshot(page)).past).toBe(before.past + 1);
});
