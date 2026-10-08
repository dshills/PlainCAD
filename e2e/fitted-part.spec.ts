import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
async function command(page: Page, id: string) { await page.evaluate(async id => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand(id); }, id); }
async function geometry(page: Page, volume: number, min = [-4, -4, -4], max = [24, 14, 7]) {
  await expect(async () => {
    const state = await aiSnapshot(page); expect(state.status).toBe("succeeded"); expect(state.result?.errors).toEqual([]);
    const mesh = state.result!.meshes.find(mesh => mesh.bodyId !== "body:first-solid" && mesh.bodyId !== "body:second-solid")!;
    expect(mesh.geometrySource).toBe("opencascade"); expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 }); expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 6);
    for (const axis of [0, 1, 2]) { expect(mesh.bounds.min[axis]).toBeCloseTo(min[axis], 5); expect(mesh.bounds.max[axis]).toBeCloseTo(max[axis], 5); }
  }).toPass({ timeout: 30000 });
}
test("create and edit native fitted styles, linked width, positioned save/open, undo and STL", async ({ page }, info) => {
  const document = JSON.parse(await readFile("src/persistence/fixtures/schema-v18.pcaddoc", "utf8")); delete document.assemblyJoints;
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles({ name: "source.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) }); await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  await command(page, "fit.create"); let dialog = page.getByRole("dialog", { name: "Build a fitted part", exact: true }); await expect(dialog.getByRole("status")).toHaveText("Native fitted preview ready");
  const before = await aiSnapshot(page); await dialog.getByRole("button", { name: "Apply fitted part" }).click(); await geometry(page, 2520); expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  const fit = (await aiSnapshot(page)).document.features.find(feature => feature.type === "fit")!;
  for (const [style, volume, min, max] of [["bracket", 1400, [-4, -4, -4], [24, 14, 5]], ["adapter", 1512, [-4, -4, -2], [24, 14, 7]], ["enclosure", 2520, [-4, -4, -4], [24, 14, 7]]] as const) {
    await command(page, "fit.edit"); dialog = page.getByRole("dialog", { name: "Edit fitted part", exact: true }); await dialog.getByLabel("Fit style").selectOption(style); await expect(dialog.getByRole("status")).toHaveText("Native fitted preview ready"); await dialog.getByRole("button", { name: "Apply fitted part" }).click(); await geometry(page, volume, [...min], [...max]);
  }
  await command(page, "fit.edit"); dialog = page.getByRole("dialog", { name: "Edit fitted part", exact: true }); await dialog.getByLabel("Wall thickness").fill("0mm"); await expect(dialog.getByRole("alert")).toContainText("wall thickness"); await expect(dialog.getByRole("button", { name: "Apply fitted part" })).toBeDisabled(); await dialog.getByRole("button", { name: "Cancel fitted part" }).click(); await geometry(page, 2520);
  await page.evaluate(async () => { const path = "/src/state/useCadStore.ts"; const store = (await import(path)).useCadStore; store.getState().updateDocument((document: CadDocument) => ({ ...document, parameters: { ...document.parameters, width: { ...document.parameters.width, expression: "30mm" } }, components: { ...document.components, "first-component": { ...document.components["first-component"], placement: { translation: [10, 20, 30], rotation: [0, 0, Math.PI / 2] } } } })); });
  await geometry(page, 3240, [-4, 16, 26], [14, 54, 37]); await page.getByRole("button", { name: "Undo", exact: true }).click(); await geometry(page, 2520); await page.getByRole("button", { name: "Redo", exact: true }).click(); await geometry(page, 3240, [-4, 16, 26], [14, 54, 37]);
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click(); const saved = info.outputPath("fitted.pcaddoc"); await (await saving).saveAs(saved); const session = (await aiSnapshot(page)).session; await page.locator('input[type="file"]').first().setInputFiles(saved); await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(session); await geometry(page, 3240, [-4, 16, 26], [14, 54, 37]);
  const exporting = page.waitForEvent("download"); await page.evaluate(async id => { const path = "/src/persistence/fileJobs.ts"; await (await import(path)).runFabrication("separate", true, [`body:${id}`]); }, fit.id); const stl = info.outputPath("fit.stl"); await (await exporting).saveAs(stl); expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(3240, 5);
});
