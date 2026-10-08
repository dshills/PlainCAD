import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createBoxTemplate } from "../src/templates/templates";
import { aiSnapshot } from "./aiAcceptanceHelpers";
test.use({ storageState: { cookies: [], origins: [] } });
async function openLibrary(page: Page) {
  await page.getByText("New part", { exact: true }).click();
  await page.getByRole("button", { name: "Local part library", exact: true }).click();
  const panel = page.getByRole("region", { name: "Local part library", exact: true });
  await expect(panel.getByText("Reading or updating local parts…", { exact: true })).toHaveCount(0);
  return panel;
}
test("backs up native editable parts, downloads individual projects, previews/cancels/imports copies and inserts with independent native parameters", async ({ page }) => {
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const target = createBoxTemplate();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "backup-target.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(target)) });
  await expect(async () => { const s = await aiSnapshot(page); expect(s.document.id).toBe(target.id); expect(s.status).toBe("succeeded"); expect(s.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(80000, 6); }).toPass({ timeout: 30000 });
  const library = await openLibrary(page);
  await library.getByLabel("Name for active component").fill("Portable block");
  await library.getByRole("button", { name: "Save active component to library", exact: true }).click();
  await expect(library.getByRole("button", { name: "Download project for Portable block", exact: true })).toBeEnabled();
  const before = await aiSnapshot(page);
  const projectDownload = page.waitForEvent("download");
  await library.getByRole("button", { name: "Download project for Portable block", exact: true }).click();
  const downloadedProject = await projectDownload, projectPath = await downloadedProject.path();
  expect(downloadedProject.suggestedFilename()).toBe("Portable_block.pcaddoc"); expect(projectPath).not.toBeNull();
  const projectBytes = await readFile(projectPath!), portable = JSON.parse(projectBytes.toString());
  expect(portable.id).not.toBe(target.id); expect(portable.parameters.width.expression).toBe(target.parameters.width.expression);
  const backupDownload = page.waitForEvent("download"); await library.getByRole("button", { name: "Download library backup", exact: true }).click();
  const backup = await backupDownload, backupPath = await backup.path(); expect(backup.suggestedFilename()).toBe("PlainCAD-parts.pcadlib"); expect(backupPath).not.toBeNull();
  const backupBytes = await readFile(backupPath!), pack = JSON.parse(backupBytes.toString()); expect(pack.entries).toHaveLength(1);
  expect(pack.entries[0].thumbnail).toMatch(/^data:image\/png;base64,/);
  await library.getByRole("button", { name: "Delete saved copy of Portable block", exact: true }).click(); await expect(library).toContainText("No saved parts yet.");
  const upload = async () => library.getByLabel("Import library pack", { exact: true }).setInputFiles({ name: "portable.pcadlib", mimeType: "application/vnd.plaincad.library+json", buffer: backupBytes });
  await upload();
  const dialog = page.getByRole("dialog", { name: "Import library pack", exact: true });
  await expect(dialog.getByRole("button", { name: "Apply library pack import", exact: true })).toBeEnabled();
  await expect(dialog).toContainText("Existing saved copies are never overwritten");
  await dialog.getByRole("button", { name: "Cancel library pack import", exact: true }).click(); await expect(library).toContainText("No saved parts yet.");
  await upload(); await expect(dialog.getByRole("button", { name: "Apply library pack import", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply library pack import", exact: true }).click(); await expect(dialog).toBeHidden();
  let entries = await page.evaluate(async () => { const path = "/src/persistence/partLibrary.ts"; return (await import(path)).listLibraryParts(); });
  expect(entries).toHaveLength(1); expect(entries[0].id).not.toBe(pack.entries[0].id); expect(entries[0].text).toBe(pack.entries[0].text);
  await upload(); await expect(dialog.getByRole("button", { name: "Apply library pack import", exact: true })).toBeEnabled(); await dialog.getByRole("button", { name: "Apply library pack import", exact: true }).click();
  await expect(dialog).toBeHidden(); entries = await page.evaluate(async () => { const path = "/src/persistence/partLibrary.ts"; return (await import(path)).listLibraryParts(); });
  expect(entries).toHaveLength(2); expect(new Set(entries.map((entry: { id: string }) => entry.id)).size).toBe(2);
  const after = await aiSnapshot(page); expect(after.document).toEqual(before.document); expect(after.past).toBe(before.past);
  await library.getByRole("button", { name: "Insert Portable block at origin", exact: true }).first().click();
  const placement = page.getByRole("dialog", { name: "Place library part", exact: true });
  await expect(placement.getByRole("button", { name: "Apply library insertion", exact: true })).toBeEnabled({ timeout: 30000 });
  await placement.getByRole("button", { name: "Apply library insertion", exact: true }).click();
  await expect(async () => { const s = await aiSnapshot(page); expect(s.status).toBe("succeeded"); expect(s.result!.meshes).toHaveLength(2); for (const mesh of s.result!.meshes) { expect(mesh.geometrySource).toBe("opencascade"); expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 }); expect(mesh.geometryAssertions!.volume).toBeCloseTo(80000, 6); } }).toPass({ timeout: 30000 });
  await page.getByRole("group", { name: "Project dock tabs" }).getByRole("button", { name: "Parameters", exact: true }).click();
  const width = page.getByLabel("Parameter width_2 expression", { exact: true }); await width.fill("100mm"); await width.press("Tab");
  await expect(async () => { const s = await aiSnapshot(page); expect(s.status).toBe("succeeded"); expect(s.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(80000, 6); expect(s.result!.meshes[1].geometryAssertions!.volume).toBeCloseTo(100000, 6); }).toPass({ timeout: 30000 });
  await page.locator('input[type="file"]').first().setInputFiles({ name: "downloaded.pcaddoc", mimeType: "application/json", buffer: projectBytes });
  await expect(async () => { const s = await aiSnapshot(page); expect(s.document.id).toBe(portable.id); expect(s.status).toBe("succeeded"); expect(s.result!.meshes).toHaveLength(1); expect(s.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(80000, 6); }).toPass({ timeout: 30000 });
});
test("pack import is atomic under quota, duplicate, invalid and raced capacity failures", async ({ page }) => {
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded"); const before = await aiSnapshot(page);
  const result = await page.evaluate(async () => {
    const path = "/src/persistence/partLibrary.ts", packPath = "/src/persistence/partLibraryPack.ts", templatePath = "/src/templates/templates.ts";
    const repo = await import(path), packs = await import(packPath), source = (await import(templatePath)).createBoxTemplate();
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWv4sAAAAASUVORK5CYII=";
    const entry = repo.createLibraryEntry(source, source.rootComponentId, "Existing", png); await repo.saveLibraryPart(entry, { newOnly: true });
    const sourceEntries = [entry, { ...entry, id: "second" }], originalAdd = IDBObjectStore.prototype.add;
    let calls = 0, quota = "";
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) { if (++calls === 2) throw new DOMException("No quota", "QuotaExceededError"); return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key); };
    try { await repo.importLibraryCopies(sourceEntries); } catch (error) { quota = (error as Error).message; } finally { IDBObjectStore.prototype.add = originalAdd; }
    const afterQuota = await repo.listLibraryParts();
    const cancelledController = new AbortController(); let cancelDuringApply = "";
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      const result = key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
      queueMicrotask(() => cancelledController.abort()); return result;
    };
    try { await repo.importLibraryCopies(sourceEntries, cancelledController.signal); } catch (error) { cancelDuringApply = (error as Error).message; } finally { IDBObjectStore.prototype.add = originalAdd; }
    const afterCancelledApply = await repo.listLibraryParts();
    let duplicate = "", unsafe = "";
    try { await repo.importLibraryCopies([entry, entry]); } catch (error) { duplicate = (error as Error).message; }
    try { packs.decodeLibraryPack(JSON.stringify({ format: "plaincad-part-library", version: 1, entries: [{ ...entry, text: '{"__proto__":{}}' }] })); } catch (error) { unsafe = (error as Error).message; }
    for (let index = 0; index < 48; index++) await repo.saveLibraryPart({ ...entry, id: `existing${index}` }, { newOnly: true });
    const raced = await Promise.allSettled([repo.importLibraryCopies([entry]), repo.importLibraryCopies([entry])]);
    const count = (await repo.listLibraryParts()).length;
    const aborted = new AbortController(); aborted.abort(); let cancelled = "";
    try { await repo.importLibraryCopies([entry], aborted.signal); } catch (error) { cancelled = (error as Error).message; }
    return { quota, calls, afterQuota, cancelDuringApply, afterCancelledApply, duplicate, unsafe, raced: raced.map(item => item.status), count, cancelled, originalId: entry.id };
  });
  expect(result.quota).toContain("Browser storage is full"); expect(result.calls).toBe(2); expect(result.afterQuota).toHaveLength(1); expect(result.afterQuota[0].id).toBe(result.originalId);
  expect(result.cancelDuringApply).toContain("cancelled"); expect(result.afterCancelledApply).toEqual(result.afterQuota);
  expect(result.duplicate).toContain("duplicate"); expect(result.unsafe).toContain("unsafe key"); expect(result.raced.sort()).toEqual(["fulfilled", "rejected"]); expect(result.count).toBe(50); expect(result.cancelled).toContain("cancelled");
  const after = await aiSnapshot(page); expect(after.document).toEqual(before.document); expect(after.past).toBe(before.past);
});
