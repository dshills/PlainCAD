import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

test("large example edits reuse exact edge proofs without stale native geometry", async ({ page }, info) => {
  test.setTimeout(180000);
  const doc = JSON.parse(await readFile("docs/examples/10-rotary-fixture.pcaddoc", "utf8")) as CadDocument;
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "fixture.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  const snapshot = () => page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return { status: state.rebuild.status, name: state.history.present.name, thickness: state.history.present.parameters.platter_thickness?.expression, result: state.rebuild.result as RebuildResult | undefined };
  });
  await expect(async () => {
    const s = await snapshot();
    expect(s.status).toBe("succeeded"); expect(s.result?.success).toBe(true);
    expect(s.result?.meshes).toHaveLength(40);
  }).toPass({ timeout: 90000 });
  const cold = (await snapshot()).result!;
  expect(cold.metrics?.nativeEdgeProofCacheMisses).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.getState().updateDocument((d: CadDocument) => ({ ...d, name: "Renamed fixture" }));
  });
  await expect(async () => {
    const s = await snapshot();
    expect(s.name).toBe("Renamed fixture"); expect(s.status).toBe("succeeded");
    expect(s.result?.metrics?.nativeEdgeProofCacheHits).toBeGreaterThan(0);
    expect((s.result?.metrics?.nativeEdgeProofCacheHits ?? 0) + (s.result?.metrics?.nativeEdgeProofCacheMisses ?? 0)).toBe(cold.metrics?.nativeEdgeProofCacheMisses);
  }).toPass({ timeout: 90000 });
  const warm = (await snapshot()).result!;
  expect(warm.availableEdges).toEqual(cold.availableEdges);
  expect(warm.meshes.map((m) => [m.bodyId, m.bounds, m.geometryAssertions])).toEqual(cold.meshes.map((m) => [m.bodyId, m.bounds, m.geometryAssertions]));
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.getState().updateParameter("platter_thickness", { expression: "13mm" });
  });
  await expect(async () => {
    const s = await snapshot();
    expect(s.status).toBe("succeeded"); expect(s.result?.success).toBe(true);
    expect(s.result?.metrics?.nativeEdgeProofCacheHits).toBeGreaterThan(0);
    expect(s.result?.metrics?.nativeEdgeProofCacheMisses).toBeGreaterThan(0);
    expect(s.result?.meshes).toHaveLength(40);
    expect(s.thickness).toBe("13mm");
    expect(s.result!.meshes.reduce((sum, m) => sum + m.geometryAssertions!.volume, 0)).not.toBeCloseTo(warm.meshes.reduce((sum, m) => sum + m.geometryAssertions!.volume, 0), 2);
  }).toPass({ timeout: 90000 });
  const edited = (await snapshot()).result!;
  expect(edited.meshes.every((m) => m.geometrySource === "opencascade" && m.geometryAssertions?.valid)).toBe(true);
  expect(edited.metrics?.disposalFailures).toBe(0);
  expect(edited.meshes.reduce((sum, m) => sum + m.geometryAssertions!.volume, 0)).not.toBeCloseTo(cold.meshes.reduce((sum, m) => sum + m.geometryAssertions!.volume, 0), 2);
  const report = { scope: "40-body rotary fixture: cold load, rename, platter thickness edit", cold: { durationMs: cold.durationMs, ...cold.metrics }, warm: { durationMs: warm.durationMs, ...warm.metrics }, edited: { durationMs: edited.durationMs, ...edited.metrics } };
  await writeFile(info.outputPath("large-edge-proofs.json"), JSON.stringify(report, null, 2));
  await info.attach("large-edge-proofs", { body: JSON.stringify(report), contentType: "application/json" });
});
