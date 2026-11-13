import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ storageState: { cookies: [], origins: [] } });
test("built gallery serves native assets, previews under CSP, opens an editable example and downloads its actual model PNG", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { (window as unknown as { violations: string[] }).violations = []; document.addEventListener("securitypolicyviolation", event => (window as unknown as { violations: string[] }).violations.push(`${event.violatedDirective}:${event.blockedURI}`)); });
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByText("File", { exact: true }).click(); await page.getByRole("button", { name: "Project gallery", exact: true }).click();
  const gallery = page.getByRole("dialog", { name: "Project gallery", exact: true });
  await expect(gallery.getByRole("img")).toHaveCount(14);
  await expect(async () => expect(await gallery.getByRole("img").first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(100)).toPass();
  await gallery.getByLabel("Live native previews").check();
  await gallery.getByRole("button", { name: "Preview Cable guide mount", exact: true }).focus();
  const canvas = gallery.getByLabel("Native rotating preview of Cable guide mount");
  await expect(canvas).toBeVisible({ timeout: 40000 });
  const frame = await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await expect(async () => expect(await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(frame)).toPass();
  await gallery.getByRole("button", { name: "Open Cable guide mount", exact: true }).click();
  await expect(gallery).toBeHidden();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect(page.getByText("Cable guide mount", { exact: true }).first()).toBeVisible();
  await page.getByText("File", { exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download project view PNG", exact: true }).click();
  const download = await downloaded;
  const path = await download.path(); if (!path) throw new Error("Project PNG download was unavailable.");
  const bytes = await readFile(path); expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); expect(bytes.length).toBeGreaterThan(1000);
  expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations)).toEqual([]);
  expect(errors).toEqual([]);
});

const threadedExamples = [
  { name: "Trapezoidal lead screw and nut", volumes: [744.073, 628.451], form: "trapezoidal", starts: 4, hand: "right" },
  { name: "Left-hand Acme lead screw and nut", volumes: [1301.638, 790.977], form: "acme", starts: 2, hand: "left" },
  { name: "M6 socket screw and tapped collar", volumes: [750.991, 630.756], size: "m6" },
  { name: "Quarter-inch UNC screw and tapped block", volumes: [814.297, 1201.099], size: "1/4-20" },
] as const;

for (const example of threadedExamples) {
  test(`gallery opens ${example.name} with its cover and native threads`, async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await page.getByText("File", { exact: true }).click();
    await page.getByRole("button", { name: "Project gallery", exact: true }).click();
    const gallery = page.getByRole("dialog", { name: "Project gallery", exact: true });
    await gallery.getByRole("textbox", { name: "Find a project" }).fill(example.name);
    const cover = gallery.getByRole("img", { name: `${example.name} actual native CAD geometry` });
    await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(2220);
    await gallery.getByRole("button", { name: `Open ${example.name}`, exact: true }).click();
    await expect(gallery).toBeHidden();
    await expect(page.locator(".project-title")).toHaveText(example.name);
    const state = await page.evaluate(async () => {
      const initial = await window.plaincadCommands.execute({ command: "runtime.snapshot" });
      if (!initial.ok) throw new Error(initial.error.message);
      const response = await window.plaincadCommands.execute({ command: "runtime.awaitNative", session: (initial.value as { session: number }).session });
      if (!response.ok) throw new Error(response.error.message);
      return response.value as unknown as {
        document: import("../src/cad/document/schema").CadDocument;
        rebuild: { bodies: Array<{ assertions: { valid: boolean; solidCount: number; volume: number } }> };
      };
    });
    expect(state.rebuild.bodies).toHaveLength(2);
    state.rebuild.bodies.forEach(({ assertions }, index) => {
      expect(assertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(assertions.volume).toBeCloseTo(example.volumes[index], 2);
    });
    expect(state.document.viewState?.namedViews).toEqual([expect.objectContaining({ name: "Thread detail" })]);
    if ("form" in example) {
      const [screw, nut] = state.document.features;
      expect(screw).toMatchObject({ type: "leadScrew", form: example.form, starts: example.starts, hand: example.hand });
      expect(nut).toMatchObject({ type: "leadNut", screwFeatureId: screw.id });
    } else {
      expect(state.document.features.filter(feature => feature.type === "thread")).toMatchObject([
        { size: example.size, side: "external" },
        { size: example.size, side: "internal" },
      ]);
    }
  });
}
