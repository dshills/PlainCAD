import { test, expect, type Page } from "@playwright/test";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../src/cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../src/cad/sketch/SketchModel";
import { evaluateParameters } from "../src/cad/parameters/expressionEvaluator";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import type { WorkerResponse } from "../src/cad/worker/workerProtocol";
import type { CadDocument } from "../src/cad/document/schema";

test.use({ storageState: { cookies: [], origins: [] } });
declare global {
  interface Window {
    statusDelivery: { holdNext: boolean; held: boolean; pending: number; release?: () => void };
  }
}
function fixture() {
  let document = upsertParameter(createEmptyDocument("Free rectangle status"), { id: "width-parameter", name: "width", expression: "20mm", unit: "mm", value: 20 });
  const sketch = addCornerRectangle(createXySketch("Free rectangle"), "width", "10mm");
  document = upsertSketch(document, sketch);
  const profile = detectProfiles(solveSketch(sketch, evaluateParameters(document.parameters).values)).profiles[0];
  return upsertFeature(document, createExtrudeFeature({ name: "Rectangle solid", sketchId: sketch.id, profileId: profile.id,
    operation: "newBody", direction: "positive", distance: { expression: "5mm", unit: "mm" } }));
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return { document: state.history.present as CadDocument, status: state.rebuild.status, result: state.rebuild.result, session: state.documentSession };
  });
}
async function nativeVolume(page: Page, volume: number) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.errors).toEqual([]);
    expect(state.result?.meshes).toHaveLength(1);
    expect(state.result?.meshes[0]).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } });
    expect(state.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(volume, 5);
  }).toPass();
}
async function open(page: Page, document: CadDocument) {
  await page.locator('input[type="file"]').setInputFiles({ name: "status.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
}

test("native free sketch success, deliberate parameter rename, stale readouts, invalid dimensions and same-ID replacement", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const delivery = window.statusDelivery = { holdNext: false, held: false, pending: 0 } as Window["statusDelivery"];
    const NativeWorker = window.Worker;
    const heldResults: (() => void)[] = [];
    window.Worker = class extends NativeWorker {
      override set onmessage(listener: ((this: Worker, event: MessageEvent) => unknown) | null) {
        super.onmessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === "rebuildResult" && delivery.holdNext) {
            delivery.holdNext = false;
            delivery.held = true;
            heldResults.push(() => listener?.call(this, event));
            delivery.pending = heldResults.length;
            delivery.release = () => {
              heldResults.shift()?.();
              delivery.pending = heldResults.length;
              delivery.held = delivery.pending > 0;
            };
          } else listener?.call(this, event);
        };
      }
      override get onmessage() { return super.onmessage; }
    };
  });
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const document = fixture();
  await open(page, document);
  await nativeVolume(page, 1000);
  await expect(page.getByRole("button", { name: "Issues", exact: true })).not.toHaveClass(/has-issues/);
  await page.getByRole("button", { name: "Issues", exact: true }).click();
  await expect(page.getByText("No rebuild issues.", { exact: true })).toBeVisible();
  await page.getByText("Optional sketch guidance (1)", { exact: true }).click();
  await expect(page.getByText(/Free rectangle: Underconstrained sketch/)).toBeVisible();
  await page.getByRole("button", { name: "Parameters", exact: true }).click();
  const computed = page.getByLabel("Computed parameter width", { exact: true });
  await expect(computed).toHaveText("20.0000 mm");
  await expect(page.getByLabel("Parameter width name", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Rename parameter width", exact: true }).click();
  await expect(page.getByLabel("Parameter width name", { exact: true })).toBeFocused();
  await page.getByLabel("Parameter width name", { exact: true }).press("Escape");
  await page.getByRole("button", { name: "Rename parameter width", exact: true }).click();
  await page.evaluate(() => { window.statusDelivery.holdNext = true; });
  const expression = page.getByLabel("Parameter width expression", { exact: true });
  await expression.fill("40mm");
  await expression.press("Enter");
  await expect.poll(() => page.evaluate(() => window.statusDelivery.held)).toBe(true);
  await expect(computed).toHaveText("Updating… Previous: 20.0000 mm (stale)");
  await expect(page.locator(".file-menu").getByRole("button", { name: "Export STL", exact: true, includeHidden: true })).toBeDisabled();
  await page.evaluate(() => window.statusDelivery.release!());
  await nativeVolume(page, 2000);
  await expect(computed).toHaveText("40.0000 mm");
  await expression.fill("missing_width");
  await expression.press("Enter");
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(computed).toHaveText("Unavailable");
  await expect(page.locator(".parameter-card .error-text")).toContainText("missing_width");
  await expect(page.locator("#workbench-issues-toggle")).toHaveClass(/has-issues/);
  await expect(page.locator(".file-menu").getByRole("button", { name: "Export STL", exact: true, includeHidden: true })).toBeDisabled();
  await expression.fill("40mm");
  await expression.press("Enter");
  await nativeVolume(page, 2000);
  await page.evaluate(() => { window.statusDelivery.holdNext = true; });
  await expression.fill("60mm");
  await expression.press("Enter");
  await expect.poll(() => page.evaluate(() => window.statusDelivery.held)).toBe(true);
  await expect(computed).toHaveText("Updating… Previous: 40.0000 mm (stale)");
  const before = await snapshot(page);
  await page.evaluate(() => { window.statusDelivery.holdNext = true; });
  await open(page, document);
  await expect.poll(async () => (await snapshot(page)).session).toBe(before.session + 1);
  await expect.poll(() => page.evaluate(() => window.statusDelivery.pending)).toBe(2);
  await expect(page.getByLabel("Computed parameter width", { exact: true })).toHaveText("Updating…");
  await page.evaluate(() => window.statusDelivery.release!());
  await expect(page.getByLabel("Computed parameter width", { exact: true })).toHaveText("Updating…");
  await page.evaluate(() => window.statusDelivery.release!());
  await nativeVolume(page, 1000);
  await expect(page.getByLabel("Computed parameter width", { exact: true })).toHaveText("20.0000 mm");
  expect(errors).toEqual([]);
});
