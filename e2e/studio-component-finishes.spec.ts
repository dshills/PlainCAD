import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";

test("component finishes survive save and reopen, and studio PNG honors fixed dimensions", async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /same key|Shader Error/.test(message.text())) errors.push(message.text());
  });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles("docs/examples/02-spacer-stack.pcaddoc");
  await expect(async () => {
    expect((await aiSnapshot(page)).result?.meshes).toHaveLength(3);
    expect((await aiSnapshot(page)).status).toBe("succeeded");
  }).toPass();
  const before = await aiSnapshot(page);
  const geometry = before.result!.meshes.map(mesh => ({ id: mesh.bodyId, volume: mesh.geometryAssertions?.volume }));
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  const component = page.getByLabel("Finish component");
  const finish = page.getByLabel("Component appearance");
  await expect(component.locator("option")).toHaveCount(3);
  const options = await component.locator("option").evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value));
  for (const [id, preset] of [[options[0], "steel"], [options[1], "brass"]]) {
    await component.selectOption(id);
    await finish.selectOption(preset);
    await expect.poll(async () => (await aiSnapshot(page)).document.components[id].appearance).toBe(preset);
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  }
  const renderSnapshot = () => page.evaluate(async (): Promise<ViewerSnapshot> => {
    const module = "/src/viewer/viewerDiagnostics.ts";
    return (await import(module)).inspectViewer();
  });
  await expect.poll(async () => (await renderSnapshot()).meshes.map(mesh => mesh.appearance?.color)).toEqual(expect.arrayContaining(["b9c4cf", "c9a261"]));
  expect((await aiSnapshot(page)).result?.meshes.map(mesh => ({ id: mesh.bodyId, volume: mesh.geometryAssertions?.volume }))).toEqual(geometry);
  const viewport = await renderSnapshot();
  await page.getByLabel("Studio PNG size").selectOption("hd");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download studio PNG", exact: true }).click(),
  ]);
  const path = info.outputPath("component-finishes-hd.png");
  await download.saveAs(path);
  const png = await readFile(path);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1920, 1080]);
  const restored = await renderSnapshot();
  restored.cameraPosition.forEach((value, axis) => expect(value).toBeCloseTo(viewport.cameraPosition[axis], 9));
  expect(restored.cameraTarget).toEqual(viewport.cameraTarget);
  expect(restored.performance?.bufferWidth).toBe(viewport.performance?.bufferWidth);
  expect(restored.performance?.bufferHeight).toBe(viewport.performance?.bufferHeight);

  const [project] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles((await project.path())!);
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(before.session);
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Render view", exact: true }).click();
  await expect.poll(async () => (await renderSnapshot()).meshes.map(mesh => mesh.appearance?.color)).toEqual(expect.arrayContaining(["b9c4cf", "c9a261"]));
  expect(errors).toEqual([]);
});
