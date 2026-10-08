import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createBoxTemplate } from "../src/templates/templates";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { PART_LIBRARY_LIMITS } from "../src/persistence/partLibrary";

test.use({ storageState: { cookies: [], origins: [] } });
async function openLibrary(page: Page) {
  await page.getByText("New part", { exact: true }).click();
  await page.getByRole("button", { name: "Local part library", exact: true }).click();
  const library = page.getByRole("region", { name: "Local part library", exact: true });
  await expect(library).toBeVisible();
  await expect(library.getByText("Reading or updating local parts…", { exact: true })).toHaveCount(0);
  return library;
}
test("persists an editable native part and thumbnail, drags to XY placement, previews/cancels/applies, undo/redoes and saves/exports actual placed geometry", async ({ page }) => {
  const target = createBoxTemplate();
  const load = async () => {
    const before = (await aiSnapshot(page)).session;
    await page.locator('input[type="file"]').first().setInputFiles({ name: "target.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(target)) });
    await expect(async () => {
      const snapshot = await aiSnapshot(page);
      expect(snapshot.session).toBeGreaterThan(before); expect(snapshot.document.id).toBe(target.id); expect(snapshot.status).toBe("succeeded");
      expect(snapshot.result?.meshes).toHaveLength(1); expect(snapshot.result!.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
      expect(snapshot.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(80000, 6);
    }).toPass({ timeout: 30000 });
  };
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded"); await load();
  let library = await openLibrary(page);
  await library.getByLabel("Name for active component").fill("Workflow block");
  await library.getByRole("button", { name: "Save active component to library", exact: true }).click();
  await expect(library.getByRole("button", { name: "Insert Workflow block at origin", exact: true })).toBeEnabled();
  const image = library.getByRole("img", { name: "Workflow block native geometry thumbnail" });
  await expect(async () => expect(await image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight])).toEqual([192, 192])).toPass();
  expect((await aiSnapshot(page)).past).toBe(0);
  await library.getByRole("button", { name: "Close library", exact: true }).click();
  await page.reload(); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded"); await load();
  library = await openLibrary(page);
  await expect(library.getByRole("button", { name: "Insert Workflow block at origin", exact: true })).toBeEnabled();
  const viewport = page.locator("div.viewer-canvas > canvas.viewer-canvas");
  await expect(viewport).toBeVisible();
  const rect = await viewport.boundingBox();
  expect(rect).not.toBeNull();
  if (!rect) throw new Error("The visible CAD viewport has no bounds for XY part placement.");
  const dropPoint = await page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).projectViewerPoint([-50, -25, 0]);
  });
  expect(dropPoint).toBeDefined();
  if (!dropPoint) throw new Error("The XY placement point cannot be projected into the visible model.");
  expect(dropPoint.x).toBeGreaterThan(0); expect(dropPoint.x).toBeLessThan(rect.width);
  expect(dropPoint.y).toBeGreaterThan(0); expect(dropPoint.y).toBeLessThan(rect.height);
  await library.getByRole("listitem").dragTo(viewport, { sourcePosition: { x: 8, y: 8 }, targetPosition: { x: dropPoint.x, y: dropPoint.y } });
  const dialog = page.getByRole("dialog", { name: "Place library part", exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole("button", { name: "Apply library insertion", exact: true })).toBeEnabled({ timeout: 30000 });
  const staged = await page.evaluate(async () => {
    const path = "/src/ui/commands/partLibraryState.ts";
    const placement = (await import(path)).usePartLibrary.getState().frame!.placement!;
    return { origin: placement.origin, result: placement.result, candidate: placement.candidate, componentId: placement.componentId };
  });
  // Native drag events quantize client coordinates to CSS pixels. Verify the
  // intended world location and its sub-two-pixel screen projection; exact
  // bounds below are checked against the actual resulting placement.
  expect(Math.abs(staged.origin.x + 50)).toBeLessThan(1);
  expect(Math.abs(staged.origin.y + 25)).toBeLessThan(1);
  expect(staged.origin.z).toBeCloseTo(0, 8);
  const projectedOrigin = await page.evaluate(async origin => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).projectViewerPoint([origin.x, origin.y, origin.z]);
  }, staged.origin);
  expect(projectedOrigin).toBeDefined();
  if (!projectedOrigin) throw new Error("The native insertion origin cannot be projected.");
  expect(Math.hypot(projectedOrigin.x - dropPoint.x, projectedOrigin.y - dropPoint.y)).toBeLessThan(2);
  expect(staged.candidate.components[staged.componentId].placement!.translation).toEqual([staged.origin.x, staged.origin.y, staged.origin.z]);
  expect(staged.result!.meshes).toHaveLength(2);
  for (const mesh of staged.result!.meshes) { expect(mesh.geometrySource).toBe("opencascade"); expect(mesh.geometryAssertions!.volume).toBeCloseTo(80000, 6); }
  expect((await aiSnapshot(page)).document.features).toHaveLength(1);
  await dialog.getByRole("button", { name: "Cancel placement", exact: true }).click();
  expect((await aiSnapshot(page)).document.features).toHaveLength(1); expect((await aiSnapshot(page)).past).toBe(0);
  await library.getByRole("button", { name: "Insert Workflow block at origin", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Apply library insertion", exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(dialog).toContainText("X 0.000 mm, Y 0.000 mm, Z 0.000 mm");
  await dialog.getByRole("button", { name: "Cancel placement", exact: true }).click();
  await library.getByRole("listitem").dragTo(viewport, { sourcePosition: { x: 8, y: 8 }, targetPosition: { x: dropPoint.x, y: dropPoint.y } });
  await expect(dialog.getByRole("button", { name: "Apply library insertion", exact: true })).toBeEnabled({ timeout: 30000 });
  const origin = await page.evaluate(async () => { const path = "/src/ui/commands/partLibraryState.ts"; return (await import(path)).usePartLibrary.getState().frame!.placement!.origin; });
  await dialog.getByRole("button", { name: "Apply library insertion", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(async () => {
    const snapshot = await aiSnapshot(page); expect(snapshot.document.id).toBe(target.id); expect(snapshot.status).toBe("succeeded"); expect(snapshot.past).toBe(1); expect(snapshot.result!.meshes).toHaveLength(2);
    expect(snapshot.result!.meshes[1].bounds.min[0]).toBeCloseTo(origin.x - 40, 6); expect(snapshot.result!.meshes[1].bounds.max[1]).toBeCloseTo(origin.y + 25, 6);
    expect(snapshot.result!.meshes[1].geometryAssertions!.volume).toBeCloseTo(80000, 6);
  }).toPass({ timeout: 30000 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(async () => { const snapshot = await aiSnapshot(page); expect(snapshot.status).toBe("succeeded"); expect(snapshot.result!.meshes).toHaveLength(1); }).toPass();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(async () => { const snapshot = await aiSnapshot(page); expect(snapshot.status).toBe("succeeded"); expect(snapshot.result!.meshes).toHaveLength(2); }).toPass();
  await page.getByRole("group", { name: "Project dock tabs" }).getByRole("button", { name: "Parameters", exact: true }).click();
  const width = page.getByLabel("Parameter width_2 expression", { exact: true }); await width.fill("100mm"); await width.press("Tab");
  await expect(async () => { const snapshot = await aiSnapshot(page); expect(snapshot.status).toBe("succeeded"); expect(snapshot.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(80000, 6); expect(snapshot.result!.meshes[1].geometryAssertions!.volume).toBeCloseTo(100000, 6); expect(snapshot.result!.meshes[1].bounds.min[0]).toBeCloseTo(origin.x - 50, 6); }).toPass();
  const saved = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click(); const savedPath = await (await saved).path(); expect(savedPath).not.toBeNull();
  const savedBytes = await readFile(savedPath!), before = (await aiSnapshot(page)).session;
  await page.locator('input[type="file"]').first().setInputFiles({ name: "placed-library.pcaddoc", mimeType: "application/json", buffer: savedBytes });
  await expect(async () => { const snapshot = await aiSnapshot(page); expect(snapshot.session).toBeGreaterThan(before); expect(snapshot.status).toBe("succeeded"); expect(snapshot.past).toBe(0); expect(snapshot.document.parameters.width_2.expression).toBe("100mm"); expect(snapshot.result!.meshes[1].bounds.min[0]).toBeCloseTo(origin.x - 50, 6); }).toPass();
  const bodyId = (await aiSnapshot(page)).result!.meshes[1].bodyId, exported = page.waitForEvent("download");
  await page.evaluate(async id => { const path = "/src/persistence/fileJobs.ts"; await (await import(path)).runFabrication("separate", true, [id]); }, bodyId);
  const exportPath = await (await exported).path(); expect(exportPath).not.toBeNull();
  expect(Math.abs(stlSignedVolume(await readFile(exportPath!)) - 100000) / 100000).toBeLessThan(0.0001);
});

test("atomic IndexedDB entry limits and quota errors preserve stored parts and the open project", async ({ page }) => {
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const before = await aiSnapshot(page);
  const results = await page.evaluate(async () => {
    const libraryPath = "/src/persistence/partLibrary.ts", templatePath = "/src/templates/templates.ts";
    const repository = await import(libraryPath), source = (await import(templatePath)).createBoxTemplate();
    const thumbnail = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWv4sAAAAASUVORK5CYII=";
    const entry = repository.createLibraryEntry(source, source.rootComponentId, "Storage part", thumbnail);
    for (let index = 0; index < repository.PART_LIBRARY_LIMITS.entries - 1; index++) await repository.saveLibraryPart({ ...entry, id: `bounded${index}` }, { newOnly: true });
    const raced = await Promise.allSettled([repository.saveLibraryPart({ ...entry, id: "lastA" }, { newOnly: true }), repository.saveLibraryPart({ ...entry, id: "lastB" }, { newOnly: true })]);
    const list = await repository.listLibraryParts();
    const removed = list[0]; await repository.deleteLibraryPart(removed.id);
    let quotaMessage = ""; const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException("No quota", "QuotaExceededError"); };
    try { await repository.saveLibraryPart({ ...entry, id: "quotaNew" }, { newOnly: true }); } catch (error) { quotaMessage = (error as Error).message; } finally { IDBObjectStore.prototype.put = original; }
    const afterQuota = await repository.listLibraryParts();
    let collided = "";
    try { await repository.saveLibraryPart(afterQuota[0], { newOnly: true }); } catch (error) { collided = (error as Error).message; }
    await repository.deleteLibraryPart(afterQuota[0].id);
    let missingRename = "";
    try { await repository.saveLibraryPart({ ...afterQuota[0], name: "Renamed elsewhere" }, { existingOnly: true }); } catch (error) { missingRename = (error as Error).message; }
    const afterRename = await repository.listLibraryParts();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(repository.PART_LIBRARY_DB, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction(repository.PART_LIBRARY_STORE, "readwrite"), store = transaction.objectStore(repository.PART_LIBRARY_STORE);
        ["outOfBandA", "outOfBandB", "outOfBandC"].forEach(id => store.put({ ...entry, id }));
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
    const partial = await repository.listLibrarySnapshot();
    await repository.deleteLibraryPart(partial.entries[0].id);
    const nextPage = await repository.listLibrarySnapshot();
    return { raced: raced.map(result => result.status), rejected: raced.filter(result => result.status === "rejected").map(result => String((result as PromiseRejectedResult).reason)), count: list.length, quotaCount: afterQuota.length, quotaMessage, collided, missingRename, renameCount: afterRename.length, partial: { count: partial.entries.length, limited: partial.limited }, nextPage: { count: nextPage.entries.length, limited: nextPage.limited } };
  });
  expect(results.raced.sort()).toEqual(["fulfilled", "rejected"]); expect(results.rejected[0]).toContain("50 parts"); expect(results.count).toBe(PART_LIBRARY_LIMITS.entries);
  expect(results.quotaCount).toBe(PART_LIBRARY_LIMITS.entries - 1); expect(results.quotaMessage).toContain("Browser storage is full"); expect(results.collided).toContain("collided");
  expect(results.missingRename).toContain("deleted in another tab"); expect(results.renameCount).toBe(PART_LIBRARY_LIMITS.entries - 2);
  expect(results.partial).toEqual({ count: PART_LIBRARY_LIMITS.entries, limited: true }); expect(results.nextPage).toEqual({ count: PART_LIBRARY_LIMITS.entries, limited: false });
  const after = await aiSnapshot(page); expect(after.document).toEqual(before.document); expect(after.past).toBe(before.past);
});

test("damaged stored copies can be deleted through recovery UI without importing unsafe content or changing the open model", async ({ page }) => {
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const target = createBoxTemplate();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "recovery-target.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(target)) });
  await expect(async () => {
    const snapshot = await aiSnapshot(page); expect(snapshot.document.id).toBe(target.id); expect(snapshot.status).toBe("succeeded"); expect(snapshot.result?.meshes).toHaveLength(1);
    expect(snapshot.result!.meshes[0].geometrySource).toBe("opencascade");
  }).toPass({ timeout: 30000 });
  const before = await aiSnapshot(page);
  await page.evaluate(async () => {
    const libraryPath = "/src/persistence/partLibrary.ts", templatePath = "/src/templates/templates.ts";
    const repository = await import(libraryPath), source = (await import(templatePath)).createBoxTemplate();
    const thumbnail = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWv4sAAAAASUVORK5CYII=";
    const entry = repository.createLibraryEntry(source, source.rootComponentId, "Healthy block", thumbnail);
    await repository.saveLibraryPart(entry, { newOnly: true });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(repository.PART_LIBRARY_DB, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction(repository.PART_LIBRARY_STORE, "readwrite");
        transaction.objectStore(repository.PART_LIBRARY_STORE).put({ ...entry, id: "corruptSaved", text: '{"__proto__":{}}' });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
    let strictError = "";
    try { await repository.saveLibraryPart({ ...entry, id: "cannotWriteUntilRepaired" }, { newOnly: true }); } catch (error) { strictError = (error as Error).message; }
    if (!strictError.includes("damaged saved copy")) throw new Error("Damaged storage must refuse writes until repaired.");
  });
  let library = await openLibrary(page);
  await expect(library.getByRole("button", { name: "Save active component to library", exact: true })).toBeDisabled();
  await expect(library.getByRole("button", { name: "Insert Healthy block at origin", exact: true })).toBeEnabled();
  await expect(library).toContainText("unsafe key __proto__");
  await library.getByRole("button", { name: "Delete damaged saved copy Damaged saved entry corruptSaved", exact: true }).click();
  await expect(library.getByRole("button", { name: "Save active component to library", exact: true })).toBeEnabled();
  await expect(library.getByRole("region", { name: "Recover local part library" })).toHaveCount(0);
  const recovered = await page.evaluate(async () => { const path = "/src/persistence/partLibrary.ts"; return (await import(path)).listLibrarySnapshot(); });
  expect(recovered.entries).toHaveLength(1); expect(recovered.damaged).toEqual([]); expect(recovered.limited).toBe(false);
  await library.getByRole("button", { name: "Close library", exact: true }).click();
  await page.evaluate(async () => {
    const path = "/src/persistence/partLibrary.ts", repository = await import(path), entry = (await repository.listLibraryParts())[0];
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(repository.PART_LIBRARY_DB, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, transaction = database.transaction(repository.PART_LIBRARY_STORE, "readwrite");
        transaction.objectStore(repository.PART_LIBRARY_STORE).put({ ...entry, id: new Date("2020-01-01T00:00:00Z") });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
  });
  library = await openLibrary(page);
  await expect(library).toContainText("This storage key cannot be deleted individually");
  const reset = library.getByRole("button", { name: "Delete all saved library copies", exact: true });
  await expect(reset).toBeDisabled();
  await library.getByRole("checkbox", { name: /Delete all saved library copies permanently/ }).check();
  await expect(reset).toBeEnabled(); await reset.click();
  await expect(library).toContainText("No saved parts yet.");
  const after = await aiSnapshot(page); expect(after.document).toEqual(before.document); expect(after.past).toBe(before.past);
});
