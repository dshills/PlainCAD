import { expect, test, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

async function nativeSnapshot(page: Page) {
  // This is a development-native test, matching the other e2e source-module
  // helpers. Production acceptance is covered separately by the release gate.
  return page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts";
    const viewerPath = "/src/viewer/viewerDiagnostics.ts";
    const state = (await import(storePath)).useCadStore.getState();
    return {
      document: state.history.present,
      past: state.history.past.length,
      rebuild: state.rebuild,
      viewer: (await import(viewerPath)).inspectViewer(),
    };
  });
}

async function tokenColor(page: Page, name: string) {
  return page.evaluate((token) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}

async function changeTheme(page: Page, theme: string) {
  if (await page.locator(".workbench-settings").getAttribute("open") === null)
    await page.locator(".workbench-settings > summary").click();
  await page.getByLabel("UI theme", { exact: true }).selectOption(theme);
  await page.locator(".workbench-settings > summary").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

test("Saturn instrument treatments preserve workbench controls, native geometry and reduced-motion rendering", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.locator(".file-menu > summary").click();
  await page.getByRole("button", { name: "Load parametric box template" }).click();
  await expect(async () => {
    const state = await nativeSnapshot(page);
    expect(state.rebuild.status).toBe("succeeded");
    expect(state.rebuild.result?.meshes[0]).toMatchObject({
      geometrySource: "opencascade",
      geometryAssertions: { valid: true, solidCount: 1 },
    });
    expect(state.rebuild.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(80000, 5);
    expect(state.viewer?.meshes).toHaveLength(1);
  }).toPass();
  await page.getByRole("button", { name: "Parameters", exact: true }).click();
  const values = page.locator(".parameter-value");
  await expect(values.first()).toBeVisible();
  const before = await nativeSnapshot(page);
  const dockBounds = await page.locator(".workbench-left").boundingBox();
  const toolNames = await page.locator(".workbench-context-commands button").allTextContents();
  await changeTheme(page, "saturn");
  const saturn = await nativeSnapshot(page);
  expect(saturn.document).toEqual(before.document);
  expect(saturn.past).toBe(before.past);
  expect(saturn.rebuild).toEqual(before.rebuild);
  expect(saturn.viewer?.meshes).toEqual(before.viewer?.meshes);
  expect(await page.locator(".workbench-left").boundingBox()).toEqual(dockBounds);
  expect(await page.locator(".workbench-context-commands button").allTextContents()).toEqual(toolNames);
  const readout = await values.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { numeric: style.fontVariantNumeric, shadow: style.textShadow, background: style.backgroundColor };
  });
  expect(readout.numeric.split(" ")).toEqual(expect.arrayContaining(["tabular-nums", "slashed-zero"]));
  expect(readout.background).toBe(await tokenColor(page, "--surface"));
  expect(readout.shadow).not.toBe("none");
  const active = page.getByRole("button", { name: "Solid", exact: true });
  await active.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(active).toBeFocused();
  expect(await active.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  await page.screenshot({ path: info.outputPath("saturn-command-readouts.png") });

  // Failure styling follows a genuine invalid parameter rebuild; it cannot
  // remain a green "success" instrument after the geometry becomes invalid.
  const width = page.getByLabel("Parameter width expression", { exact: true });
  await width.fill("unknown_parameter");
  await width.press("Enter");
  await expect(page.locator(".rebuild-pill")).toHaveText("failed");
  expect(await page.locator(".rebuild-pill").evaluate((element) => getComputedStyle(element).color)).toBe(await tokenColor(page, "--error"));
  await width.fill("100mm");
  await width.press("Enter");
  await expect(async () => {
    const state = await nativeSnapshot(page);
    expect(state.rebuild.status).toBe("succeeded");
    expect(state.rebuild.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(100000, 5);
  }).toPass();
  await changeTheme(page, "dark");
  expect(await values.first().evaluate((element) => getComputedStyle(element).textShadow)).toBe("none");
  await changeTheme(page, "light");
  expect(await values.first().evaluate((element) => getComputedStyle(element).textShadow)).toBe("none");
  await page.emulateMedia({ forcedColors: "active" });
  await changeTheme(page, "saturn");
  for (const selector of [".parameter-value", ".parameter-card input", ".workbench-header", ".workbench-left", ".workbench-bottom", ".docked-workbench .panel", ".workbench-modes button[aria-pressed='true']"]) {
    expect(await page.locator(selector).first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { textShadow: style.textShadow, boxShadow: style.boxShadow, backgroundImage: style.backgroundImage };
    })).toEqual({ textShadow: "none", boxShadow: "none", backgroundImage: "none" });
  }
  expect(errors).toEqual([]);
});
