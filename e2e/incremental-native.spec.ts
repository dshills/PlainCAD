import { test, expect } from "@playwright/test";
import { nativeBenchmarkDocument } from "./nativeBenchmarkFixture";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import { expectedGeometrySource } from "./expectedGeometrySource";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../src/cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";

test("incremental native output reuse preserves geometry, failures and latest edits", async ({ page }) => {
  const document = nativeBenchmarkDocument();
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "incremental.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  const snapshot = () => page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", state = (await import(path)).useCadStore.getState();
    return { status: state.rebuild.status, expression: state.history.present.parameters.width?.expression, result: state.rebuild.result as RebuildResult | undefined };
  });
  await expect(async () => { const state = await snapshot(); expect(state.status).toBe("succeeded"); expect(state.result?.metrics?.operationCount).toBe(2); }).toPass({ timeout: 30000 });
  const cold = (await snapshot()).result!;
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.getState().updateDocument((document: CadDocument) => ({ ...document, name: "Renamed cached model", features: document.features.map(feature => ({ ...feature, name: `Renamed ${feature.name}` })) }));
  });
  await expect(async () => { const state = await snapshot(); expect(state.status).toBe("succeeded"); expect(state.result?.metrics?.operationCount).toBe(0); expect(state.result?.metrics?.nativeFeatureCacheHits).toBe(2); }).toPass({ timeout: 30000 });
  const warm = (await snapshot()).result!;
  expect(warm.meshes.map(mesh => [mesh.bodyId, mesh.bounds, mesh.geometryAssertions, Array.from(mesh.positions), mesh.indices])).toEqual(cold.meshes.map(mesh => [mesh.bodyId, mesh.bounds, mesh.geometryAssertions, Array.from(mesh.positions), mesh.indices]));
  expect(warm.bodies[0].name).toBe("Renamed Benchmark solid");
  expect(warm.metrics?.disposalFailures).toBe(0);
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", store = (await import(path)).useCadStore.getState();
    store.updateParameter("width", { expression: "2mm" });
  });
  await expect(async () => { const state = await snapshot(); expect(state.expression).toBe("2mm"); expect(state.status).toBe("failed"); expect(state.result?.success).toBe(false); expect(state.result?.errors.some(error => error.source === "kernel")).toBe(true); }).toPass({ timeout: 30000 });
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", store = (await import(path)).useCadStore.getState();
    store.updateParameter("width", { expression: "72mm" });
    store.updateParameter("width", { expression: "80mm" });
  });
  await expect(async () => {
    const state = await snapshot(); expect(state.expression).toBe("80mm"); expect(state.status).toBe("succeeded"); expect(state.result?.success).toBe(true);
    const mesh = state.result!.meshes[0]; expect(mesh.geometrySource).toBe(expectedGeometrySource); expect(mesh.bounds.max[0]).toBeCloseTo(80, 6);
    const expected = 80 * 40 * 12 - Math.PI * 9 * 12;
    expect(Math.abs(mesh.geometryAssertions!.volume - expected)).toBeLessThan(expected * 1e-8);
    expect(state.result?.metrics?.operationCount).toBe(2); expect(state.result?.metrics?.disposalFailures).toBe(0);
  }).toPass({ timeout: 30000 });
  const edited = (await snapshot()).result!;
  // A fresh page/worker is a genuine cold baseline for the same edited document.
  const savedDocument = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    return (await import(path)).useCadStore.getState().history.present;
  });
  await page.reload();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "edited.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(savedDocument)) });
  await expect(async () => { const state = await snapshot(); expect(state.status).toBe("succeeded"); expect(state.result?.metrics?.nativeFeatureCacheHits).toBe(0); expect(state.result?.metrics?.operationCount).toBe(2); }).toPass({ timeout: 30000 });
  const fresh = (await snapshot()).result!;
  expect(fresh.meshes.map(mesh => [mesh.bodyId, mesh.bounds, mesh.geometryAssertions, Array.from(mesh.positions), mesh.indices])).toEqual(edited.meshes.map(mesh => [mesh.bodyId, mesh.bounds, mesh.geometryAssertions, Array.from(mesh.positions), mesh.indices]));
});

if (expectedGeometrySource === "plainsolid") {
  test("large PlainSolid histories release replaced shapes and enforce the STEP body limit", async ({ page }) => {
    let document = createEmptyDocument("Bounded PlainSolid history");
    const rectangle = (width: number) => {
      const sketch = addCornerRectangle({ ...createXySketch(`Stock width ${width}`), solveMode: "validate" }, `${width}mm`, "12mm");
      document = upsertSketch(document, sketch);
      return { sketchId: sketch.id, profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id };
    };
    const stock = rectangle(70);
    const bodyIds: string[] = [];
    // Independent, coincident bodies exercise batch ownership without making
    // the fixture depend on an assembly solver or a curved Boolean.
    for (let i = 0; i < 48; i++) {
      const feature = createExtrudeFeature({ ...stock, name: `Stock ${i + 1}`, operation: "newBody", direction: "positive", distance: { expression: "5mm", unit: "mm" } });
      document = upsertFeature(document, feature);
      bodyIds.push(`body:${feature.id}`);
    }
    for (const [width, targets] of [[10, bodyIds], [20, bodyIds], [30, bodyIds.slice(0, 9)]] as const) {
      const cutter = rectangle(width);
      // Keep the fixture on simple, short Boolean chains; the stress here
      // is total allocations across the timeline, not one difficult solid.
      for (const target of targets) {
        document = upsertFeature(document, createExtrudeFeature({ ...cutter, name: `Cut to ${width}`, operation: "cut", targetBodyIds: [target], direction: "positive", distance: { expression: "5mm", unit: "mm" } }));
      }
    }
    await page.goto("/");
    await expect(page.getByText("Autosave ready", { exact: true })).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "bounded-history.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
    });
    await expect(async () => {
      const state = await aiSnapshot(page);
      expect(state.result).toMatchObject({ documentId: document.id, success: true, errors: [] });
      expect(state.result!.metrics?.shapeDisposalAttempts).toBeGreaterThan(256);
      expect(state.result!.metrics?.disposalFailures).toBe(0);
      expect(state.result!.meshes.map(mesh => mesh.bodyId)).toEqual(bodyIds);
      for (const [index, mesh] of state.result!.meshes.entries()) {
        expect(mesh).toMatchObject({ geometrySource: "plainsolid", geometryAssertions: { valid: true, solidCount: 1 } });
        expect(mesh.geometryAssertions!.volume).toBeCloseTo(index < 9 ? 2400 : 3000, 7);
      }
    }).toPass({ timeout: 45000 });
    await page.getByRole("button", { name: "Export STEP", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export STEP", exact: true });
    const options = dialog.getByRole("checkbox");
    await expect(options).toHaveCount(48);
    await expect(dialog.getByText("Select up to 32 bodies per STEP file.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Select all STEP bodies" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Generate validated STEP" })).toBeDisabled();
    for (let i = 0; i < 32; i++) await options.nth(i).check();
    await expect(options.nth(32)).toBeDisabled();
    await options.nth(0).uncheck();
    await expect(options.nth(32)).toBeEnabled();
  });
}
