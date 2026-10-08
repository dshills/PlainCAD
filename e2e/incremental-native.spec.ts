import { test, expect } from "@playwright/test";
import { nativeBenchmarkDocument } from "./nativeBenchmarkFixture";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

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
    const mesh = state.result!.meshes[0]; expect(mesh.geometrySource).toBe("opencascade"); expect(mesh.bounds.max[0]).toBeCloseTo(80, 6);
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
