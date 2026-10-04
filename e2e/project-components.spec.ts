import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function state(page: Page): Promise<{
  document: CadDocument;
  result?: RebuildResult;
  status: string;
  activeComponentId: string;
}> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path),
      state = useCadStore.getState();
    return {
      document: state.history.present,
      result: state.rebuild.result,
      status: state.rebuild.status,
      activeComponentId: state.activeComponentId,
    };
  });
}
async function ready(page: Page) {
  await expect.poll(async () => (await state(page)).status).toBe("succeeded");
  expect((await state(page)).result?.errors).toEqual([]);
}
async function coordinate(page: Page, x: number, y: number) {
  await page.getByLabel("Canvas coordinate X", { exact: true }).fill(String(x));
  await page.getByLabel("Canvas coordinate Y", { exact: true }).fill(String(y));
  await page
    .getByRole("button", { name: "Place coordinate", exact: true })
    .click();
}
async function component(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Main CAD commands" })
    .getByRole("button", { name: "New component", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "New Component",
    exact: true,
  });
  await dialog.getByLabel("Component name", { exact: true }).fill(name);
  await dialog
    .getByRole("button", { name: "Create component", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `Activate component ${name}` }),
  ).toHaveAttribute("aria-pressed", "true");
}
async function sketch(page: Page, tool: string, points: number[][]) {
  await page
    .getByRole("navigation", { name: "Main CAD commands" })
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Create Sketch", exact: true })
    .getByRole("button", { name: "Sketch on XZ plane", exact: true })
    .click();
  await page.getByLabel("Canvas tool", { exact: true }).selectOption(tool);
  for (const [x, y] of points) await coordinate(page, x, y);
  await expect(
    page.getByLabel("Show drawing dimensions", { exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ready(page);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await ready(page);
}

test("local project → active components → plane-based sketches → native bodies preserve ownership through edit, save/open and STL", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Two Part Project");
  await page.getByLabel("Project name", { exact: true }).press("Enter");
  await component(page, "Bracket");
  const bracketId = (await state(page)).activeComponentId;
  await sketch(page, "rectangle", [
    [0, 0],
    [20, 10],
  ]);
  const base = (await state(page)).document.features[0],
    baseBody = `body:${base.id}`;
  expect(base.componentId).toBe(bracketId);
  await component(page, "Cover");
  const coverId = (await state(page)).activeComponentId;
  await expect(
    page.getByRole("button", { name: "Extrude selected sketch", exact: true }),
  ).toBeDisabled();
  await sketch(page, "rectangle", [
    [0, 0],
    [10, 10],
  ]);
  const cover = (await state(page)).document.features[1],
    coverBody = `body:${cover.id}`;
  await page
    .getByRole("button", { name: "Activate component Bracket", exact: true })
    .click();
  await sketch(page, "circle", [
    [10, 5],
    [12, 5],
  ]);
  await page
    .getByRole("combobox", { name: "Operation", exact: true })
    .selectOption("cut");
  const targets = page.getByRole("combobox", {
    name: "Target body",
    exact: true,
  });
  await expect(targets.locator("option")).toHaveCount(2); // None plus Bracket; Cover is another component.
  await targets.selectOption(baseBody);
  await ready(page);
  let snapshot = await state(page);
  const bracketMesh = snapshot.result!.meshes.find(
    (mesh) => mesh.bodyId === baseBody,
  )!;
  const coverMesh = snapshot.result!.meshes.find(
    (mesh) => mesh.bodyId === coverBody,
  )!;
  expect(bracketMesh.geometrySource).toBe("opencascade");
  expect(bracketMesh.geometryAssertions).toMatchObject({
    valid: true,
    solidCount: 1,
  });
  expect(bracketMesh.geometryAssertions!.volume).toBeCloseTo(
    (200 - Math.PI * 4) * 10,
    7,
  );
  bracketMesh.bounds.min.forEach((value, axis) =>
    expect(value).toBeCloseTo([0, -10, 0][axis], 6),
  );
  bracketMesh.bounds.max.forEach((value, axis) =>
    expect(value).toBeCloseTo([20, 0, 10][axis], 6),
  );
  expect(coverMesh.geometryAssertions!.volume).toBeCloseTo(1000, 7);
  expect(coverMesh.kernelOperation).toBe("extrusion");
  expect(snapshot.document.features[2].componentId).toBe(bracketId);
  // Selecting the other component's timeline feature activates its owner.
  await page.locator(".feature-chip").filter({ hasText: "Extrude 2" }).click();
  await expect(
    page.getByRole("button", { name: "Activate component Cover", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const distance = page.getByLabel("Distance", { exact: true });
  await distance.fill("12mm");
  await distance.press("Enter");
  await ready(page);
  snapshot = await state(page);
  expect(
    snapshot.result!.meshes.find((mesh) => mesh.bodyId === coverBody)!
      .geometryAssertions!.volume,
  ).toBeCloseTo(1200, 7);
  expect(
    snapshot.result!.meshes.find((mesh) => mesh.bodyId === baseBody)!
      .geometryAssertions!.volume,
  ).toBeCloseTo(bracketMesh.geometryAssertions!.volume, 7);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  expect(
    (await state(page)).result!.meshes.find(
      (mesh) => mesh.bodyId === coverBody,
    )!.geometryAssertions!.volume,
  ).toBeCloseTo(1000, 7);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ready(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("components.pcaddoc");
  await (await download).saveAs(path);
  const saved: CadDocument = JSON.parse(await readFile(path, "utf8"));
  expect(saved.name).toBe("Two Part Project");
  expect(Object.keys(saved.components)).toHaveLength(3);
  expect(saved.features.map((feature) => feature.componentId)).toEqual([
    bracketId,
    coverId,
    bracketId,
  ]);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await ready(page);
  expect((await state(page)).document.features).toEqual([]);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect.poll(async () => (await state(page)).document.id).toBe(saved.id);
  await ready(page);
  expect((await state(page)).document.components).toEqual(saved.components);
  await page
    .getByRole("button", { name: "Activate component Bracket", exact: true })
    .click();
  await page
    .locator(".body-row")
    .getByRole("button", { name: "Extrude 1", exact: true })
    .click();
  const exporting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export selected body", exact: true })
    .click();
  const stlPath = info.outputPath("bracket.stl");
  await (await exporting).saveAs(stlPath);
  const bytes = await readFile(stlPath),
    triangles = bytes.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(0);
  expect(bytes.length).toBe(84 + triangles * 50);
  let volume = 0;
  for (let i = 0; i < triangles; i++) {
    const p = Array.from({ length: 9 }, (_, j) =>
      bytes.readFloatLE(96 + 50 * i + j * 4),
    );
    expect(p.every(Number.isFinite)).toBe(true);
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  expect(volume / bracketMesh.geometryAssertions!.volume).toBeCloseTo(1, 3);
  await page.screenshot({
    path: info.outputPath("project-components.png"),
    fullPage: true,
  });
});
