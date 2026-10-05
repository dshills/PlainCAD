import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  aiSnapshot,
  stlSignedVolume,
  assertAiAcceptanceViewer,
} from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";
// Exercise actual first-use preferences, independently of the legacy full-workspace suite.
test.use({ storageState: { cookies: [], origins: [] } });
async function volume(page: Page, expected: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.success).toBe(true);
    expect(state.result?.meshes).toHaveLength(1);
    const mesh = state.result!.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(
      Math.abs(mesh.geometryAssertions!.volume / expected - 1),
    ).toBeLessThan(1e-7);
  }).toPass({ timeout: 30000 });
}
async function clickLocal(page: Page, x: number, y: number) {
  const svg = page.getByRole("group", {
    name: "Sketch drawing canvas",
    exact: true,
  });
  const bounds = await svg.boundingBox();
  if (!bounds) throw new Error("Drawing canvas unavailable");
  const view = (await svg.getAttribute("viewBox"))!.split(/\s+/).map(Number);
  await svg.click({
    position: {
      x: ((x - view[0]) / view[2]) * bounds.width,
      y: ((-y - view[1]) / view[3]) * bounds.height,
    },
  });
}
test("focused mouse sketch, native extrude/cut, parameter edit, save/open and STL work without the full workspace", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect(page.getByLabel("Workspace layout")).toHaveValue("focused");
  await expect(
    page.getByRole("heading", { name: "Dependencies" }),
  ).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Parametric Timeline" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page
    .getByRole("button", { name: "Sketch on XY plane", exact: true })
    .click();
  await page
    .getByLabel("Canvas tool", { exact: true })
    .selectOption("rectangle");
  await clickLocal(page, -10, -5);
  await clickLocal(page, 10, 5);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
  await applyExtrusion(page);
  await volume(page, 1000);
  const initial = await aiSnapshot(page);
  const base = initial.result!.meshes[0].bodyId;
  const bodyName = initial.result!.bodies.find((b) => b.id === base)!.name;
  await page
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sketch on XY plane", exact: true })
    .click();
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("circle");
  await clickLocal(page, 0, 0);
  await clickLocal(page, 2, 0);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Extrude", exact: true });
  await dialog
    .getByLabel("Extrude operation", { exact: true })
    .selectOption("cut");
  await dialog
    .getByLabel("Extrude termination", { exact: true })
    .selectOption("throughAll");
  await dialog.getByRole("checkbox", { name: bodyName, exact: true }).check();
  await applyExtrusion(page);
  await volume(page, (200 - 4 * Math.PI) * 5);
  await page.getByLabel("Task panel").selectOption("parameters");
  await page
    .getByRole("button", { name: "Add Parameter", exact: true })
    .click();
  await page.getByLabel("Task panel").selectOption("auto");
  await page.getByRole("button", { name: /^History \(/ }).click();
  const doc = (await aiSnapshot(page)).document;
  const history = page.getByRole("list", {
    name: "Sketch and feature history",
  });
  await history
    .getByRole("button")
    .filter({ has: page.getByText(doc.features[0].name, { exact: true }) })
    .click();
  await page.getByLabel("Distance", { exact: true }).fill("param_1");
  await page.getByLabel("Distance", { exact: true }).press("Enter");
  await volume(page, (200 - 4 * Math.PI) * 10);
  await page.getByLabel("Task panel").selectOption("parameters");
  await page
    .getByLabel("Parameter param_1 expression", { exact: true })
    .fill("6mm");
  await page
    .getByLabel("Parameter param_1 expression", { exact: true })
    .press("Enter");
  await volume(page, (200 - 4 * Math.PI) * 6);
  const finalMesh = (await aiSnapshot(page)).result!.meshes[0];
  expect(finalMesh.bodyId).toBe(base);
  // Native BRep bounds include a small modeling tolerance. Verify orientation in mm.
  for (const [actual, expected] of [
    [finalMesh.bounds.min, [-10, -5, 0]],
    [finalMesh.bounds.max, [10, 5, 6]],
  ] as const) {
    actual.forEach((value, axis) =>
      expect(Math.abs(value - expected[axis])).toBeLessThan(1e-6),
    );
  }
  await assertAiAcceptanceViewer(page, 1);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("focused.pcaddoc");
  await (await save).saveAs(path);
  const json = JSON.parse(await readFile(path, "utf8"));
  function assertDurableKeys(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      expect([
        "workspace",
        "activePanel",
        "pins",
        "kernelHandle",
        "sheet",
        "partsOpen",
        "historyOpen",
      ]).not.toContain(key);
      assertDurableKeys(child);
    }
  }
  assertDurableKeys(json);
  const before = await aiSnapshot(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await aiSnapshot(page)).session)
    .toBeGreaterThan(before.session);
  await volume(page, (200 - 4 * Math.PI) * 6);
  const exportFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("focused.stl");
  await (await exportFile).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(
    (200 - 4 * Math.PI) * 6,
    0,
  );
  await page.screenshot({ path: info.outputPath("focused-model.jpg") });
});
test("AI settings, full access, pins and layout persistence preserve the current document", async ({
  page,
}) => {
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      json: {
        providers: ["anthropic", "openai", "google"].map((id) => ({
          id,
          label: id,
          model: `test-${id}`,
          available: false,
        })),
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const before = await aiSnapshot(page);
  await page.getByRole("button", { name: "Describe a part with AI" }).click();
  const drawer = page.getByRole("region", { name: "AI modeling assistant" });
  await expect(drawer.getByLabel("AI provider", { exact: true })).toBeHidden();
  await expect(
    drawer.getByText(/key not configured; open AI settings/),
  ).toBeVisible();
  await drawer.getByText("AI settings", { exact: true }).click();
  await expect(drawer.getByLabel("AI provider", { exact: true })).toBeVisible();
  await drawer
    .getByRole("button", { name: "Close AI drawer", exact: true })
    .click();
  await page.getByLabel("Task panel").selectOption("parameters");
  await page.getByRole("button", { name: "Pin Parameters panel" }).click();
  await page.getByLabel("Task panel").selectOption("views");
  await expect(page.getByRole("heading", { name: "Parameters" })).toBeVisible();
  await page.getByLabel("Workspace layout").selectOption("full");
  await expect(
    page.getByRole("heading", { name: "Dependencies" }),
  ).toBeVisible();
  await page.getByLabel("Workspace layout").selectOption("focused");
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await page.reload();
  await expect(page.getByLabel("Workspace layout")).toHaveValue("focused");
  await expect(
    page.getByRole("button", { name: "Pin Parameters panel" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "All tools", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Filter commands" }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Filter commands" })
    .fill("Create XZ");
  await expect(
    page
      .getByRole("dialog", { name: "Command Palette" })
      .getByRole("button", { name: /Create XZ Sketch/ }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "All tools", exact: true }),
  ).toBeFocused();
});
test("compact focused layout keeps the start canvas and one details sheet usable across themes", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Start a part" }),
  ).toBeVisible();
  for (const theme of ["light", "dark", "saturn"]) {
    await page.getByText("Settings", { exact: true }).click();
    await page.getByLabel("UI theme", { exact: true }).selectOption(theme);
    await page.getByText("Settings", { exact: true }).click();
    await page.getByRole("button", { name: "Parts", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Parts browser" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pin Parts panel" }).click();
    await page.getByLabel("Task panel").selectOption("views");
    await expect(
      page.getByRole("complementary", { name: "Parts browser" }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Parts", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Parts", exact: true }).click();
    await page.getByRole("button", { name: "Pin Parts panel" }).click();
    await page.getByRole("button", { name: "Close Parts" }).click();
    await expect(
      page.getByRole("button", { name: "Parts", exact: true }),
    ).toBeFocused();
    await page.getByLabel("Task panel").selectOption("views");
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(760);
    await page.getByLabel("Task panel").selectOption("auto");
    await page.screenshot({ path: info.outputPath(`focused-${theme}.jpg`) });
  }
});
