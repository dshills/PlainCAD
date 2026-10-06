import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { workbenchTaskFixture, type WorkbenchOperation } from "../e2e/workbenchTaskFixtures";
import { stlSignedVolume } from "../e2e/aiAcceptanceHelpers";

test.use({ storageState: { cookies: [], origins: [] } });

async function openFileMenu(page: Page) {
  const menu = page.locator(".file-menu");
  if (await menu.getAttribute("open") === null) await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
}

async function volume(page: Page, bodyName: string) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.locator(".body-row").getByRole("button", { name: bodyName, exact: true }).click();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.getByLabel("Task panel").selectOption("inspector");
  await expect(page.getByText("Solids", { exact: true }).locator("..").locator("dd")).toHaveText("1");
  const value = page.getByText("Volume (mm³)", { exact: true }).locator("..").locator("dd");
  await expect(value).toHaveText(/^\d+(\.\d+)?$/);
  const measured = Number(await value.textContent());
  expect(Number.isFinite(measured)).toBe(true);
  return measured;
}

const operations: Array<{ type: WorkbenchOperation; dimension: string; feature: string; value: string; expected?: number }> = [
  { type: "Extrude", dimension: "thickness", feature: "Base", value: "10mm", expected: 3840 },
  { type: "Revolve", dimension: "angle", feature: "Sweep", value: "180deg", expected: 125 * Math.PI },
  { type: "Hole", dimension: "diameter", feature: "Drill", value: "4mm", expected: (24 * 16 - 4 * Math.PI) * 8 },
  { type: "Fillet", dimension: "radius", feature: "Round", value: "2mm" },
  { type: "Chamfer", dimension: "bevel size", feature: "Bevel", value: "2mm" },
];
for (const operation of operations) {
  test(`default workbench edits ${operation.type} via a solid dimension and saves/reopens/exports real geometry under CSP`, async ({ page }, info) => {
    const errors: string[] = [], violations: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.exposeFunction("captureWorkbenchCsp", (directive: string) => { violations.push(directive); });
    await page.addInitScript(() => window.document.addEventListener("securitypolicyviolation", (event) => {
      void (window as unknown as { captureWorkbenchCsp(directive: string): Promise<void> }).captureWorkbenchCsp(event.effectiveDirective);
    }));
    const response = await page.goto("/");
    expect(response?.headers()["content-security-policy"]).toContain("worker-src 'self'");
    const fixture = workbenchTaskFixture(operation.type);
    const bodyName = operation.type === "Hole" ? "Base" : operation.feature;
    await page.locator('input[type="file"]').setInputFiles({ name: "fixture.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
    const before = await volume(page, bodyName);
    expect(before).toBeGreaterThan(0);
    const label = page.getByRole("button", { name: `Edit solid ${operation.dimension} for ${operation.feature}`, exact: true });
    await label.press("Enter");
    const dialog = page.getByRole("dialog", { name: `Edit solid ${operation.dimension}`, exact: true });
    await dialog.getByLabel("Dimension expression", { exact: true }).fill(operation.value);
    await expect(dialog.getByRole("status")).toContainText("Native preview ready");
    await dialog.getByRole("button", {
      name: "Cancel",
      exact: true,
    }).click();
    await expect(dialog).toBeHidden();
    await expect(async () => {
      expect(Math.abs(await volume(page, bodyName) - before)).toBeLessThan(0.0011);
    }).toPass({ timeout: 30000 });
    await label.click();
    await dialog.getByLabel("Dimension expression", { exact: true }).fill(operation.value);
    const apply = dialog.getByRole("button", { name: "Apply dimension", exact: true });
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(dialog).toBeHidden();
    let after = 0;
    await expect(async () => {
      after = await volume(page, bodyName);
      expect(Math.abs(after - before)).toBeGreaterThan(0.001);
      if (operation.expected !== undefined) expect(Math.abs(after - operation.expected)).toBeLessThan(0.001);
      else expect(after).toBeLessThan(before);
    }).toPass({ timeout: 30000 });
    const saving = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    const project = info.outputPath(`${operation.type}.pcaddoc`);
    await (await saving).saveAs(project);
    const portable = JSON.parse(await readFile(project, "utf8"));
    expect(portable.features.map((f: { id: string }) => f.id)).toEqual(fixture.features.map((f) => f.id));
    // Reopen into an observably empty project so the old successful rebuild
    // cannot satisfy the round-trip assertion before the saved file loads.
    await openFileMenu(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await expect(page.locator(".body-row")).toHaveCount(0);
    await page.locator('input[type="file"]').setInputFiles(project);
    await expect(async () => {
      expect(Math.abs(await volume(page, bodyName) - after)).toBeLessThan(0.0011);
    }).toPass({ timeout: 30000 });
    await openFileMenu(page);
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath(`${operation.type}.stl`);
    await (await exporting).saveAs(stl);
    // The small 5 mm radius half-cylinder's fixed export tessellation differs by
    // 0.16% from its exact BRep volume. Other fixtures remain within 0.1%.
    expect(Math.abs(stlSignedVolume(await readFile(stl)) / after - 1)).toBeLessThan(operation.type === "Revolve" ? 0.002 : 0.001);
    expect(errors).toEqual([]);
    expect(violations).toEqual([]);
  });
}

test("default workbench keyboard dock controls and compact navigation work in all three themes", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toHaveClass(/docked-workbench/);
  await page.locator(".workbench-settings > summary").click();
  for (const theme of ["light", "dark", "saturn"]) {
    await page.getByLabel("UI theme").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
  await page.locator(".workbench-settings > summary").click();
  const resize = page.getByRole("separator", { name: "Resize left dock" });
  const initialWidth = Number(await resize.getAttribute("aria-valuenow"));
  await resize.press("ArrowRight");
  await expect.poll(async () => Number(await resize.getAttribute("aria-valuenow"))).toBeGreaterThan(initialWidth);
  await page.setViewportSize({ width: 900, height: 740 });
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Parts browser" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Workspace details" })).toBeHidden();
  await page.getByRole("button", { name: "Toggle task dock" }).click();
  await expect(page.getByRole("complementary", { name: "Workspace details" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Parts browser" })).toBeHidden();
});
