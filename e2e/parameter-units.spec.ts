import { applyExtrusion } from "./extrudeWorkflow";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function state(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const s = (await import(path)).useCadStore.getState();
    return {
      document: s.history.present as CadDocument,
      result: s.rebuild.result as RebuildResult | undefined,
      status: s.rebuild.status,
      selected: s.selection.selectedIds[0],
    };
  });
}
async function ready(page: Page, width: number) {
  await expect(async () => {
    const s = await state(page);
    expect(s.status).toBe("succeeded");
    expect(s.result?.documentId).toBe(s.document.id);
    expect(s.result?.errors).toEqual([]);
    const mesh = s.result!.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(mesh.geometryAssertions!.volume).toBeCloseTo(width * 50 * 20, 4);
    expect(mesh.bounds.max[0] - mesh.bounds.min[0]).toBeCloseTo(width, 4);
  }).toPass({ timeout: 20000 });
}
async function edit(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).fill(text);
  await page.getByLabel(label, { exact: true }).press("Enter");
}
function stlVolume(bytes: Buffer) {
  let volume = 0;
  for (let t = 0; t < bytes.readUInt32LE(80); t++) {
    const o = 84 + t * 50 + 12;
    const p = Array.from({ length: 9 }, (_, i) => bytes.readFloatLE(o + i * 4));
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return volume;
}
test("authored/display units, current evaluated readouts, scalar parameters, groups and native save/open/STL", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load parametric box template", exact: true })
    .click();
  await ready(page, 80);
  const parameters = page.getByRole("region", {
    name: "Parameters",
    exact: true,
  });
  await expect(parameters.getByLabel("Computed parameter width")).toHaveText(
    "80.0000 mm",
  );
  const id = (await state(page)).document.parameters.width.id;
  await page.getByLabel("Parameter width expression").focus();
  await edit(page, "width group", "Stock");
  await edit(page, "width description", "Cut stock width");
  await parameters.getByText("Unit defaults", { exact: true }).click();
  await page.getByLabel("Authoring length unit").selectOption("in");
  await page.getByLabel("Display length unit").selectOption("in");
  await ready(page, 80);
  await expect(parameters.getByLabel("Computed parameter width")).toHaveText(
    "3.1496 in",
  );
  await edit(page, "Parameter width expression", "2");
  await ready(page, 50.8);
  await expect(parameters.getByLabel("Computed parameter width")).toHaveText(
    "2.0000 in",
  );
  expect((await state(page)).document.parameters.width).toMatchObject({
    id,
    expression: "2",
    authoredUnit: "in",
    group: "Stock",
    description: "Cut stock width",
  });
  await page
    .getByRole("button", { name: "Add Parameter", exact: true })
    .click();
  await ready(page, 50.8);
  await expect(parameters.getByLabel("Computed parameter param_4")).toHaveText(
    "10.0000 in",
  );
  await page.getByLabel("Parameter param_4 expression").focus();
  await page.getByLabel("Bare-number unit for param_4").selectOption("");
  await edit(page, "Parameter param_4 name", "steps");
  await edit(page, "Parameter steps expression", "2");
  await ready(page, 50.8);
  await expect(parameters.getByLabel("Computed parameter steps")).toHaveText(
    "2.0000",
  );
  await edit(page, "steps group", "Hardware");
  await expect(parameters.getByRole("group", { name: "Stock" })).toBeVisible();
  await expect(
    parameters.getByRole("group", { name: "Hardware" }),
  ).toBeVisible();

  await page.getByLabel("Authoring length unit").selectOption("mm");
  await page.getByLabel("Display length unit").selectOption("mm");
  await ready(page, 50.8);
  await expect(parameters.getByLabel("Computed parameter width")).toHaveText(
    "50.8000 mm",
  );
  await edit(page, "Parameter width name", "span");
  await ready(page, 50.8);
  expect((await state(page)).document.parameters.span).toMatchObject({
    id,
    expression: "2",
    authoredUnit: "in",
  });
  await edit(page, "Parameter span expression", "3");
  await ready(page, 3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page, 50.8);
  await expect(parameters.getByLabel("Computed parameter span")).toHaveText(
    "50.8000 mm",
  );
  const stl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath("units.stl");
  await (await stl).saveAs(stlPath);
  expect(stlVolume(await readFile(stlPath)) / 50800).toBeCloseTo(1, 4);

  await edit(page, "Parameter span expression", "missing_length");
  await expect.poll(async () => (await state(page)).status).toBe("failed");
  await expect(parameters.getByLabel("Computed parameter span")).toHaveText(
    "Unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page, 50.8);
  await page.getByLabel("Authoring length unit").selectOption("in");
  await page.getByLabel("Authoring angle unit").selectOption("rad");
  await page.getByLabel("Display angle unit").selectOption("rad");
  await ready(page, 50.8);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const projectPath = info.outputPath("units.pcaddoc");
  await (await save).saveAs(projectPath);
  const saved = JSON.parse(await readFile(projectPath, "utf8")) as CadDocument;
  expect(saved.parameters.span).toMatchObject({
    id,
    expression: "2",
    authoredUnit: "in",
    group: "Stock",
  });
  expect(saved.displayUnits).toMatchObject({ length: "mm", angle: "rad" });
  await page
    .getByRole("button", { name: "Load parametric box template", exact: true })
    .click();
  await ready(page, 80);
  await page.locator('input[type="file"]').setInputFiles(projectPath);
  await ready(page, 50.8);
  await expect(page.getByLabel("Authoring length unit")).toHaveValue("in");
  await expect(parameters.getByLabel("Computed parameter span")).toHaveText(
    "50.8000 mm",
  );
  await expect(parameters.getByRole("group", { name: "Stock" })).toBeVisible();

  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add center rectangle", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await applyExtrusion(page);
  await ready(page, 50.8);
  const added = (await state(page)).selected!.id;
  await edit(page, "Distance", "0.25");
  await expect(async () => {
    const s = await state(page),
      mesh = s.result?.meshes.find((m) => m.bodyId === `body:${added}`);
    expect(s.status).toBe("succeeded");
    expect(mesh?.geometryAssertions?.volume).toBeCloseTo(80 * 50 * 6.35, 4);
    expect(mesh?.bounds.max[2]).toBeCloseTo(6.35, 4);
    const feature = s.document.features.find((f) => f.id === added);
    expect(feature?.type === "extrude" && feature.distance).toMatchObject({
      expression: "0.25",
      authoredUnit: "in",
    });
  }).toPass({ timeout: 20000 });
  await page.getByRole("button", { name: /^Sketch 2 XY plane/ }).click();
  await page.getByLabel("Sketch plane type").selectOption("offset");
  await page.getByLabel("Sketch plane offset").fill("1");
  await page
    .getByRole("button", { name: "Apply sketch plane", exact: true })
    .click();
  await expect(async () => {
    const s = await state(page),
      mesh = s.result?.meshes.find((m) => m.bodyId === `body:${added}`);
    expect(s.status).toBe("succeeded");
    expect(mesh?.bounds.min[2]).toBeCloseTo(25.4, 4);
    expect(mesh?.bounds.max[2]).toBeCloseTo(31.75, 4);
  }).toPass({ timeout: 20000 });
  expect(errors).toEqual([]);
});
