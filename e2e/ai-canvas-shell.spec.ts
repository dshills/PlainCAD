import { expect, test } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { createBoxTemplate } from "../src/templates/templates";

for (const [layout, theme] of [["workbench", "saturn"], ["focused", "dark"], ["full", "light"]] as const) {
  test(`AI shares the ${layout} native canvas without resizing or changing geometry`, async ({ page }, info) => {
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
    await prompt.fill("An instrument bracket with mounting holes");
    expect(await prompt.evaluate(input => Boolean(input.closest(".viewer-region")))).toBe(true);
    expect(await canvas.boundingBox()).toEqual(bounds);
    const overlay = await page.locator(".ai-canvas-assistant").boundingBox();
    expect(overlay).not.toBeNull();
    expect(bounds).not.toBeNull();
    expect(overlay!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
    expect(overlay!.x + overlay!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    expect(overlay!.y).toBeGreaterThanOrEqual(bounds!.y - 1);
    expect(overlay!.y + overlay!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
    await page.screenshot({ path: info.outputPath(`ai-canvas-${layout}.png`) });
    await prompt.press("Escape");
    await expect(page.getByRole("button", { name: "Open AI assistant", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
    await expect(prompt).toHaveValue("An instrument bracket with mounting holes");
    expect(await canvas.boundingBox()).toEqual(bounds);
    const after = await aiSnapshot(page);
    expect(after.document).toEqual(before.document);
    expect(after.result?.meshes).toEqual(before.result?.meshes);
    expect(after.past).toBe(before.past);
    if (layout === "workbench") await expect(page.locator(".workbench-bottom")).not.toHaveClass(/expanded/);
    expect(errors).toEqual([]);
  });
}
