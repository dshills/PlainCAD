import { expect, test, type Locator, type Page } from "@playwright/test";
import { workbenchTaskFixture } from "../e2e/workbenchTaskFixtures";

async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await expect.poll(() => control.evaluate((element) => {
    const box = element.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && Boolean(hit && (hit === element || element.contains(hit)));
  }), { message: "Named control must be reachable without an overlapping surface" }).toBe(true);
}
async function fixture(page: Page) {
  const cadDocument = workbenchTaskFixture("Extrude");
  const sketch = Object.values(cadDocument.sketches)[0];
  if (!sketch) throw new Error("The authored fixture requires a sketch");
  const line = Object.values(sketch.entities).find((entity) => entity.type === "line");
  if (!line) throw new Error("The authored fixture requires a line entity");
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "editing-accessibility.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(cadDocument)) });
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  return { lineId: line.id };
}
async function editSketch(page: Page) {
  const parts = page.getByRole("button", { name: "Parts", exact: true });
  if (await parts.getAttribute("aria-expanded") !== "true") await parts.press("Enter");
  await page.getByRole("button", { name: /^Section XY plane, \d+ entities$/ }).press("Enter");
  if (await parts.getAttribute("aria-expanded") === "true") await parts.press("Enter");
  await page.getByRole("button", { name: "Draw", exact: true }).press("Enter");
  const edit = page.getByRole("navigation", { name: "Main CAD commands" }).getByRole("button", { name: "Edit sketch canvas", exact: true });
  await reachable(edit); await edit.press("Enter");
  await expect(page.getByRole("region", { name: "Sketch canvas", exact: true })).toBeVisible();
}

test("compact editing has reachable named controls, keyboard relation cancellation, trim validation and reflow", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 685, height: 740 });
  const { lineId } = await fixture(page);
  await editSketch(page);
  const finish = page.getByRole("button", { name: "Finish Sketch", exact: true });
  const select = page.getByRole("button", { name: "Draw tool: select", exact: true });
  for (const widthHeight of [{ width: 685, height: 740 }, { width: 683, height: 450 }]) {
    await page.setViewportSize(widthHeight);
    await reachable(finish); await reachable(select);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(widthHeight.width);
    const controls = page.locator(".sketch-workspace-controls");
    await expect(controls).toBeVisible();
    await select.press("Enter");
    const item = page.getByLabel("Selected sketch item", { exact: true });
    await reachable(item); await item.selectOption(lineId);
    const relations = page.getByRole("region", { name: "Selected geometry relations", exact: true });
    const horizontal = relations.getByRole("button", { name: "Preview Horizontal", exact: true });
    await reachable(horizontal); await horizontal.press("Enter");
    await expect(relations.getByRole("status", { name: "Constraint preview status" })).toContainText("Native constraint preview ready");
    const apply = relations.getByRole("button", { name: "Apply relation", exact: true });
    await reachable(apply); await expect(apply).toBeEnabled();
    await apply.press("Escape");
    await expect(apply).toHaveCount(0);
    await expect(horizontal).toBeFocused();
    const trim = page.getByRole("button", { name: "Trim sketch lines", exact: true });
    await reachable(trim); await trim.press("Enter");
    const trimPanel = page.getByRole("region", { name: "Trim sketch lines", exact: true });
    const previewTrim = trimPanel.getByRole("button", { name: "Preview trim", exact: true });
    await reachable(previewTrim); await previewTrim.press("Enter");
    await expect(trimPanel.getByRole("alert")).toContainText("enter both pick coordinates");
    await expect(trimPanel.getByRole("status", { name: "Trim extend status" })).toContainText("unchanged");
    await expect(trimPanel.getByRole("button", { name: "Apply trim", exact: true })).toBeDisabled();
    await previewTrim.press("Escape");
    await expect(trimPanel).toHaveCount(0); await expect(trim).toBeFocused();
  }
  expect(errors).toEqual([]);
  await info.attach("responsive-scope", { body: "685×740 compact viewport and 683×450 reduced layout space. Neither is an actual browser or OS zoom test. Keyboard-assisted named-control activation; no screen-reader speech inspection.", contentType: "text/plain" });
});

test("keyboard face cards expose target/direction and compact dimension dialog exposes validation with contained focus", async ({ page, browserName }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page);
  await page.getByRole("button", { name: "Draw", exact: true }).press("Enter");
  const drawOnFace = page.getByRole("button", { name: "Draw on face", exact: true });
  await reachable(drawOnFace); await drawOnFace.press("Enter");
  const picker = page.getByRole("region", { name: "Draw on a face", exact: true });
  const drawHere = picker.getByRole("button", { name: "Draw here", exact: true });
  await expect(drawHere).toBeDisabled();
  const face = picker.getByRole("group", { name: "Supported pocket faces" }).getByRole("button").first();
  await face.focus(); await face.press("Enter");
  await expect(face).toHaveAttribute("aria-pressed", "true");
  await expect(picker.getByRole("status")).toContainText("Cut direction: inward");
  await expect(drawHere).toBeEnabled();
  await picker.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  await expect(picker).toHaveCount(0);
  await page.locator(".body-row").getByRole("button", { name: "Base", exact: true }).press("Enter");
  const label = page.getByRole("button", { name: "Edit solid thickness for Base", exact: true });
  await label.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit solid thickness", exact: true });
  const expression = dialog.getByLabel("Dimension expression", { exact: true });
  await expect(expression).toBeFocused();
  await expression.fill("-1mm");
  await expect(dialog.getByRole("alert")).toContainText("positive");
  await expect(dialog.getByRole("button", { name: "Apply dimension", exact: true })).toBeDisabled();
  await expression.fill("10mm");
  await expect(dialog.getByRole("status")).toContainText("Native preview ready");
  for (const size of [{ width: 685, height: 740 }, { width: 683, height: 450 }]) {
    await page.setViewportSize(size);
    const apply = dialog.getByRole("button", { name: "Apply dimension", exact: true });
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await reachable(apply); await reachable(cancel);
    await expression.focus();
    const focusPositions = new Set<number>();
    for (let step = 0; step < 6; step += 1) {
      // macOS Safari traverses buttons with Option-Tab under its default keyboard policy.
      await page.keyboard.press(browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      focusPositions.add(await dialog.evaluate((element) => Array.from(element.querySelectorAll("*")).indexOf(document.activeElement!)));
    }
    expect(focusPositions.size, "Keyboard traversal must move among dialog controls").toBeGreaterThan(1);
  }
  await dialog.press("Escape"); await expect(dialog).toBeHidden();
  await expect(label).toBeFocused();
  expect(errors).toEqual([]);
  await info.attach("keyboard-scope", { body: "Named public controls, role/status/alert semantics, native dialog focus containment and return. This checks DOM behavior, not assistive-technology announcement quality or conformance of the whole app.", contentType: "text/plain" });
});
