import { applyExtrusion } from "./extrudeWorkflow";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";

type BrowserState = { document: CadDocument; status: string; result?: RebuildResult };

async function snapshot(page: Page): Promise<BrowserState> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const { useCadStore } = await import(path);
    const state = useCadStore.getState();
    return { document: state.history.present, status: state.rebuild.status, result: state.rebuild.result };
  });
}

async function viewer(page: Page): Promise<ViewerSnapshot> {
  const result: ViewerSnapshot | undefined = await page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer();
  });
  if (!result) throw new Error("Viewer diagnostics unavailable; browser acceptance tests require the Vite development server.");
  return result;
}

async function ready(page: Page, verify?: (state: BrowserState) => void) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.errors).toEqual([]);
    verify?.(state);
  }).toPass({ timeout: 20_000 });
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
}

async function commit(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}

function meshVolume(positions: ArrayLike<number>, indices: number[]) {
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    volume += (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) / 6;
  }
  return volume;
}

function assertGeometry(state: BrowserState, thickness: number, cut: boolean, plane = "XY") {
  expect(state.status).toBe("succeeded");
  expect(state.result?.meshes).toHaveLength(1);
  const mesh = state.result!.meshes[0];
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.kernelOperation).toBe(cut ? "cut" : "extrusion");
  const expectedVolume = (80 * 50 - (cut ? Math.PI * 10 ** 2 : 0)) * thickness;
  // OpenCascade tessellation approximates the circle; require positive outward
  // winding and volume within 1%, rather than merely checking that a body exists.
  const volume = meshVolume(mesh.positions, mesh.indices);
  expect(volume).toBeGreaterThan(expectedVolume * 0.99);
  expect(volume).toBeLessThan(expectedVolume * 1.01);
  const expected = plane === "XZ"
    ? { min: [-40, -thickness, -25], max: [40, 0, 25] }
    : plane === "YZ" ? { min: [0, -40, -25], max: [thickness, 40, 25] }
    : { min: [-40, -25, 0], max: [40, 25, thickness] };
  for (const end of ["min", "max"] as const) {
    mesh.bounds[end].forEach((value, i) => expect(value).toBeCloseTo(expected[end][i], 4));
  }
  return mesh;
}

async function assertViewer(page: Page, state: BrowserState) {
  await expect.poll(async () => (await viewer(page)).meshes[0]?.positions).toEqual(Array.from(new Float32Array(state.result!.meshes[0].positions)));
  const view = await viewer(page);
  expect(view.cameraUp).toEqual([0, 0, 1]);
  expect(view.gridNormal[2]).toBeCloseTo(1, 8);
  expect(view.gridNormal[0]).toBeCloseTo(0, 8);
  expect(view.gridNormal[1]).toBeCloseTo(0, 8);
  const mesh = state.result!.meshes[0];
  expect(view.meshes[0].bodyId).toBe(mesh.bodyId);
  expect(view.meshes[0].indices).toEqual(mesh.indices);
  view.meshes[0].positions.forEach((value, i) => expect(value).toBeCloseTo(mesh.positions[i], 4));
  for (const sketch of Object.values(state.document.sketches)) {
    const points = Object.values(sketch.entities).filter((entity) => entity.type === "point");
    const plane = sketch.plane.type === "origin" ? sketch.plane.plane : "XY";
    for (const entity of Object.values(sketch.entities)) {
      if (entity.type !== "circle") continue;
      const normal = view.sketchCircles.find((circle) => circle.id === entity.id)!.normal;
      const expectedNormal = plane === "XZ" ? [0, -1, 0] : plane === "YZ" ? [1, 0, 0] : [0, 0, 1];
      normal.forEach((value, axis) => expect(value).toBeCloseTo(expectedNormal[axis], 8));
    }
    const corners = points.length === 1 ? [[0, 0]] : [[-40, -25], [40, -25], [40, 25], [-40, 25]];
    const expected = corners.map(([x, y]) => plane === "XZ" ? [x, 0, y] : plane === "YZ" ? [0, x, y] : [x, y, 0]);
    const rendered = points.map((entity) => view.sketchPoints.find((point) => point.id === entity.id)!.position);
    // Save/open sorts entity keys, so compare coordinate sets independent of order.
    expect(rendered.map((point) => JSON.stringify(point)).sort()).toEqual(expected.map((point) => JSON.stringify(point)).sort());
  }
}

