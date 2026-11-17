import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expectedGeometrySource } from "../e2e/expectedGeometrySource";

test.use({ storageState: { cookies: [], origins: [] } });
test("built gallery serves native assets, previews under CSP, opens an editable example and downloads its actual model PNG", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { (window as unknown as { violations: string[] }).violations = []; document.addEventListener("securitypolicyviolation", event => (window as unknown as { violations: string[] }).violations.push(`${event.violatedDirective}:${event.blockedURI}`)); });
  await page.goto("/"); await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByText("File", { exact: true }).click(); await page.getByRole("button", { name: "Project gallery", exact: true }).click();
  const gallery = page.getByRole("dialog", { name: "Project gallery", exact: true });
  await expect(gallery.getByRole("img")).toHaveCount(33);
  await expect(async () => expect(await gallery.getByRole("img").first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(100)).toPass();
  await gallery.getByLabel("Live native previews").check();
  const legacy = gallery.getByRole("button", { name: "Open Angle bracket fixture", exact: true });
  if (expectedGeometrySource === "plainsolid") {
    await expect(gallery.getByText("Requires the OpenCascade comparison build.", { exact: true })).toHaveCount(6);
    await expect(legacy).toBeDisabled();
    await expect(legacy).toHaveAccessibleDescription(/chamfer on the rounded bracket/);
    await expect(gallery.getByRole("button", { name: "Preview Angle bracket fixture", exact: true })).toBeDisabled();
    await gallery.getByLabel("Works with PlainSolid").check();
    await expect(gallery.getByRole("img")).toHaveCount(27);
    await expect(legacy).toHaveCount(0);
    await gallery.getByLabel("Works with PlainSolid").uncheck();
  } else {
    await expect(legacy).toBeEnabled();
  }
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

test("compact gallery filters open the sample rack and its suggested edit rebuilds the native spacing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByText("File", { exact: true }).click();
  await page.getByRole("button", { name: "Project gallery", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 800 });
  const gallery = page.getByRole("dialog", { name: "Project gallery", exact: true });
  await gallery.getByLabel("Collection").selectOption("Shop tools");
  await gallery.getByLabel("Difficulty").selectOption("Advanced");
  await gallery.getByLabel("Find a project").fill("rack_clearance");
  await expect(gallery.getByRole("img")).toHaveCount(1);
  await expect(gallery.getByText("1 of 33 examples")).toBeVisible();
  expect(await gallery.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(
    await gallery.evaluate(element => element.clientWidth),
  );
  await gallery.getByRole("button", { name: "Open Eight-position sample rack" }).click();
  await expect(gallery).toBeHidden();
  await expect(page.locator(".project-title")).toHaveText("Eight-position sample rack");
  const geometry = await page.evaluate(async () => {
    const commands = window.plaincadCommands;
    const snapshot = await commands.execute({ command: "runtime.snapshot" });
    if (!snapshot.ok) throw new Error(snapshot.error.message);
    const { session, document } = snapshot.value as { session: number; document: { parameters: Record<string, { id: string }> } };
    async function readGeometry() {
      const receipt = await commands.execute({ command: "runtime.awaitNative", session });
      if (!receipt.ok) throw new Error(receipt.error.message);
      const { rebuild } = receipt.value as { rebuild: { bodies: Array<{
        bounds: { max: [number, number, number] };
        assertions: { valid: boolean; solidCount: number; volume: number };
      }> } };
      return {
        solidCounts: rebuild.bodies.map(body => body.assertions.solidCount),
        height: Math.max(...rebuild.bodies.map(body => body.bounds.max[2])),
        volume: rebuild.bodies.reduce((sum, body) => sum + body.assertions.volume, 0),
      };
    }
    const original = await readGeometry();
    const update = await commands.execute({
      command: "parameter.update", session,
      arguments: { parameterId: document.parameters.rack_clearance.id, patch: { expression: "36mm" } },
    });
    if (!update.ok) throw new Error(update.error.message);
    return { original, edited: await readGeometry() };
  });
  expect(geometry.original.solidCounts).toEqual([1, 1, 1, 1, 1, 1]);
  expect(geometry.edited.solidCounts).toEqual(geometry.original.solidCounts);
  expect(geometry.original.height).toBeCloseTo(37, 5);
  expect(geometry.edited.height).toBeCloseTo(45, 5);
  expect(geometry.edited.volume - geometry.original.volume).toBeCloseTo(4 * Math.PI * 3 ** 2 * 8, 4);
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
    await gallery.getByLabel("Find a project").fill(example.name);
    const cover = gallery.getByRole("img", { name: `${example.name} actual native CAD geometry` });
    await expect.poll(() => cover.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([768, 480]);
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
