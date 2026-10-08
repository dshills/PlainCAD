import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
async function openFamily(page: Page) {
  await page.keyboard.press("ControlOrMeta+k"); const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
  await palette.getByLabel("Filter commands").fill("Product configurations"); await palette.getByRole("button", { name: /^Product configurations/ }).click();
  return page.getByRole("dialog", { name: "Product configurations", exact: true });
}
function unpack(bytes: Buffer) { const files: { name: string; bytes: Buffer }[] = []; for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) { const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28); files.push({ name: bytes.subarray(offset + 30, offset + 30 + nameLength).toString(), bytes: bytes.subarray(start, start + size) }); offset = start + size; } return files; }
async function width(page: Page, expected: number) { await expect(async () => { const state = await aiSnapshot(page); expect(state.status).toBe("succeeded"); const mesh = state.result?.meshes.find(mesh => mesh.bodyId === "body:first-solid"); expect(mesh?.geometrySource).toBe("opencascade"); expect(mesh?.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 }); expect(mesh?.bounds.max[0]).toBeCloseTo(expected, 6); }).toPass({ timeout: 30000 }); }
test("native configuration comparison, batch STL and apply/undo remain associative through save/open", async ({ page }, info) => {
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles("src/persistence/fixtures/schema-v20.pcaddoc"); await width(page, 20);
  const before = await aiSnapshot(page); let dialog = await openFamily(page);
  await dialog.getByRole("checkbox", { name: "Compare Small", exact: true }).check(); await dialog.getByRole("checkbox", { name: "Compare Large", exact: true }).check();
  await dialog.getByRole("button", { name: "Compare selected configurations", exact: true }).click(); await expect(dialog.getByRole("status")).toHaveText("Comparison complete");
  await expect(dialog.getByRole("row").filter({ hasText: "Small" })).toContainText("4520.000");
  await expect(dialog.getByRole("row").filter({ hasText: "Large" })).toContainText("6240.000");
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  const downloading = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Download configuration STL archive", exact: true }).click(); const archive = info.outputPath("family.zip"); await (await downloading).saveAs(archive);
  const files = unpack(await readFile(archive)), manifest = JSON.parse(files.find(file => file.name === "manifest.json")!.bytes.toString());
  expect(files).toHaveLength(7); expect(new Set(files.map(file => file.name)).size).toBe(files.length);
  for (const configuration of manifest.configurations as { name: string; parts: { filename: string; volumeMm3: number }[] }[]) {
    expect(configuration.parts).toHaveLength(3); for (const part of configuration.parts) { expect(part.filename).toContain(configuration.name); const file = files.find(file => file.name === part.filename)!; expect(stlSignedVolume(file.bytes)).toBeCloseTo(part.volumeMm3, 4); }
  }
  await dialog.getByRole("button", { name: "Apply Large", exact: true }).click(); await width(page, 30); expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await width(page, 20);
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click(); const saved = info.outputPath("family.pcaddoc"); await (await saving).saveAs(saved);
  const session = (await aiSnapshot(page)).session; await page.locator('input[type="file"]').first().setInputFiles(saved); await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(session); await width(page, 20);
  dialog = await openFamily(page); await dialog.getByRole("button", { name: "Edit Large", exact: true }).click(); await dialog.getByLabel("width", { exact: true }).fill("40mm"); await dialog.getByRole("button", { name: "Save configuration expressions" }).click(); await width(page, 20);
  await dialog.getByRole("checkbox", { name: "Compare Large", exact: true }).check(); await dialog.getByRole("button", { name: "Compare selected configurations", exact: true }).click(); await expect(dialog.getByRole("status")).toHaveText("Comparison complete"); await expect(dialog.getByRole("table")).toContainText("7960.000");
  await dialog.getByRole("button", { name: "Close configurations", exact: true }).click(); await width(page, 20);
});
test("legacy unitless configuration keeps native size after Apply under different unit defaults", async ({ page }) => {
  const document = JSON.parse(await readFile("src/persistence/fixtures/schema-v20.pcaddoc", "utf8")); document.unitSettings.length = "cm"; document.configurations[0].parameters[0].expression = { expression: "30", unit: "mm" };
  for (const sketch of Object.values(document.sketches) as { entities: Record<string, { type: string; x?: { expression: string; authoredUnit?: string } }> }[]) for (const entity of Object.values(sketch.entities)) if (entity.type === "point" && entity.x?.expression === "width") entity.x.authoredUnit = "mm";
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles({ name: "legacy-configuration.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) }); await width(page, 20);
  const dialog = await openFamily(page); await dialog.getByRole("checkbox", { name: "Compare Small", exact: true }).check(); await dialog.getByRole("button", { name: "Compare selected configurations", exact: true }).click(); await expect(dialog.getByRole("status")).toHaveText("Comparison complete"); await expect(dialog.getByRole("table")).toContainText("6240.000");
  await dialog.getByRole("button", { name: "Apply Small", exact: true }).click(); await width(page, 30); expect((await aiSnapshot(page)).document.parameters.width.authoredUnit).toBe("");
});
