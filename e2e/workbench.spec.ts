import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  aiSnapshot,
  assertAiAcceptanceViewer,
  stlSignedVolume,
} from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";

test.use({ storageState: { cookies: [], origins: [] } });
async function nativeVolume(page: Page, expected: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.errors).toEqual([]);
    expect(state.result?.meshes).toHaveLength(1);
    const mesh = state.result!.meshes[0];
    expect(mesh).toMatchObject({
      geometrySource: "opencascade",
      geometryAssertions: { valid: true, solidCount: 1 },
    });
    expect(mesh.geometryAssertions!.volume).toBeCloseTo(expected, 5);
    expect(mesh.bounds.min[2]).toBeCloseTo(0, 6);
  }).toPass({ timeout: 30000 });
}
async function clickLocal(page: Page, x: number, y: number) {
  const canvas = page.getByRole("group", {
    name: "Sketch drawing canvas",
    exact: true,
  });
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  const viewBox = await canvas.getAttribute("viewBox");
  if (!rect || !viewBox)
    throw new Error("Sketch canvas or coordinate mapping unavailable");
  const view = viewBox.split(/\s+/).map(Number);
  await page.mouse.click(
    rect.x + ((x - view[0]) / view[2]) * rect.width,
    rect.y + ((-y - view[1]) / view[3]) * rect.height,
  );
}
test("default workbench preserves native mouse modeling, docked distance previews, explicit apply and portable STL", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect(page.locator(".app-shell")).toHaveClass(/docked-workbench/);
  await page.getByRole("button", { name: "Close Parts", exact: true }).click();
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page
    .getByRole("button", { name: "Sketch on Top (XY) plane", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Workspace details" }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Draw tool: rectangle", exact: true })
    .click();
  await clickLocal(page, 0, 0);
  await page.getByLabel("Draft width", { exact: true }).fill("60mm");
  await page.getByLabel("Draft height", { exact: true }).fill("40mm");
  await page.getByLabel("Draft height", { exact: true }).press("Enter");
  await page
    .getByRole("button", { name: "Draw tool: circle", exact: true })
    .click();
  await clickLocal(page, 20, 20);
  await page.getByLabel("Draft diameter", { exact: true }).fill("6mm");
  await page.getByLabel("Draft diameter", { exact: true }).press("Enter");
  await expect(page.locator(".canvas-driving-dimension").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Extrude", exact: true });
  await expect(dialog).toHaveClass(/docked-model-dialog/);
  await dialog.getByLabel("Extrude distance").fill("8mm");
  await expect(dialog.getByRole("status")).toContainText(
    "Native preview ready",
  );
  const before = await aiSnapshot(page);
  expect(before.document.features).toHaveLength(0);
  const handle = dialog.getByRole("button", {
    name: "Drag extrusion distance",
    exact: true,
  });
  await expect(handle).toBeVisible();
  await handle.press("ArrowUp");
  await expect(dialog.getByLabel("Extrude distance")).toHaveValue("9mm");
  await expect(dialog.getByRole("status")).toContainText(
    "Native preview ready",
  );
  await dialog.getByLabel("Extrude distance").fill("invalid_length");
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  await dialog.getByLabel("Extrude distance").fill("8mm");
  await page.setViewportSize({ width: 480, height: 820 });
  await expect(async () => {
    const preview = await dialog.locator(".extrude-preview").boundingBox();
    expect(preview?.height).toBeCloseTo(220, 0);
    const task = await dialog.boundingBox();
    expect(task?.x).toBe(0);
  }).toPass();
  await dialog.getByLabel("Extrude distance").scrollIntoViewIfNeeded();
  await expect(dialog.getByLabel("Extrude distance")).toBeInViewport();
  const inputBounds = await dialog.getByLabel("Extrude distance").boundingBox();
  const scrollBounds = await dialog
    .locator(".extrude-dialog-layout")
    .boundingBox();
  expect(inputBounds!.y).toBeGreaterThanOrEqual(scrollBounds!.y);
  expect(inputBounds!.y + inputBounds!.height).toBeLessThanOrEqual(
    scrollBounds!.y + scrollBounds!.height,
  );
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 900 });
  await applyExtrusion(page);
  const expected = (60 * 40 - Math.PI * 3 * 3) * 8;
  await nativeVolume(page, expected);
  await assertAiAcceptanceViewer(page, 1);
  const after = await aiSnapshot(page);
  expect(after.past).toBe(before.past + 1);
  expect(after.result!.meshes[0].bounds.max[2]).toBeCloseTo(8, 5);
  // Advanced stays open when its own termination control returns to Distance.
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await dialog.getByLabel("Extrude operation").selectOption("cut");
  await dialog
    .getByRole("group", { name: "Extrude target bodies" })
    .getByRole("checkbox")
    .first()
    .check();
  await dialog.locator(".ds-advanced > summary").click();
  await dialog.getByLabel("Extrude termination").click();
  await dialog.getByLabel("Extrude termination").selectOption("throughAll");
  await dialog.getByLabel("Extrude termination").selectOption("distance");
  await expect(dialog.locator(".ds-advanced")).toHaveAttribute("open", "");
  await expect(dialog.getByLabel("Extrude termination")).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await aiSnapshot(page)).past).toBe(after.past);
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page
    .getByRole("group", { name: "Project dock tabs" })
    .getByRole("button", { name: "Parameters", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Parameters", exact: true }),
  ).toBeVisible();
  const separator = page.getByRole("separator", { name: "Resize left dock" });
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "264");
  expect((await aiSnapshot(page)).past).toBe(after.past);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const projectPath = info.outputPath("workbench.pcaddoc");
  await (await saved).saveAs(projectPath);
  const portable = JSON.parse(await readFile(projectPath, "utf8"));
  expect(portable.features).toHaveLength(1);
  expect(JSON.stringify(portable)).not.toContain("leftWidth");
  await page.locator('input[type="file"]').setInputFiles(projectPath);
  await nativeVolume(page, expected);
  await page.locator(".file-menu > summary").click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath("workbench.stl");
  await (await downloaded).saveAs(stlPath);
  // Curved surfaces are tessellated for STL; keep its relative volume error below 0.01%.
  expect(
    Math.abs(stlSignedVolume(await readFile(stlPath)) / expected - 1),
  ).toBeLessThan(0.0001);
  expect(errors).toEqual([]);
});
test("docks keep uncommitted parameter drafts, searchable project items, one detail panel and theme-independent layout", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const project = page.getByRole("complementary", { name: "Parts browser" });
  await project
    .getByRole("button", { name: "Parameters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add Parameter", exact: true })
    .click();
  const expression = page.getByLabel("Parameter param_1 expression", {
    exact: true,
  });
  await expression.fill("22mm");
  // Switch layout without committing the expression through its blur handler.
  await page.evaluate(async () => {
    const path = "/src/state/useWorkbenchState.ts";
    (await import(path)).useWorkbenchState.getState().showLeft("project");
  });
  await expect(expression).toBeHidden();
  await project
    .getByRole("button", { name: "Parameters", exact: true })
    .click();
  await expect(expression).toHaveValue("22mm");
  await project.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByLabel("Search project").fill("no such component");
  await expect(
    project.getByRole("button", { name: "Collapse component Root Component" }),
  ).toBeHidden();
  await page.getByLabel("Search project").fill("");
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.getByLabel("Task panel").selectOption("views");
  await expect(
    page.getByRole("heading", { name: "Views", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Task panel").selectOption("measure");
  await expect(
    page.getByRole("heading", { name: "Views", exact: true }),
  ).toBeHidden();
  await page.locator(".workbench-settings > summary").click();
  for (const theme of ["dark", "saturn", "light"]) {
    await page.getByLabel("UI theme").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".app-shell")).toHaveClass(/docked-workbench/);
  }
  await page.locator(".workbench-settings > summary").click();
  await page.setViewportSize({ width: 900, height: 740 });
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await expect(project).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Workspace details" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Toggle task dock" }).click();
  await page.getByRole("button", { name: "Toggle task dock" }).click();
  await expect(
    page.getByRole("complementary", { name: "Workspace details" }),
  ).toBeVisible();
  await expect(project).toBeHidden();
});