function parseStl(bytes: Buffer) {
  const triangles = bytes.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(0);
  expect(bytes.length).toBe(84 + triangles * 50);
  const positions: number[] = [], indices: number[] = [];
  for (let triangle = 0; triangle < triangles; triangle++) {
    const offset = 84 + triangle * 50;
    for (let axis = 0; axis < 9; axis++) positions.push(bytes.readFloatLE(offset + 12 + axis * 4));
    indices.push(triangle * 3, triangle * 3 + 1, triangle * 3 + 2);
    const a = positions.slice(-9, -6), b = positions.slice(-6, -3), c = positions.slice(-3);
    const ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]);
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const length = Math.hypot(...normal);
    expect(length).toBeGreaterThan(1e-8);
    normal.forEach((v, axis) => expect(bytes.readFloatLE(offset + axis * 4)).toBeCloseTo(v / length, 4));
  }
  return { positions, indices };
}

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: non-template modeling, edit, save/open, and real-kernel STL`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/");
    await ready(page);
    expect((await snapshot(page)).document.features).toHaveLength(0);
    await page.getByRole("button", { name: "Add Parameter", exact: true }).click();
    await commit(page, "Parameter param_1 name", "thickness");
    await page.getByRole("button", { name: `Create ${plane} sketch`, exact: true }).click();
    await page.getByRole("button", { name: "Add center rectangle", exact: true }).click();
    await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
    await applyExtrusion(page);
    await commit(page, "Distance", "thickness");
    await ready(page, (state) => { assertGeometry(state, 10, false, plane); });
    const base = assertGeometry(await snapshot(page), 10, false, plane);
    await assertViewer(page, await snapshot(page));

    await page.getByRole("button", { name: `Create ${plane} sketch`, exact: true }).click();
    await page.getByRole("button", { name: "Add circle", exact: true }).click();
    await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
    await applyExtrusion(page);
    await ready(page, (state) => { expect(state.result?.meshes).toHaveLength(2); });
    await page.getByRole("combobox", { name: "Target body", exact: true }).selectOption(base.bodyId);
    await page.getByRole("combobox", { name: "Operation", exact: true }).selectOption("cut");
    await page.getByRole("combobox", { name: "Termination", exact: true }).selectOption("throughAll");
    await ready(page, (state) => { assertGeometry(state, 10, true, plane); });

    await commit(page, "Parameter thickness expression", "14mm");
    await ready(page, (state) => { assertGeometry(state, 14, true, plane); });
    const edited = await snapshot(page);
    const cutMesh = assertGeometry(edited, 14, true, plane);
    await assertViewer(page, edited);
    expect(edited.document.features).toHaveLength(2);
    expect(edited.document.features[1]).toMatchObject({ operation: "cut", targetBodyIds: [base.bodyId] });

    const saving = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    const projectDownload = await saving;
    const projectPath = testInfo.outputPath("part.pcaddoc");
    await projectDownload.saveAs(projectPath);
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.features).toEqual(edited.document.features);
    expect(saved.parameters.thickness.expression).toBe("14mm");
    expect(JSON.stringify(saved)).not.toMatch(/geometrySource|kernelOperation|kernelHandle|positions/);
    await page.reload();
    await ready(page);
    expect((await snapshot(page)).document.features).toHaveLength(0);
    await page.locator('input[type="file"]').setInputFiles(projectPath);
    await expect.poll(async () => (await snapshot(page)).document.id).toBe(edited.document.id);
    await ready(page, (state) => { assertGeometry(state, 14, true, plane); });
    const reopened = await snapshot(page);
    expect(reopened.document.id).toBe(edited.document.id);
    assertGeometry(reopened, 14, true, plane);
    await assertViewer(page, reopened);

    await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeEnabled();
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = await exporting;
    const stlPath = testInfo.outputPath("part.stl");
    await stl.saveAs(stlPath);
    const exported = parseStl(await readFile(stlPath));
    const exportedVolume = meshVolume(exported.positions, exported.indices);
    const originalVolume = meshVolume(cutMesh.positions, cutMesh.indices);
    expect(Math.abs(exportedVolume - originalVolume) / originalVolume).toBeLessThan(1e-4);
    // Verify every exported vertex retains the global CAD coordinates.
    exported.positions.forEach((value, index) => {
      const triangleIndex = Math.floor(index / 3);
      const coordinate = index % 3;
      expect(value).toBeCloseTo(reopened.result!.meshes[0].positions[reopened.result!.meshes[0].indices[triangleIndex] * 3 + coordinate], 4);
    });
    await page.screenshot({ path: testInfo.outputPath("model.png") });
    expect(errors).toEqual([]);
  });
}
