import { expect, test, type Page } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";

async function selectFirstBody(page: Page, showAll = false) {
  await page.evaluate(async (restore) => {
    const storePath = "/src/state/useCadStore.ts", viewerPath = "/src/state/viewerState.ts";
    const state = (await import(storePath)).useCadStore.getState();
    if (restore) (await import(viewerPath)).useViewerState.getState().showAllBodies(state.documentSession);
    state.select({ kind: "body", id: state.rebuild.result!.bodies[0].id, documentId: state.history.present.id });
  }, showAll);
}

test("native canvas contextual actions support keyboard menus, hide, base editing and one-step undo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.evaluate(async () => { const tp = "/src/templates/templates.ts", sp = "/src/state/useCadStore.ts"; (await import(sp)).useCadStore.getState().setDocument((await import(tp)).createBoxTemplate()); });
  await expect(async () => { const state = await aiSnapshot(page); expect(state.status).toBe("succeeded"); expect(state.result?.meshes).toHaveLength(1); }).toPass();
  const before = await aiSnapshot(page);
  expect(before.result?.meshes[0].geometrySource).toBe("opencascade");
  expect(before.result?.meshes[0].geometryAssertions?.valid).toBe(true);
  const volume = before.result!.meshes[0].geometryAssertions!.volume;
  await selectFirstBody(page);
  const toolbar = page.getByRole("toolbar", { name: "Selected geometry actions" }); await expect(toolbar).toBeVisible();
  const canvas = page.getByLabel("3D modeling canvas", { exact: true });
  await canvas.focus(); await canvas.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Canvas actions" }); await expect(menu).toBeVisible();
  await page.keyboard.press("End"); await expect(menu.getByRole("menuitem", { name: "Close menu" })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(menu).not.toBeVisible(); await expect(canvas).toBeFocused();
  await toolbar.getByRole("button", { name: "Hide part", exact: true }).click(); await expect(toolbar).not.toBeVisible();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await selectFirstBody(page, true);
  await toolbar.getByRole("button", { name: "More actions" }).click();
  await menu.getByRole("menuitem", { name: "Delete base feature…" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete base feature", exact: true });
  await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await toolbar.getByRole("button", { name: "Edit base feature", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Extrude/i })).toBeVisible();
  await page.getByRole("dialog", { name: /Extrude/i }).getByRole("button", { name: /Cancel/i }).click();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ button: "right", position: { x: box!.width / 2, y: box!.height / 2 } });
  await expect(menu).toBeVisible(); await page.keyboard.press("Escape");
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down({ button: "right" }); await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2 + 20, { steps: 5 }); await page.mouse.up({ button: "right" });
  await expect(menu).not.toBeVisible();
  await canvas.dblclick({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await expect(page.getByRole("dialog", { name: /Extrude/i })).toBeVisible();
  await page.getByRole("dialog", { name: /Extrude/i }).getByRole("button", { name: /Cancel/i }).click();
  await selectFirstBody(page);
  await toolbar.getByRole("button", { name: "More actions" }).click(); await menu.getByRole("menuitem", { name: "Delete base feature…" }).click();
  await confirm.getByRole("button", { name: "Delete base feature", exact: true }).click();
  await expect(async () => expect((await aiSnapshot(page)).document.features).toHaveLength(before.document.features.length - 1)).toPass();
  await page.evaluate(async () => { const path = "/src/state/useCadStore.ts"; (await import(path)).useCadStore.getState().undo(); });
  await expect(async () => { const after = await aiSnapshot(page); expect(after.document).toEqual(before.document); expect(after.status).toBe("succeeded"); expect(after.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(volume, 5); }).toPass();
  expect(errors).toEqual([]);
});
