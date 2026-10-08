import { expect, test } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { aiPlatePlan } from "../src/tests/fixtures/aiPlan";
import { createBoxTemplate } from "../src/templates/templates";

for (const [layout, theme] of [["workbench", "saturn"], ["focused", "dark"], ["full", "light"]] as const) {
  test(`AI uses the ${layout} bottom dock without changing native geometry`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ layout, theme }) => {
      localStorage.setItem("plaincad.workspace.v1", JSON.stringify({ version: 1, layout, pins: [] }));
      localStorage.setItem("plaincad.ui.theme", theme);
    }, { layout, theme });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.locator('input[type="file"]').setInputFiles({ name: "Box.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(createBoxTemplate())) });
    await expect(async () => {
      const state = await aiSnapshot(page);
      expect(state.status).toBe("succeeded");
      expect(state.result?.meshes[0].geometrySource).toBe("opencascade");
      expect(state.result?.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(state.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(80000, 6);
    }).toPass();
    const before = await aiSnapshot(page);
    const canvas = page.locator(".model-view canvas");
    const bounds = await canvas.boundingBox();
    await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
    const prompt = page.getByLabel("What would you like to make?", { exact: true });
    await expect(prompt).toBeVisible();
    await expect(prompt).toBeFocused();
    await expect(page.locator(".ai-drawer-header")).not.toBeVisible();
    await prompt.fill("An instrument bracket with mounting holes");
    expect(await prompt.evaluate(input => Boolean(input.closest("#workbench-ai.bottom-dock-body")))).toBe(true);
    const overlay = await page.locator(".workbench-bottom").boundingBox();
    expect(overlay).not.toBeNull();
    expect(bounds).not.toBeNull();
    const dockedCanvas = await canvas.boundingBox();
    expect(dockedCanvas).not.toBeNull();
    expect(overlay!.y).toBeGreaterThanOrEqual(dockedCanvas!.y + dockedCanvas!.height - 1);
    expect(await page.locator(".viewer-region #workbench-ai").count()).toBe(0);
    const inputBounds = await prompt.boundingBox();
    expect(inputBounds!.x).toBeGreaterThanOrEqual(overlay!.x);
    expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(overlay!.x + overlay!.width + 1);
    const handle = page.getByRole("separator", { name: "Resize bottom dock" });
    const height = Number(await handle.getAttribute("aria-valuenow"));
    await handle.focus(); await handle.press("Shift+ArrowUp");
    await expect(handle).toHaveAttribute("aria-valuenow", String(height + 32));
    if (layout === "workbench") {
      await page.getByRole("button", { name: "History", exact: true }).click();
      await expect(prompt).not.toBeVisible();
      await expect(page.getByRole("heading", { name: "Parametric Timeline" })).toBeVisible();
      await page.getByRole("button", { name: "Issues", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Rebuild" })).toBeVisible();
      await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
      await expect(prompt).toHaveValue("An instrument bracket with mounting holes");
      await expect(prompt).toBeFocused();
    }
    await page.screenshot({ path: info.outputPath(`ai-canvas-${layout}.png`) });
    await prompt.press("Escape");
    await expect(page.getByRole("button", { name: "Open AI assistant", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
    await expect(prompt).toHaveValue("An instrument bracket with mounting holes");
    await expect(prompt).toBeFocused();
    await page.getByRole("button", { name: "Close bottom dock", exact: true }).click();
    await expect(prompt).not.toBeVisible();
    await expect.poll(async () => (await canvas.boundingBox())?.height).toBe(bounds!.height);
    const after = await aiSnapshot(page);
    expect(after.document).toEqual(before.document);
    expect(after.result?.meshes).toEqual(before.result?.meshes);
    expect(after.past).toBe(before.past);
    await expect(page.locator(".workbench-bottom")).not.toHaveClass(/expanded/);
    expect(errors).toEqual([]);
  });
}

test("switching from docked AI to History cancels native proposals and rejects a delayed response", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("plaincad.workspace.v1", JSON.stringify({ version: 1, layout: "workbench", pins: [] })));
  let respond: (() => void) | undefined;
  let responseHandled = false;
  await page.route("**/api/ai/status", route => route.fulfill({ json: { providers: ["anthropic", "openai", "google"].map(id => ({ id, label: id, available: true, model: "test-model" })) } }));
  await page.route("**/api/ai/generate", route => route.fulfill({ json: { plan: aiPlatePlan } }));
  await page.goto("/");
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  const before = await aiSnapshot(page);
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  const panel = page.getByRole("region", { name: "AI modeling assistant" });
  const prompt = panel.getByLabel("What would you like to make?"), generate = panel.getByRole("button", { name: "Generate preview", exact: true });
  await prompt.fill(aiPlatePlan.summary); await generate.click();
  await expect(panel.getByRole("button", { name: "Apply AI component", exact: true })).toBeEnabled({ timeout: 60000 });
  const nativeProposal = await page.evaluate(async () => {
    const path = "/src/state/aiCanvasPreview.ts";
    return (await import(path)).useAiCanvasPreview.getState().preview?.result;
  });
  expect(nativeProposal?.meshes).toHaveLength(1);
  expect(nativeProposal?.meshes[0].geometrySource).toBe("opencascade");
  expect(nativeProposal?.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(nativeProposal?.meshes[0].geometryAssertions?.volume).toBeCloseTo(12000 - Math.PI * 2 ** 2 * 5, 5);
  await expect.poll(async () => page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return Boolean((await import(path)).inspectViewer()?.aiPreview);
  })).toBe(true);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(prompt).not.toBeVisible();
  await expect.poll(async () => page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return Boolean((await import(path)).inspectViewer()?.aiPreview);
  })).toBe(false);
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await page.unroute("**/api/ai/generate");
  await page.route("**/api/ai/generate", async route => {
    await new Promise<void>(resolve => { respond = resolve; });
    await route.fulfill({ json: { plan: aiPlatePlan } }).catch(() => {});
    responseHandled = true;
  });
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  await generate.click(); await expect.poll(() => Boolean(respond)).toBe(true);
  await page.getByRole("button", { name: "Issues", exact: true }).click();
  respond!();
  await expect.poll(() => responseHandled).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole("heading", { name: "Rebuild" })).toBeVisible();
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply AI component", exact: true })).toBeDisabled();
  expect(await page.evaluate(async () => {
    const path = "/src/state/aiCanvasPreview.ts";
    return Boolean((await import(path)).useAiCanvasPreview.getState().preview);
  })).toBe(false);
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
});
