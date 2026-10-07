import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform } from "node:os";
import { CONTENT_SECURITY_POLICY } from "../deployment/securityHeaders";
import {
  nativeBenchmarkDocument,
  TRIALS,
  WARMUP,
  EXPORT_WARMUP,
  EXPORT_TRIALS,
} from "../e2e/nativeBenchmarkFixture";

function nativeVolume(width: number) {
  return width * 40 * 12 - Math.PI * 9 * 12;
}
async function currentNativeBody(page: Page, width: number) {
  await expect(
    page.getByLabel("Parameter width expression", { exact: true }),
  ).toHaveValue(`${width}mm`);
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page
    .locator(".body-row")
    .getByRole("button", { name: "Benchmark solid", exact: true })
    .click();
  // Native BRep assertions have a public volume/solid readout; fallback meshes do not.
  const volumeReadout = page
    .getByText("Volume (mm³)", { exact: true })
    .locator("..")
    .locator("dd");
  await expect
    .poll(async () =>
      Math.abs(Number(await volumeReadout.textContent()) - nativeVolume(width)),
    )
    .toBeLessThan(0.001);
  await expect(
    page.getByText("Solids", { exact: true }).locator("..").locator("dd"),
  ).toHaveText("1");
  await expect(
    page.getByText("Bounds", { exact: true }).locator("..").locator("dd"),
  ).toHaveText(`0.000, 0.000, 0.000 to ${width.toFixed(3)}, 40.000, 12.000`);
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  return Number(
    await page
      .getByText("Volume (mm³)", { exact: true })
      .locator("..")
      .locator("dd")
      .textContent(),
  );
}
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  for (const value of sorted)
    expect(Number.isFinite(value) && value >= 0).toBe(true);
  return {
    min: sorted[0],
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}
function exportedGeometry(bytes: Buffer, width: number, triangleCount: number) {
  expect(bytes.length).toBeGreaterThanOrEqual(84);
  const triangles = bytes.readUInt32LE(80);
  expect(triangles).toBe(triangleCount);
  expect(bytes.length).toBe(84 + 50 * triangles);
  let signedVolume = 0;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangles; i++) {
    const offset = 84 + i * 50;
    for (let axis = 0; axis < 3; axis++)
      expect(Number.isFinite(bytes.readFloatLE(offset + 4 * axis))).toBe(true);
    const p = Array.from({ length: 9 }, (_, j) =>
      bytes.readFloatLE(offset + 12 + j * 4),
    );
    for (let j = 0; j < 9; j++) {
      expect(Number.isFinite(p[j])).toBe(true);
      min[j % 3] = Math.min(min[j % 3], p[j]);
      max[j % 3] = Math.max(max[j % 3], p[j]);
    }
    signedVolume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  expect(signedVolume).toBeGreaterThan(0);
  expect(Math.abs(signedVolume / nativeVolume(width) - 1)).toBeLessThan(0.001);
  for (let axis = 0; axis < 3; axis++) {
    expect(min[axis]).toBeCloseTo(0, 5);
    expect(max[axis]).toBeCloseTo([width, 40, 12][axis], 5);
  }
  return {
    triangles,
    signedVolumeMm3: signedVolume,
    bytes: bytes.length,
    min,
    max,
  };
}

test("production CSP: controlled current-native-model and validated STL download timings", async ({
  page,
  browser,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const document = nativeBenchmarkDocument();
  const started = performance.now();
  const response = await page.goto("/");
  expect(response!.headers()["content-security-policy"]).toBe(
    CONTENT_SECURITY_POLICY,
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "production-benchmark.pcaddoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await currentNativeBody(page, 60);
  const coldLoadToFirstModelMs = performance.now() - started;
  expect(
    Number.isFinite(coldLoadToFirstModelMs) && coldLoadToFirstModelMs >= 0,
  ).toBe(true);
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
    const width = 61 + i,
      editStart = performance.now();
    const input = page.getByLabel("Parameter width expression", {
      exact: true,
    });
    await input.fill(`${width}mm`);
    await input.press("Enter");
    const observedNativeVolumeMm3 = await currentNativeBody(page, width);
    const editToCurrentModelMs = performance.now() - editStart;
    await section.getByLabel("Section axis").selectOption(i % 2 ? "X" : "Off");
    const jsHeapUsedBytes = await page.evaluate(
      () =>
        (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize,
    );
    samples.push({
      iteration: i,
      widthMm: width,
      warmup: i < WARMUP,
      editToCurrentModelMs,
      expectedNativeVolumeMm3: nativeVolume(width),
      observedNativeVolumeMm3,
      jsHeapUsedBytes,
    });
  }
  await section.getByLabel("Section axis").selectOption("Off");
  const width = 60 + WARMUP + TRIALS;
  const triangleCount = Number(
    await page
      .getByText("Triangles", { exact: true })
      .locator("..")
      .locator("dd")
      .textContent(),
  );
  expect(Number.isInteger(triangleCount) && triangleCount > 0).toBe(true);
  const exports = [];
  for (let i = 0; i < EXPORT_WARMUP + EXPORT_TRIALS; i++) {
    const downloadReady = page.waitForEvent("download"),
      exportStart = performance.now();
    // The normal single-body command performs full mesh checks in a fresh export worker.
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const download = await downloadReady;
    const exportToDownloadMs = performance.now() - exportStart;
    const stlPath = info.outputPath(`production-benchmark-${i}.stl`);
    await download.saveAs(stlPath);
    expect(await download.failure()).toBeNull();
    const geometry = exportedGeometry(
      await readFile(stlPath),
      width,
      triangleCount,
    );
    exports.push({
      warmup: i < EXPORT_WARMUP,
      exportToDownloadMs,
      ...geometry,
    });
  }
  const measured = samples.filter((sample) => !sample.warmup);
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
      developmentBuild: false,
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
    timingsMs: {
      editToCurrentModel: distribution(
        measured.map((sample) => sample.editToCurrentModelMs),
      ),
      exportToDownload: distribution(
        exports.slice(EXPORT_WARMUP).map((sample) => sample.exportToDownloadMs),
      ),
    },
    samples,
    exports,
    telemetry: {
      kernelPhases: "unavailable",
      viewerResources: "unavailable",
      wasmCapacity: "unavailable",
      exportPhases: "unavailable",
    },
    limitations: [
      "Timings include UI automation, rebuild debounce/scheduling and public body inspection/readout observation; export includes fresh worker startup and download initiation, excluding saveAs and test-side STL parsing.",
      "Native volumes are verified through the public BRep readout rounded to three decimals; every exported STL also verifies signed volume, finite coordinates, triangle count and global bounds.",
      "Production exposes no development store or viewer instrumentation. Internal phase timings and viewer/WASM resource counts are unavailable, not zero.",
      "Optional Chromium JS heap telemetry has no threshold because GC/process sharing varies; this test does not assert resource growth or prove absence of leaks.",
      "This bounded Chromium workload has no hard shared-CI latency threshold; complex documents and other browsers still require broader measurements.",
    ],
  };
  const reportPath = info.outputPath("performance.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await info.attach("controlled-production-performance", {
    path: reportPath,
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});
