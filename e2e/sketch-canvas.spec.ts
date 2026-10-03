import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; status: string; result?: RebuildResult }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path),
      s = useCadStore.getState();
    return {
      document: s.history.present,
      status: s.rebuild.status,
      result: s.rebuild.result,
    };
  });
}
async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      const mesh = state.result!.meshes[0];
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 5);
    }
  }).toPass({ timeout: 20_000 });
}
async function clickLocal(page: Page, x: number, y: number) {
  const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
  await svg.scrollIntoViewIfNeeded();
  const bounds = await svg.boundingBox(),
    view = (await svg.getAttribute("viewBox"))!.split(" ").map(Number);
  if (!bounds) throw new Error("Sketch canvas unavailable");
  await svg.click({
    position: {
      x: ((x - view[0]) / view[2]) * bounds.width,
      y: ((-y - view[1]) / view[3]) * bounds.height,
    },
  });
}
async function openCanvas(page: Page) {
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Sketch canvas", exact: true }),
  ).toBeVisible();
}
async function done(page: Page) {
  await page
    .getByRole("button", { name: "Done editing sketch", exact: true })
    .click();
}
function stlVolume(bytes: Buffer) {
  let sum = 0;
  for (let i = 0; i < bytes.readUInt32LE(80); i++) {
    const offset = 84 + 50 * i + 12,
      p = Array.from({ length: 9 }, (_, j) =>
        bytes.readFloatLE(offset + 4 * j),
      );
    sum +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return sum;
}
for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: pointer-drawn non-template profile, native extrusion/cut, edit, save/open and STL`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await expect(
      page.getByRole("button", { name: "Edit sketch canvas", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await clickLocal(page, 0, 0);
    await clickLocal(page, 40, 0);
    await clickLocal(page, 0, 30);
    await clickLocal(page, 0, 0);
    await done(page);
    const drawn = await snapshot(page),
      sketch = Object.values(drawn.document.sketches)[0];
    expect(
      Object.values(sketch.entities).filter((e) => e.type === "point"),
    ).toHaveLength(3);
    await ready(page);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await ready(page, 6000);
    const base = (await snapshot(page)).result!.meshes[0];
    const expected =
      plane === "XY"
        ? [
            [0, 0, 0],
            [40, 30, 10],
          ]
        : plane === "XZ"
          ? [
              [0, -10, 0],
              [40, 0, 30],
            ]
          : [
              [0, 0, 0],
              [10, 40, 30],
            ];
    for (const [i, end] of ["min", "max"].entries())
      base.bounds[end as "min" | "max"].forEach((v, axis) =>
        expect(v).toBeCloseTo(expected[i][axis], 5),
      );
    await expect(async () => {
      const diagnostics: ViewerSnapshot | undefined = await page.evaluate(
        async () => {
          const path = "/src/viewer/viewerDiagnostics.ts";
          return (await import(path)).inspectViewer();
        },
      );
      const expectedPoints = [
        [0, 0],
        [40, 0],
        [0, 30],
      ].map(([x, y]) =>
        plane === "XY" ? [x, y, 0] : plane === "XZ" ? [x, 0, y] : [0, x, y],
      );
      for (const point of expectedPoints)
        expect(
          diagnostics!.sketchPoints.some((p) =>
            p.position.every((v, axis) => Math.abs(v - point[axis]) < 1e-5),
          ),
        ).toBe(true);
    }).toPass();
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("circle");
    await clickLocal(page, 10, 10);
    await clickLocal(page, 13, 10);
    await done(page);
    await ready(page);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await ready(page);
    await page
      .getByRole("combobox", { name: "Target body", exact: true })
      .selectOption(base.bodyId);
    await page
      .getByRole("combobox", { name: "Operation", exact: true })
      .selectOption("cut");
    await page
      .getByRole("combobox", { name: "Termination", exact: true })
      .selectOption("throughAll");
    await ready(page, (600 - Math.PI * 9) * 10);
    // Edit the original feature through its inspector, preserving the drawn profile IDs.
    await page
      .locator(".feature-chip")
      .filter({ hasText: "Extrude 1" })
      .click();
    await page.getByLabel("Distance", { exact: true }).fill("14mm");
    await page.getByLabel("Distance", { exact: true }).press("Enter");
    const volume = (600 - Math.PI * 9) * 14;
    await ready(page, volume);
    const savedState = await snapshot(page),
      saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const path = info.outputPath("canvas.pcaddoc");
    await (await saving).saveAs(path);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(path);
    await ready(page, volume);
    expect((await snapshot(page)).document.sketches).toEqual(
      savedState.document.sketches,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("canvas.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl)) / volume).toBeCloseTo(1, 3);
    expect(errors).toEqual([]);
  });
}
test("draft cancellation, primitive undo/redo, analytic arcs and construction geometry", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await openCanvas(page);
  await clickLocal(page, 0, 0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Sketch canvas" }),
  ).toBeVisible();
  expect(
    Object.values((await snapshot(page)).document.sketches)[0].entities,
  ).toEqual({});
  await page
    .getByLabel("Canvas tool", { exact: true })
    .selectOption("rectangle");
  await clickLocal(page, 40, 20);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page
    .getByRole("button", { name: "Pan canvas right", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel drawing", exact: true }),
  ).toBeEnabled();
  await clickLocal(page, 60, 30);
  await page
    .getByRole("button", { name: "Undo canvas edit", exact: true })
    .click();
  expect(
    Object.values((await snapshot(page)).document.sketches)[0].entities,
  ).toEqual({});
  await page
    .getByRole("button", { name: "Redo canvas edit", exact: true })
    .click();
  expect(
    Object.values(
      Object.values((await snapshot(page)).document.sketches)[0].entities,
    ),
  ).toHaveLength(8);
  await page
    .getByRole("button", { name: "Undo canvas edit", exact: true })
    .click();
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("arc");
  await clickLocal(page, 0, 0);
  await clickLocal(page, 10, 0);
  await clickLocal(page, -10, 0);
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("line");
  await clickLocal(page, -10, 0);
  await clickLocal(page, 10, 0);
  await page
    .getByRole("button", { name: "Cancel drawing", exact: true })
    .click();
  await page
    .getByLabel("Canvas tool", { exact: true })
    .selectOption("rectangle");
  await page
    .getByLabel("Canvas construction geometry", { exact: true })
    .check();
  await clickLocal(page, 40, 20);
  await clickLocal(page, 60, 30);
  await done(page);
  await ready(page);
  await page
    .getByLabel("Sketch plane type", { exact: true })
    .selectOption("offset");
  await page.getByLabel("Sketch plane offset", { exact: true }).fill("7mm");
  await page
    .getByRole("button", { name: "Apply sketch plane", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await ready(page, Math.PI * 100 * 5);
  const mesh = (await snapshot(page)).result!.meshes[0];
  expect(mesh.bounds.min[2]).toBeCloseTo(7, 5);
  expect(mesh.bounds.max[2]).toBeCloseTo(17, 5);
  await expect(
    page.getByRole("button", { name: "Edit sketch canvas", exact: true }),
  ).toBeDisabled();
});

test("drawing dimensions drive native geometry, diagnose conflicts, persist and export", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Add Parameter", exact: true })
    .click();
  await page.getByLabel("Parameter param_1 name", { exact: true }).fill("bore");
  await page
    .getByLabel("Parameter param_1 name", { exact: true })
    .press("Enter");
  await page
    .getByLabel("Parameter bore expression", { exact: true })
    .fill("14mm");
  await page
    .getByLabel("Parameter bore expression", { exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await openCanvas(page);
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("circle");
  await clickLocal(page, 0, 0);
  await clickLocal(page, 5, 0);
  await ready(page);
  const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
  await expect(svg.locator("text")).toContainText(["R 5.0000 mm"]);
  await page
    .getByLabel("Canvas dimension type", { exact: true })
    .selectOption("diameter");
  await page
    .getByLabel("Canvas dimension reference 1", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByLabel("Canvas dimension expression", { exact: true })
    .fill("bore");
  await page
    .getByRole("button", { name: "Apply driving dimension", exact: true })
    .click();
  await ready(page);
  await expect(svg.locator("[data-dimension-id] text")).toHaveText(
    "D1 Ø 14.0000 mm",
  );
  const initial = await snapshot(page),
    sketch = Object.values(initial.document.sketches)[0],
    dimensionId = sketch.dimensions[0].id;
  expect(
    initial.result!.solvedSketches![sketch.id].circles[0].radius,
  ).toBeCloseTo(7, 6);
  // A second incompatible diameter fails solving; labels and native export must not imply success.
  await page
    .getByLabel("Canvas dimension selection", { exact: true })
    .selectOption("");
  await page
    .getByLabel("Canvas dimension expression", { exact: true })
    .fill("20mm");
  await page
    .getByRole("button", { name: "Apply driving dimension", exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(svg.locator("[data-dimension-id] text")).toContainText([
    "unavailable",
    "unavailable",
  ]);
  await expect(
    page.getByRole("button", { name: "Place coordinate", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Delete canvas dimension", exact: true })
    .click();
  await ready(page);
  await expect(svg.locator("[data-dimension-id] text")).toHaveText(
    "D1 Ø 14.0000 mm",
  );
  await svg.locator(`[data-dimension-id="${dimensionId}"]`).click();
  await expect(
    page.getByLabel("Canvas dimension expression", { exact: true }),
  ).toHaveValue("bore");
  await page.getByRole("button", { name: "Fit sketch", exact: true }).click();
  await page.screenshot({ path: info.outputPath("drawing-dimensions.png") });
  await done(page);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await ready(page, Math.PI * 49 * 10);
  await page
    .getByLabel("Parameter bore expression", { exact: true })
    .fill("20mm");
  await page
    .getByLabel("Parameter bore expression", { exact: true })
    .press("Enter");
  await ready(page, Math.PI * 100 * 10);
  await page.locator(".sketch-chip").first().click();
  await openCanvas(page);
  await expect(svg.locator("[data-dimension-id] text")).toHaveText(
    "D1 Ø 20.0000 mm",
  );
  await page.getByLabel("Show drawing dimensions", { exact: true }).uncheck();
  await expect(svg.locator("[data-dimension-id]")).toHaveCount(0);
  await page.getByLabel("Show drawing dimensions", { exact: true }).check();
  await done(page);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("dimensions.pcaddoc");
  await (await saving).saveAs(path);
  await page.reload();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await ready(page, Math.PI * 100 * 10);
  expect(
    Object.values((await snapshot(page)).document.sketches)[0].dimensions[0].id,
  ).toBe(dimensionId);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("dimensions.stl");
  await (await exporting).saveAs(stl);
  expect(stlVolume(await readFile(stl)) / (Math.PI * 100 * 10)).toBeCloseTo(
    1,
    2,
  );
  expect(errors).toEqual([]);
});
