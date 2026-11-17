import { test, expect } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { createBoxTemplate } from "../src/templates/templates";

test.use({ storageState: { cookies: [], origins: [] } });
test("gallery previews actual example geometry without mutating the project, protects replacement and keeps saved native covers", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const box = createBoxTemplate();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "box.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(box)) });
  await expect(async () => { const snapshot = await aiSnapshot(page); expect(snapshot.status).toBe("succeeded"); expect(snapshot.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(80000, 6); }).toPass();
  const before = await aiSnapshot(page);
  // Test the shared command entry through the File menu, rather than mounting a harness.
  await page.getByText("File", { exact: true }).click();
  await page.getByRole("button", { name: "Project gallery", exact: true }).click();
  const gallery = page.getByRole("dialog", { name: "Project gallery", exact: true });
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole("img")).toHaveCount(33);
  const cover = gallery.getByRole("img", { name: "Cable guide mount actual native CAD geometry" });
  await expect(async () => expect(await cover.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(100)).toPass();
  await gallery.getByLabel("Live native previews").check();
  await gallery.getByRole("button", { name: "Preview Cable guide mount", exact: true }).focus();
  const canvas = gallery.getByLabel("Native rotating preview of Cable guide mount");
  await expect(canvas).toBeVisible({ timeout: 40000 });
  const first = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await expect(async () => expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(first)).toPass();
  const unchanged = await aiSnapshot(page);
  expect(unchanged.document).toEqual(before.document); expect(unchanged.past).toBe(before.past); expect(unchanged.session).toBe(before.session); expect(unchanged.result).toEqual(before.result);
  await gallery.getByRole("button", { name: "Open Cable guide mount", exact: true }).click();
  await expect(gallery).toBeHidden();
  await expect(page.getByRole("dialog", { name: /dropped project/i })).toBeVisible();
  expect((await aiSnapshot(page)).document.id).toBe(box.id);
  await page.getByRole("button", { name: /keep current/i }).click();
  const saved = page.waitForEvent("download");
  await page.evaluate(async () => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand("file.saveProject", {}); });
  await saved;
  await page.getByText("File", { exact: true }).click(); await page.getByRole("button", { name: "Project gallery", exact: true }).click();
  const recent = gallery.getByRole("region", { name: "Recent saved projects" });
  await gallery.getByRole("button", { name: "Recent saves" }).click();
  await expect(recent.getByRole("heading", { name: "Recent saved projects", exact: true })).toBeFocused();
  await expect(recent.getByRole("img")).toHaveCount(1);
  await expect(async () => expect(await recent.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(192)).toPass();
  await gallery.getByRole("button", { name: "Close gallery", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByText("File", { exact: true }).click(); await page.getByRole("button", { name: "Project gallery", exact: true }).click();
  await expect(gallery.getByLabel("Live native previews")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("switches untouched gallery examples directly and protects edits until undone", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const gallery = page.getByRole("dialog", { name: "Project gallery", exact: true });
  const replacement = page.getByRole("dialog", { name: "Open dropped project", exact: true });
  async function chooseExample(name: string) {
    await page.getByText("File", { exact: true }).click();
    await page.getByRole("button", { name: "Project gallery", exact: true }).click();
    await gallery.getByRole("button", { name: `Open ${name}`, exact: true }).click();
    await expect(gallery).toBeHidden();
  }
  async function expectOpened(name: string) {
    await expect(page.locator(".project-title")).toHaveText(name);
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await expect(replacement).toBeHidden();
  }

  await chooseExample("Angle bracket fixture");
  await expectOpened("Angle bracket fixture");
  await chooseExample("Precision spacer stack");
  await expectOpened("Precision spacer stack");
  const before = await aiSnapshot(page);
  const originalVolume = before.result!.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0);

  await page.evaluate(async ({ session, parameterId }) => {
    const result = await window.plaincadCommands.execute({
      command: "parameter.update", session,
      arguments: { parameterId, patch: { expression: "24mm" } },
    });
    if (!result.ok) throw new Error(result.error.message);
  }, { session: before.session, parameterId: before.document.parameters.spacer_height.id });
  await expect(async () => {
    const edited = await aiSnapshot(page);
    expect(edited.status).toBe("succeeded");
    expect(edited.result!.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0)).toBeGreaterThan(originalVolume);
  }).toPass();

  await chooseExample("Motor mounting flange");
  await expect(replacement).toBeVisible();
  await replacement.getByRole("button", { name: "Keep current project", exact: true }).click();
  expect((await aiSnapshot(page)).document.parameters.spacer_height.expression).toBe("24mm");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await chooseExample("Motor mounting flange");
  await expectOpened("Motor mounting flange");
});
