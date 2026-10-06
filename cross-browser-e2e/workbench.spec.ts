import { expect, test, type Page, type Locator } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { stlSignedVolume } from "../e2e/aiAcceptanceHelpers";

async function fileMenu(page: Page) {
  const menu = page.locator(".file-menu");
  if (await menu.getAttribute("open") === null) await menu.locator("summary").click();
}
async function nativeVolume(page: Page) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const component = page.getByRole("button", { name: "Activate component Browser bracket", exact: true });
  await expect(component).toBeVisible();
  if (await component.getAttribute("aria-pressed") !== "true") await component.click();
  await page.locator(".body-row").getByRole("button", { name: "Extrude 1", exact: true }).click();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.getByLabel("Task panel").selectOption("inspector");
  await expect(page.getByText("Solids", { exact: true }).locator("..").locator("dd")).toHaveText("1");
  await expect(page.getByText("Volume (mm³)", { exact: true }).locator("..").locator("dd")).toHaveText("3600.000");
}
async function outlineOrigin(page: Page) {
  const canvas = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  const bounds = await canvas.boundingBox();
  const view = (await canvas.getAttribute("viewBox"))?.trim().split(/\s+/).map(Number);
  if (!bounds || !view || view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0)
    throw new Error("Visible sketch canvas requires a valid viewBox");
  await page.mouse.click(bounds.x + (-view[0] / view[2]) * bounds.width, bounds.y + (-view[1] / view[3]) * bounds.height);
}
async function reachable(control: Locator) {
  await expect(control).toBeVisible();
  expect(await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = window.document.elementFromPoint(x, y);
    return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && Boolean(hit && (hit === element || element.contains(hit)));
  })).toBe(true);
}
function luminance(rgb: string) {
  const match = rgb.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (!match) throw new Error(`Expected resolved RGB color, received ${rgb}`);
  if (match[4] !== undefined && Number(match[4]) !== 1)
    throw new Error(`Contrast scope requires opaque computed colors, received ${rgb}`);
  const values = match.slice(1, 4).map((value) => {
    const n = Number(value) / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(foreground: string, background: string) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("keyboard-assisted non-template Draw → Make solid → native save/open/STL under CSP", async ({ page, browserName }, info) => {
  const errors: string[] = [], csp: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("captureCrossBrowserCsp", (directive: string) => { csp.push(directive); });
  await page.addInitScript(() => window.document.addEventListener("securitypolicyviolation", (event) => {
    void (window as unknown as { captureCrossBrowserCsp(directive: string): Promise<void> }).captureCrossBrowserCsp(event.effectiveDirective);
  }));
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("worker-src 'self'");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const name = page.getByLabel("Part name", { exact: true });
  await name.fill("Browser bracket");
  // macOS WebKit follows Safari's default Option-Tab policy for button traversal.
  await name.press(browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab");
  const draw = page.getByRole("button", { name: "Draw a shape", exact: true });
  await expect(draw).toBeFocused();
  await draw.press("Enter");
  await page.getByRole("button", { name: "Sketch on Top (XY) plane", exact: true }).press("Enter");
  await expect(page.getByRole("navigation", { name: "Project location" })).toContainText("Browser bracket");
  await page.getByRole("button", { name: "Draw tool: rectangle", exact: true }).click();
  await outlineOrigin(page);
  await page.getByLabel("Draft width", { exact: true }).fill("30mm");
  await page.getByLabel("Draft height", { exact: true }).fill("20mm");
  await page.getByLabel("Draft height", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).press("Enter");
  const handoff = page.getByRole("region", { name: "Make solid from finished sketch" });
  const make = handoff.getByRole("button", { name: "Make solid", exact: true });
  await expect(make).toBeEnabled();
  await make.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Extrude", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("6mm");
  await expect(dialog.getByRole("status")).toContainText("Native preview ready");
  const apply = dialog.getByRole("button", { name: "Apply extrusion", exact: true });
  await expect(apply).toBeEnabled();
  await apply.press("Enter");
  await nativeVolume(page);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).press("Enter");
  const project = info.outputPath("browser-bracket.pcaddoc");
  await (await saving).saveAs(project);
  const portable = JSON.parse(await readFile(project, "utf8"));
  expect(portable.features).toHaveLength(1);
  expect(portable.features[0]).toMatchObject({ type: "extrude", distance: { expression: "6mm" } });
  expect(Object.values(portable.components).some((component) => (component as { name: string }).name === "Browser bracket")).toBe(true);
  await fileMenu(page);
  await page.getByRole("button", { name: "New project", exact: true }).press("Enter");
  await expect(page.locator(".body-row")).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(project);
  await nativeVolume(page);
  await fileMenu(page);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).press("Enter");
  const stl = info.outputPath("browser-bracket.stl");
  await (await exporting).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(3600, 3);
  expect(errors).toEqual([]);
  expect(csp).toEqual([]);
});

test("compact Workbench start and dock controls stay reachable with keyboard and theme contrast", async ({ page, browserName }, info) => {
  await page.setViewportSize({ width: 685, height: 740 });
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const start = page.getByRole("region", { name: "Start a part" });
  const partName = start.getByLabel("Part name", { exact: true });
  const draw = start.getByRole("button", { name: "Draw a shape", exact: true });
  const parts = page.getByRole("button", { name: "Parts", exact: true });
  const details = page.getByRole("button", { name: "Toggle task dock", exact: true });
  const desktopPreference = await page.evaluate(() => localStorage.getItem("plaincad.workbench.v1"));
  await expect(parts).toHaveAttribute("aria-expanded", "false");
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await reachable(partName);
  await reachable(draw);
  expect(await page.evaluate(() => localStorage.getItem("plaincad.workbench.v1"))).toBe(desktopPreference);
  const contrasts: Array<{ theme: string; text: number; action: number }> = [];
  for (const theme of ["light", "dark", "saturn"]) {
    await page.locator(".workbench-settings > summary").click();
    await page.getByLabel("UI theme").selectOption(theme);
    await page.locator(".workbench-settings > summary").click();
    await partName.focus();
    await partName.press(browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab");
    await expect(draw).toBeFocused();
    const colors = await start.evaluate((element) => {
      const button = element.querySelector(".project-start-actions > button")!;
      const text = element.querySelector("p")!;
      return { text: getComputedStyle(text).color, surface: getComputedStyle(element).backgroundColor,
        action: getComputedStyle(button).color, actionSurface: getComputedStyle(button).backgroundColor,
        outline: getComputedStyle(button).outlineStyle, outlineWidth: getComputedStyle(button).outlineWidth };
    });
    const sample = { theme, text: contrast(colors.text, colors.surface), action: contrast(colors.action, colors.actionSurface) };
    expect(sample.text).toBeGreaterThanOrEqual(4.5);
    expect(sample.action).toBeGreaterThanOrEqual(4.5);
    expect(colors.outline).not.toBe("none");
    expect(Number.parseFloat(colors.outlineWidth)).toBeGreaterThanOrEqual(2);
    contrasts.push(sample);
    await reachable(draw);
  }
  const contrastPath = info.outputPath("theme-contrast.json");
  await writeFile(contrastPath, JSON.stringify(contrasts, null, 2));
  await info.attach("theme-contrast", { path: contrastPath, contentType: "application/json" });
  await parts.press("Enter");
  await expect(parts).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("complementary", { name: "Parts browser" })).toBeVisible();
  await details.press("Enter");
  await expect(parts).toHaveAttribute("aria-expanded", "false");
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("complementary", { name: "Parts browser" })).toBeHidden();
  await page.getByRole("button", { name: "Close Details", exact: true }).press("Enter");
  await expect(details).toBeFocused();
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await reachable(partName);
  await reachable(draw);
  // Equivalent layout space to a 1366 × 900 desktop viewport reduced at 200%
  // browser zoom. This checks responsive reachability, not actual OS/browser zoom.
  await page.setViewportSize({ width: 683, height: 450 });
  await draw.scrollIntoViewIfNeeded();
  await reachable(draw);
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth)).toBeLessThanOrEqual(683);
});
