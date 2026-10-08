import { test, expect, type Page } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
async function command(page: Page, id: string) { await page.evaluate(async id => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand(id); }, id); }
async function openCoach(page: Page) { await command(page, "manufacturing.coach"); const dialog = page.getByRole("dialog", { name: "Manufacturing coach", exact: true }); await dialog.getByText("Screening thresholds", { exact: true }).click(); await dialog.getByLabel("Minimum wall (mm)").fill("3"); await dialog.getByRole("button", { name: "Fitted wall below threshold", exact: true }).click(); await expect(dialog.getByRole("status").filter({ hasText: "Native correction ready" })).toBeVisible(); return dialog; }
async function volume(page: Page, value: number) { await expect(async () => { const state = await aiSnapshot(page); expect(state.status).toBe("succeeded"); const mesh = state.result?.meshes.find(mesh => mesh.bodyId === "body:fitted-solid"); expect(mesh?.geometrySource).toBe("opencascade"); expect(mesh?.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 }); expect(mesh?.geometryAssertions?.volume).toBeCloseTo(value, 6); }).toPass({ timeout: 30000 }); }
test("native coach highlights affected bodies, cancels or applies one correction and supports undo", async ({ page }) => {
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles("src/persistence/fixtures/schema-v19.pcaddoc"); await volume(page, 2520); const before = await aiSnapshot(page);
  await page.evaluate(async () => {
    const path = "/src/state/viewerState.ts", { useViewerState } = await import(path);
    const view = useViewerState.getState();
    view.toggleBody(view.session, "body:fitted-solid", ["body:fitted-solid"]);
    view.setPresentationMode(view.session, "render");
  });
  let dialog = await openCoach(page);
  const highlighting = await page.evaluate(async () => { const path = "/src/state/useGeometryHighlight.ts"; return (await import(path)).useGeometryHighlight.getState().highlight?.bodyIds; }); expect(highlighting).toEqual(["body:fitted-solid"]);
  await expect(async () => {
    const view = await page.evaluate(async () => { const path = "/src/viewer/viewerDiagnostics.ts"; return (await import(path)).inspectViewer(); }) as ViewerSnapshot | undefined;
    expect(view?.presentation?.mode).toBe("model");
    expect(view?.meshes.find(mesh => mesh.bodyId === "body:fitted-solid")).toMatchObject({ visible: true, highlighted: true });
  }).toPass();
  expect((await aiSnapshot(page)).document).toEqual(before.document); await dialog.getByRole("button", { name: "Close manufacturing coach" }).click(); await volume(page, 2520);
  await expect(async () => {
    const view = await page.evaluate(async () => { const path = "/src/viewer/viewerDiagnostics.ts"; return (await import(path)).inspectViewer(); }) as ViewerSnapshot | undefined;
    expect(view?.presentation?.mode).toBe("render");
    expect(view?.meshes.find(mesh => mesh.bodyId === "body:fitted-solid")).toMatchObject({ visible: false, highlighted: false });
  }).toPass();
  dialog = await openCoach(page); await dialog.getByRole("button", { name: "Apply manufacturing correction" }).click(); await volume(page, 4176); expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await volume(page, 2520);
  await command(page, "manufacturing.coach"); dialog = page.getByRole("dialog", { name: "Manufacturing coach", exact: true }); await dialog.getByLabel("Process").selectOption("laser"); await expect(dialog.getByRole("button", { name: "Sheet profile not verified", exact: true })).toHaveCount(1); await dialog.getByRole("button", { name: "Close manufacturing coach" }).click();
});
test("CNC coach enlarges a native inward hole and validates exact removed material", async ({ page }) => {
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles("src/persistence/fixtures/schema-v13.pcaddoc"); await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  await command(page, "manufacturing.coach"); const dialog = page.getByRole("dialog", { name: "Manufacturing coach", exact: true }); await dialog.getByLabel("Process").selectOption("cnc"); await dialog.getByText("Screening thresholds", { exact: true }).click(); await dialog.getByLabel("Tool diameter (mm)").fill("4"); await dialog.getByRole("button", { name: "Hole smaller than selected tool", exact: true }).click(); await expect(dialog.getByRole("status").filter({ hasText: "Native correction ready" })).toBeVisible(); await dialog.getByRole("button", { name: "Apply manufacturing correction" }).click();
  await expect(async () => { const state = await aiSnapshot(page); expect(state.status).toBe("succeeded"); expect(state.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(1000 - 20 * Math.PI, 5); expect(state.result?.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 }); }).toPass({ timeout: 30000 });
});
