import { test, expect } from "@playwright/test";

// Exercise the compact dock, independently of the full-layout acceptance default.
test.use({ storageState: { cookies: [], origins: [] } });

test("compact Parts rows support keyboard activation, contextual isolation, and descendant search without modeling edits", async ({ page }, info) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("docs/examples/01-cable-guide.pcaddoc");
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    return (await import(path)).useCadStore.getState().rebuild.status;
  })).toBe("succeeded");
  const original = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return { document: JSON.stringify(state.history.present), result: state.rebuild.result, past: state.history.past.length };
  });
  expect(original.result.success).toBe(true);
  expect(original.result.meshes).toHaveLength(2);
  for (const mesh of original.result.meshes) {
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(mesh.geometryAssertions.volume).toBeGreaterThan(0);
  }
  const browser = page.getByRole("complementary", { name: "Parts browser" });
  const root = browser.getByRole("button", { name: "Activate component Project reference", exact: true });
  const rootNode = root.locator("xpath=../..");
  await expect(rootNode.locator(".browser-folder")).toHaveCount(0);
  await expect(browser.getByText("Origin", { exact: true })).toHaveCount(0);
  const activate = browser.getByRole("button", { name: "Activate component Cable collar", exact: true });
  await activate.focus();
  await page.keyboard.press("Enter");
  await expect(activate).toHaveAttribute("aria-pressed", "true");
  const row = activate.locator("..");
  const rowBox = await row.boundingBox();
  expect(rowBox!.height).toBeLessThanOrEqual(44);
  const checkboxBox = (await row.getByLabel("Show component Cable collar", { exact: true }).boundingBox())!;
  expect(checkboxBox.y).toBeGreaterThanOrEqual(rowBox!.y);
  expect(checkboxBox.y + checkboxBox.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height);
  expect(checkboxBox.x).toBeGreaterThanOrEqual(rowBox!.x);
  expect(checkboxBox.x + checkboxBox.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
  const actions = browser.getByLabel("Actions for component Cable collar", { exact: true });
  await expect(browser.getByRole("button", { name: "Isolate component Cable collar", exact: true })).toBeHidden();
  await actions.focus();
  await page.keyboard.press("Enter");
  await expect(browser.getByRole("button", { name: "Isolate component Cable collar", exact: true })).toBeVisible();
  await browser.getByRole("button", { name: "Isolate component Cable collar", exact: true }).click();
  await expect(actions).toBeFocused();
  await expect(browser.getByLabel("Show component Mounting foot", { exact: true })).not.toBeChecked();
  await browser.getByRole("button", { name: "Exit isolation", exact: true }).click();
  await expect(browser.getByLabel("Show component Mounting foot", { exact: true })).toBeChecked();
  await actions.click();
  await page.keyboard.press("Escape");
  await expect(browser.getByRole("button", { name: "Isolate component Cable collar", exact: true })).toBeHidden();
  await expect(actions).toBeFocused();
  await actions.click();
  await browser.getByLabel("Search project").click();
  await expect(browser.getByRole("button", { name: "Isolate component Cable collar", exact: true })).toBeHidden();
  await browser.getByLabel("Search project").fill("rounded foot outline");
  await expect(browser.getByRole("button", { name: "Activate component Cable collar", exact: true })).toBeHidden();
  await expect(browser.getByRole("button", { name: /Rounded foot outline/ })).toBeVisible();
  await browser.getByRole("button", { name: "Collapse component Mounting foot", exact: true }).click();
  await expect(browser.getByRole("button", { name: /Rounded foot outline/ })).toHaveCount(0);
  await browser.getByLabel("Search project").fill("");
  const unchanged = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return { document: JSON.stringify(state.history.present), result: state.rebuild.result, past: state.history.past.length };
  });
  expect(unchanged).toEqual(original);
  // Leaving an unfinished rename must apply it before the native details closes.
  await actions.click();
  const name = browser.getByLabel("Component name", { exact: true });
  await name.fill("Cable collar revised");
  await browser.getByLabel("Search project").click();
  await expect(browser.getByRole("button", { name: "Activate component Cable collar revised", exact: true })).toBeVisible();
  const revisedActions = browser.getByLabel("Actions for component Cable collar revised", { exact: true });
  await revisedActions.click();
  await name.fill("Cancel this rename");
  await name.press("Escape");
  await expect(browser.getByRole("button", { name: "Activate component Cable collar revised", exact: true })).toBeVisible();
  await expect(revisedActions).toBeFocused();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(activate).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    return (await import(path)).useCadStore.getState().rebuild.status;
  })).toBe("succeeded");
  await page.screenshot({ path: info.outputPath("compact-parts-browser.png"), fullPage: true });
});
