import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import {
  nativeBenchmarkDocument,
  WARMUP,
  TRIALS,
  EXPORT_WARMUP,
  EXPORT_TRIALS,
} from "./nativeBenchmarkFixture";

async function state(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const s = (await import(path)).useCadStore.getState();
    return {
      documentId: s.history.present.id,
      expression: s.history.present.parameters.width?.expression,
      status: s.rebuild.status,
      result: s.rebuild.result as RebuildResult | undefined,
    };
  });
}
async function ready(page: Page, documentId: string, width: number) {
  await expect(async () => {
    const s = await state(page);
    expect(s.documentId).toBe(documentId);
    expect(s.expression).toBe(`${width}mm`);
    expect(s.status).toBe("succeeded");
    expect(s.result?.success).toBe(true);
    expect(s.result?.documentId).toBe(documentId);
    expect(s.result?.meshes).toHaveLength(1);
    const mesh = s.result!.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.kernelOperation).toBe("cut");
    expect(mesh.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    const expected = width * 40 * 12 - Math.PI * 9 * 12;
    expect(
      Math.abs(mesh.geometryAssertions!.volume - expected) / expected,
    ).toBeLessThan(1e-7);
    expect(mesh.bounds.max[0]).toBeCloseTo(width, 4);
    expect(s.result!.metrics?.disposalFailures).toBe(0);
  }).toPass({ timeout: 20000, intervals: [25, 50, 100] });
}
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}
test("controlled native rebuild/export timings and bounded viewer/WASM resource growth", async ({
  page,
  browser,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const doc = nativeBenchmarkDocument();
  const coldStart = performance.now();
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "benchmark.pcaddoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc)),
  });
  await ready(page, doc.id, 60);
  const coldLoadToFirstModelMs = performance.now() - coldStart;
  const measurements = page.getByRole("region", { name: "Measurements" });
  await measurements.getByText("Choose sketch geometry by name", { exact: true }).click();
  await measurements
    .getByLabel("Measurement first point")
    .selectOption({ label: "Benchmark base — point 1" });
  await measurements
    .getByLabel("Measurement second point")
    .selectOption({ label: "Benchmark base — point 3" });
  const section = page.getByRole("region", { name: "View controls" });
  const samples = [];
  for (let i = 0; i < WARMUP + TRIALS; i++) {
    const width = 61 + i;
    const started = performance.now();
    const input = page.getByLabel("Parameter width expression", {
      exact: true,
    });
    await input.fill(`${width}mm`);
    await input.press("Enter");
    await ready(page, doc.id, width);
    const editToCurrentModelMs = performance.now() - started;
    await section.getByLabel("Section axis").selectOption(i % 2 ? "X" : "Off");
    const resources = await page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const path = "/src/viewer/viewerDiagnostics.ts";
      const memory = (
        performance as Performance & { memory?: { usedJSHeapSize: number } }
      ).memory;
      return {
        viewer: (await import(path)).inspectViewer().resources,
        jsHeapUsedBytes: memory?.usedJSHeapSize,
      };
    });
    const s = await state(page),
      result = s.result!,
      metrics = result.metrics!;
    expect(metrics.scopedHandles.registered).toBeGreaterThan(0);
    expect(metrics.scopedHandles.registered).toBe(
      metrics.scopedHandles.disposed +
        metrics.scopedHandles.released +
        metrics.scopedHandles.alreadyDeleted +
        metrics.scopedHandles.failures,
    );
    expect(metrics.wasmHeapCapacityBytes).toBeGreaterThan(0);
    samples.push({
      iteration: i,
      widthMm: width,
      warmup: i < WARMUP,
      editToCurrentModelMs,
      rebuildMs: result.durationMs,
      ...metrics,
      ...resources,
      triangles: result.meshes[0].indices.length / 3,
      nativeVolumeMm3: result.meshes[0].geometryAssertions!.volume,
    });
  }
  const exports = [];
  for (let i = 0; i < EXPORT_WARMUP + EXPORT_TRIALS; i++) {
    const output = await page.evaluate(async () => {
      const storePath = "/src/state/useCadStore.ts",
        exportPath = "/src/fabrication/exportClient.ts";
      const state = (await import(storePath)).useCadStore.getState();
      const started = performance.now();
      const output = await (
        await import(exportPath)
      ).exportFabrication(
        {
          document: state.history.present,
          meshes: state.rebuild.result.meshes,
          bodies: state.rebuild.result.bodies,
          mode: "separate",
          fullChecks: true,
        },
        new AbortController().signal,
        () => {},
      );
      return {
        workerRoundTripMs: performance.now() - started,
        metrics: output.metrics,
        warnings: output.warnings,
        bytes: output.file.bytes.byteLength,
        triangles: output.triangleCount,
      };
    });
    expect(output.warnings).toEqual([]);
    expect(output.bytes).toBe(84 + output.triangles * 50);
    exports.push({ warmup: i < EXPORT_WARMUP, ...output });
  }
  const measured = samples.filter((sample) => !sample.warmup),
    first = measured[0];
  const bounds = {
    geometryGrowth: 8,
    textureGrowth: 1,
    programGrowth: 4,
    wasmCapacityGrowthBytes: 64 * 1024 * 1024,
  };
  const report = {
    reportVersion: 1,
    scenario:
      "XY rectangle → 12mm extrusion → native circular through-cut; UI width edits, distance overlay and alternating section clipping",
    recordedAt: new Date().toISOString(),
    environment: {
      browser: browser.version(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: page.viewportSize(),
      os: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      node: process.version,
      developmentBuild: true,
    },
    counts: {
      parameters: 1,
      sketches: 2,
      features: 2,
      bodies: 1,
      warmup: WARMUP,
      measured: TRIALS,
      exportsMeasured: EXPORT_TRIALS,
    },
    coldLoadToFirstModelMs,
    timingsMs: Object.fromEntries(
      (
        [
          "editToCurrentModelMs",
          "rebuildMs",
          "parameterEvaluationMs",
          "sketchSolveMs",
          "profileDetectionMs",
          "featureRebuildMs",
        ] as const
      ).map((key) => [key, distribution(measured.map((s) => s[key]))]),
    ),
    exportTimingsMs: {
      workerRoundTrip: distribution(
        exports.slice(EXPORT_WARMUP).map((s) => s.workerRoundTripMs),
      ),
      meshValidation: distribution(
        exports.slice(EXPORT_WARMUP).map((s) => s.metrics!.meshValidationMs),
      ),
      encoding: distribution(
        exports.slice(EXPORT_WARMUP).map((s) => s.metrics!.encodingMs),
      ),
    },
    bounds,
    samples,
    exports,
    limitations: [
      "WASM capacity is allocated buffer size, not live allocations or a leak proof.",
      "JS heap is optional Chromium telemetry and is not asserted because GC/process sharing varies.",
      "cacheSize reports per-rebuild runtime body entries, not persistent tessellation cache occupancy.",
      "Timings report this bounded development Chromium scenario; shared-CI latency has no hard threshold.",
      "Edit-to-model includes UI/automation/debounce; exports include fresh export worker startup.",
    ],
  };
  const path = info.outputPath("performance.json");
  await writeFile(path, JSON.stringify(report, null, 2));
  await info.attach("controlled-performance", {
    path,
    contentType: "application/json",
  });
  for (const sample of measured) {
    expect(sample.viewer.geometries).toBeLessThanOrEqual(
      first.viewer.geometries + bounds.geometryGrowth,
    );
    expect(sample.viewer.textures).toBeLessThanOrEqual(
      first.viewer.textures + bounds.textureGrowth,
    );
    expect(sample.viewer.programs).toBeLessThanOrEqual(
      first.viewer.programs + bounds.programGrowth,
    );
    expect(sample.wasmHeapCapacityBytes!).toBeLessThanOrEqual(
      first.wasmHeapCapacityBytes! + bounds.wasmCapacityGrowthBytes,
    );
    expect(sample.cacheSize).toBeLessThanOrEqual(doc.features.length);
    for (const duration of [
      sample.rebuildMs,
      sample.parameterEvaluationMs,
      sample.sketchSolveMs,
      sample.profileDetectionMs,
      sample.featureRebuildMs,
    ])
      expect(Number.isFinite(duration) && duration >= 0).toBe(true);
  }
  expect(errors).toEqual([]);
});
