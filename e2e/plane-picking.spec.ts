import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyExtrusion } from "./extrudeWorkflow";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; result: RebuildResult; past: number }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path),
      state = useCadStore.getState();
    return {
      document: state.history.present,
      result: state.rebuild.result,
      past: state.history.past.length,
    };
  });
}
async function ready(page: Page) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
}
async function point(page: Page, value: [number, number, number]) {
  const result = await page.evaluate(async (value) => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).projectViewerPoint(value);
  }, value);
  if (!result) throw new Error("Viewer projection unavailable");
  const bounds = await page.locator(".viewer-canvas canvas").boundingBox();
  if (!bounds) throw new Error("Viewer bounds unavailable");
  return { ...result, x: result.x + bounds.x, y: result.y + bounds.y };
}
async function coordinate(page: Page, x: number, y: number) {
  await page.getByLabel("Canvas coordinate X", { exact: true }).fill(String(x));
  await page.getByLabel("Canvas coordinate Y", { exact: true }).fill(String(y));
  await page
    .getByRole("button", { name: "Place coordinate", exact: true })
    .click();
}
test("visible origin-plane picking highlights XZ and aligns the camera", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  const picker = page.getByRole("region", {
    name: "Create Sketch",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const projected = await point(page, [20, 0, 20]);
  await page.mouse.move(projected.x, projected.y);
  await expect(picker.getByRole("status")).toHaveText("Highlighted: XZ plane");
  await page.screenshot({ path: info.outputPath("plane-selection.png") });
  await page.mouse.click(projected.x, projected.y);
  await expect(
    page.getByRole("region", { name: "Sketch canvas", exact: true }),
  ).toBeVisible();
  const state = await snapshot(page);
  expect(Object.values(state.document.sketches)[0].plane).toEqual({
    type: "origin",
    plane: "XZ",
  });
  const camera = await page.evaluate(async () => {
    const path = "/src/viewer/cameraController.ts";
    return (await import(path)).captureCamera();
  });
  expect(camera!.cameraUp).toEqual([0, 0, 1]);
  expect(camera!.cameraPosition[1]).toBeLessThan(0);
  expect(camera!.cameraPosition[0]).toBeCloseTo(0, 8);
  expect(camera!.cameraPosition[2]).toBeCloseTo(0, 8);
});
test("native cap picking persists its reference and follows owner edits through save/open", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add center rectangle", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await applyExtrusion(page);
  await ready(page);
  const before = await snapshot(page),
    owner = before.document.features[0];
  await page
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  const picker = page.getByRole("region", {
      name: "Create Sketch",
      exact: true,
    }),
    projected = await point(page, [10, -10, 10]);
  await page.mouse.move(projected.x, projected.y);
  await expect(picker.getByRole("status")).toHaveText(
    "Highlighted: Extrude 1 — end cap",
  );
  expect((await snapshot(page)).document).toEqual(before.document);
  await page.mouse.click(projected.x, projected.y);
  await expect(
    page.getByRole("region", { name: "Sketch canvas" }),
  ).toBeVisible();
  let state = await snapshot(page),
    sketch = Object.values(state.document.sketches).find(
      (sketch) => sketch.plane.type === "face",
    )!;
  expect(sketch.plane).toEqual({
    type: "face",
    featureId: owner.id,
    stableFaceId: `extrude:${owner.id}:endCap`,
  });
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("circle");
  await coordinate(page, 0, 0);
  await coordinate(page, 3, 0);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Extrude", exact: true })
    .getByLabel("Extrude distance", { exact: true })
    .fill("5mm");
  await applyExtrusion(page);
  await ready(page);
  state = await snapshot(page);
  const child = state.document.features[1];
  const childMesh = state.result.meshes.find(
    (mesh) => mesh.bodyId === `body:${child.id}`,
  )!;
  expect(childMesh.geometrySource).toBe("opencascade");
  expect(childMesh.geometryAssertions!.volume).toBeCloseTo(Math.PI * 9 * 5, 7);
  expect(childMesh.bounds.min[2]).toBeCloseTo(10, 6);
  expect(childMesh.bounds.max[2]).toBeCloseTo(15, 6);
  await page.locator(".feature-chip").filter({ hasText: "Extrude 1" }).click();
  await page.getByLabel("Distance", { exact: true }).fill("14mm");
  await page.getByLabel("Distance", { exact: true }).press("Enter");
  await ready(page);
  state = await snapshot(page);
  expect(
    state.result.meshes.find((mesh) => mesh.bodyId === `body:${child.id}`)!
      .bounds.min[2],
  ).toBeCloseTo(14, 6);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("face-sketch.pcaddoc");
  await (await download).saveAs(path);
  const saved = JSON.parse(await readFile(path, "utf8")) as CadDocument;
  expect(saved.sketches[sketch.id].plane).toEqual(sketch.plane);
  await page.locator('input[type="file"]').setInputFiles(path);
  await ready(page);
  expect(
    (await snapshot(page)).result.meshes.find(
      (mesh) => mesh.bodyId === `body:${child.id}`,
    )!.bounds.min[2],
  ).toBeCloseTo(14, 6);
});
test("curved-face clicks diagnose unsupported picking and cancel without document edits", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await page.getByRole("button", { name: "Add circle", exact: true }).click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await applyExtrusion(page);
  await ready(page);
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  const projected = await point(page, [Math.sqrt(50), -Math.sqrt(50), 5]);
  await page.mouse.click(projected.x, projected.y);
  const picker = page.getByRole("region", { name: "Create Sketch" });
  await expect(picker.getByRole("alert")).toContainText(
    "curved, lost, ambiguous",
  );
  expect(await snapshot(page)).toEqual(before);
  await picker.getByRole("button", { name: "Cancel plane selection" }).click();
  await expect(picker).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});
