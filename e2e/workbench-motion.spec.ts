import { expect, test } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";

test("native edit confirmation follows changed geometry and reduced-motion disables workbench effects", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  await expect(async () => {
    const snapshot = await aiSnapshot(page);
    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.result?.meshes[0].geometrySource).toBe("opencascade");
    expect(snapshot.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(80000, 6);
  }).toPass();
  await expect(page.locator(".model-update-feedback")).toBeAttached();
  expect(await page.getByRole("button", { name: "Render view", exact: true }).evaluate((button) => getComputedStyle(button).transitionDuration)).toBe("0s");
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.getState().updateParameter("depth", { expression: "25mm" });
  });
  await expect(async () => {
    const snapshot = await aiSnapshot(page);
    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(100000, 6);
  }).toPass();
  await expect(page.getByText("✓ Model updated", { exact: true })).toBeVisible();
  expect(await page.locator(".model-update-confirmation").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await expect(page.getByText("✓ Model updated", { exact: true })).toHaveCount(0);
  const before = await aiSnapshot(page);
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer()?.performance?.scheduled;
  })).toBe(false);
  const frames = await page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer()?.performance?.frameCount;
  });
  await page.waitForTimeout(250);
  expect(await page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer()?.performance?.frameCount;
  })).toBe(frames);
  expect((await aiSnapshot(page)).past).toBe(before.past);
});
