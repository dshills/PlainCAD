import { CURRENT_SCHEMA_VERSION } from "../src/cad/document/schema";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; status: string; result: RebuildResult }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const s = (await import(path)).useCadStore.getState();
    return {
      document: s.history.present,
      status: s.rebuild.status,
      result: s.rebuild.result,
    };
  });
}
async function ready(page: Page) {
  await expect(async () => {
    const s = await snapshot(page);
    expect(s.status).toBe("succeeded");
    expect(s.result.errors).toEqual([]);
  }).toPass();
}
async function commit(page: Page, name: string, value: string) {
  if (name.startsWith("Parameter ") && name.endsWith(" name")) {
    const parameter = name.slice("Parameter ".length, -" name".length);
    await page.getByRole("button", { name: `Rename parameter ${parameter}`, exact: true }).click();
  }
  const input = page.getByRole("textbox", { name, exact: true });
  await input.fill(value);
  await input.press("Enter");
}
test("parameter IDs survive rename, undo/redo, old-name reuse, save/open and native STL", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Load parametric box template" })
    .click();
  await ready(page);
  const before = await snapshot(page),
    id = before.document.parameters.width.id;
  await commit(page, "Parameter width name", "height");
  await expect(
    page.getByRole("alert").filter({ hasText: "already exists" }),
  ).toBeVisible();
  expect((await snapshot(page)).document.parameters.width.id).toBe(id);
  await commit(page, "Parameter width name", "span");
  await ready(page);
  expect(
    (await snapshot(page)).result.meshes[0].geometryAssertions!.volume,
  ).toBe(before.result.meshes[0].geometryAssertions!.volume);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  expect((await snapshot(page)).document.parameters.width.id).toBe(id);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ready(page);
  expect((await snapshot(page)).document.parameters.span.id).toBe(id);
  await page
    .getByRole("button", { name: "Add Parameter", exact: true })
    .click();
  const added = Object.values((await snapshot(page)).document.parameters).find(
    (p) => p.name.startsWith("param_"),
  )!;
  await commit(page, `Parameter ${added.name} name`, "width");
  await commit(page, "Parameter width expression", "200mm");
  await ready(page);
  expect((await snapshot(page)).result.meshes[0].bounds).toEqual(
    before.result.meshes[0].bounds,
  );
  await commit(page, "Parameter span expression", "91mm");
  await ready(page);
  const edited = await snapshot(page),
    mesh = edited.result.meshes[0];
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.bounds.max[0] - mesh.bounds.min[0]).toBeCloseTo(91);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = info.outputPath("renamed.pcaddoc");
  await (await saving).saveAs(project);
  const saved = JSON.parse(await readFile(project, "utf8"));
  expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(JSON.stringify(saved.sketches)).toContain(id);
  await page.reload();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(project);
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(edited.document.id);
  await ready(page);
  expect((await snapshot(page)).result.meshes[0].bounds).toEqual(mesh.bounds);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("renamed.stl");
  await (await exporting).saveAs(stl);
  const bytes = await readFile(stl);
  expect(bytes.length).toBe(84 + bytes.readUInt32LE(80) * 50);
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < bytes.readUInt32LE(80); i++)
    for (const offset of [12, 24, 36]) {
      const x = bytes.readFloatLE(84 + i * 50 + offset);
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
  expect(max - min).toBeCloseTo(91);
  expect(errors).toEqual([]);
});
