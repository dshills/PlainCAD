import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

async function client(page: Page, x: number, y: number) {
  const svg = page.getByRole("group", {
    name: "Sketch drawing canvas",
    exact: true,
  });
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  if (!box) throw new Error("Sketch canvas missing");
  const view = (await svg.getAttribute("viewBox"))!.split(" ").map(Number);
  return {
    x: box.x + ((x - view[0]) / view[2]) * box.width,
    y: box.y + ((-y - view[1]) / view[3]) * box.height,
  };
}
async function hover(page: Page, x: number, y: number, dx = 3, dy = 3) {
  const p = await client(page, x, y);
  await page.mouse.move(p.x + dx, p.y + dy);
  return { x: p.x + dx, y: p.y + dy };
}
async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    if (volume !== undefined) {
      const mesh = state.result!.meshes[0];
      expect(state.result!.meshes).toHaveLength(1);
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 6);
    }
  }).toPass({ timeout: 30000 });
}
async function fixture(page: Page) {
  await page.goto("/");
  await ready(page);
  const id = await page.evaluate(async () => {
    const docPath = "/src/cad/document/CadDocument.ts",
      geometryPath = "/src/cad/sketch/canvasGeometry.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      solvePath = "/src/cad/sketch/SketchSolver.ts",
      statePath = "/src/state/useCadStore.ts";
    const docs = await import(docPath),
      { addCanvasGeometry } = await import(geometryPath),
      { createXySketch } = await import(modelPath),
      { solveSketch } = await import(solvePath),
      { useCadStore } = await import(statePath);
    let sketch = createXySketch("Precision references");
    for (const [tool, points] of [
      [
        "line",
        [
          { x: -20, y: 0 },
          { x: 0, y: 0 },
        ],
      ],
      [
        "line",
        [
          { x: 0, y: 12 },
          { x: 20, y: 12 },
        ],
      ],
      [
        "circle",
        [
          { x: 30, y: -10 },
          { x: 34, y: -10 },
        ],
      ],
      [
        "arc",
        [
          { x: -30, y: -10 },
          { x: -25, y: -10 },
          { x: -30, y: -5 },
        ],
      ],
    ] as const)
      sketch = addCanvasGeometry(
        sketch,
        solveSketch(sketch, {}),
        tool,
        [...points],
        true,
      ).sketch;
    const document = docs.upsertSketch(
      docs.upsertParameter(docs.createEmptyDocument("Precise mouse model"), {
        id: "thickness",
        name: "thickness",
        expression: "5mm",
        value: 5,
        unit: "mm",
      }),
      sketch,
    );
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "sketch", id: sketch.id, documentId: document.id });
    return sketch.id;
  });
  await ready(page);
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  return id;
}

test("precise pointer snaps show bounded midpoint/center/alignment feedback and survive native extrusion/edit/save/open/STL", async ({
  page,
}, info) => {
  const sketchId = await fixture(page);
  const before = await aiSnapshot(page);
  const snaps = page.getByLabel("Geometry snaps", { exact: true });
  await expect(snaps).toBeChecked();
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("point");
  await hover(page, 30, -10);
  await expect(
    page.getByRole("img", { name: "Center snap", exact: true }),
  ).toBeVisible();
  await hover(page, -30, -10);
  await expect(
    page.getByRole("img", { name: "Center snap", exact: true }),
  ).toBeVisible();
  await hover(page, -10, 0);
  await expect(
    page.getByRole("img", { name: "Midpoint snap", exact: true }),
  ).toBeVisible();
  const view = (await page
    .getByLabel("Sketch drawing canvas", { exact: true })
    .getAttribute("viewBox"))!
    .split(" ")
    .map(Number);
  await page
    .getByRole("button", { name: "Pan canvas right", exact: true })
    .click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await hover(page, 10, 12);
  await expect(
    page.getByRole("img", { name: "Midpoint snap", exact: true }),
  ).toBeVisible();
  expect(
    (await page
      .getByLabel("Sketch drawing canvas", { exact: true })
      .getAttribute("viewBox"))!
      .split(" ")
      .map(Number),
  ).not.toEqual(view);
  await page.getByRole("button", { name: "Fit sketch", exact: true }).click();
  await hover(page, -10, 7, 3, 0);
  await expect(
    page.getByRole("img", { name: "Vertical alignment snap", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-snap-kind="alignment"] line')).toHaveCount(
    1,
  );
  await snaps.uncheck();
  await hover(page, -10, 0);
  await expect(page.locator('[data-snap-kind="midpoint"]')).toHaveCount(0);
  await snaps.check();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await page
    .getByRole("button", { name: "Draw tool: rectangle", exact: true })
    .click();
  await hover(page, -10, 0);
  await expect(
    page.getByRole("img", { name: "Midpoint snap", exact: true }),
  ).toBeVisible();
  await page.mouse.down();
  const end = await client(page, 10, 12);
  await page.mouse.move(end.x + 3, end.y + 3, { steps: 5 });
  await expect(
    page.getByRole("img", { name: "Midpoint snap", exact: true }),
  ).toBeVisible();
  await page.mouse.up();
  await ready(page);
  const drawn = await aiSnapshot(page),
    sketch = drawn.document.sketches[sketchId];
  const originalIds = new Set(
    Object.keys(before.document.sketches[sketchId].entities),
  );
  const newPoints = Object.values(sketch.entities).filter(
    (e) => e.type === "point" && !originalIds.has(e.id),
  );
  expect(newPoints).toHaveLength(4);
  expect(
    newPoints
      .map((p) =>
        p.type === "point"
          ? [
              Number.parseFloat(p.x.expression),
              Number.parseFloat(p.y.expression),
            ]
          : [],
      )
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  ).toEqual([
    [-10, 0],
    [-10, 12],
    [10, 0],
    [10, 12],
  ]);
  expect(sketch.constraints).toEqual(
    before.document.sketches[sketchId].constraints,
  );
  expect(drawn.past).toBe(before.past + 1);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("thickness");
  await applyExtrusion(page);
  await ready(page, 1200);
  const parameter = page.getByRole("textbox", {
    name: "Parameter thickness expression",
    exact: true,
  });
  await parameter.fill("7mm");
  await parameter.press("Enter");
  await ready(page, 1680);
  const final = await aiSnapshot(page);
  expect(final.result!.meshes[0].bounds).toMatchObject({
    min: [-10, 0, 0],
    max: [10, 12, 7],
  });
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = info.outputPath("snapped.pcaddoc");
  await (await saving).saveAs(project);
  await page.locator('input[type="file"]').setInputFiles(project);
  await expect
    .poll(async () => (await aiSnapshot(page)).session)
    .toBeGreaterThan(final.session);
  await ready(page, 1680);
  expect((await aiSnapshot(page)).document.sketches[sketchId]).toEqual(sketch);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("snapped.stl");
  await (await exporting).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(1680, 3);
});
