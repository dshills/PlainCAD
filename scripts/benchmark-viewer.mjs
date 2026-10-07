import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const origin = process.env.PLAINCAD_BENCHMARK_URL ?? "http://127.0.0.1:5278";
const output = resolve(process.argv[2] ?? "test-results/viewer-interaction.json");
const browser = await chromium.launch({ headless: true });
const reports = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    window.__glMeasure = { draws: 0, uploads: 0, bytes: 0 };
    for (const type of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const method of ["drawElements", "drawArrays", "bufferData"]) {
        const original = type.prototype[method];
        type.prototype[method] = function (...args) {
          const metrics = window.__glMeasure;
          if (method === "bufferData") {
            metrics.uploads++;
            metrics.bytes += typeof args[1] === "number" ? args[1] : args[1]?.byteLength ?? 0;
          } else metrics.draws++;
          return original.apply(this, args);
        };
      }
    }
  });
  for (const file of ["orbit-drive-housing", "10-rotary-fixture"]) {
    await page.goto(origin);
    await page.locator('input[type="file"]').setInputFiles(resolve(root, `docs/examples/${file}.pcaddoc`));
    const count = file === "orbit-drive-housing" ? 1 : 40;
    let snapshot;
    for (let attempt = 0; attempt < 240; attempt++) {
      snapshot = await page.evaluate(async () => {
        const { useCadStore } = await import("/src/state/useCadStore.ts");
        const state = useCadStore.getState();
        return { name: state.history.present.name, status: state.rebuild.status, session: state.documentSession,
          meshes: state.rebuild.result?.meshes.map((mesh) => ({ id: mesh.bodyId, triangles: mesh.indices.length / 3, source: mesh.geometrySource, volume: mesh.geometryAssertions?.volume })) };
      });
      if (snapshot.session > 0 && snapshot.status === "succeeded" && snapshot.meshes?.length === count) break;
      await page.waitForTimeout(100);
    }
    if (snapshot.status !== "succeeded" || snapshot.meshes?.length !== count || !snapshot.meshes.every((mesh) => mesh.source === "opencascade" && mesh.volume > 0))
      throw new Error("Expected native model is unavailable. Restart the development server before measuring.");
    await page.waitForTimeout(1000);
    const box = await page.locator(".viewer-canvas canvas").first().boundingBox();
    if (!box) throw new Error("Viewer is unavailable.");
    const before = await page.evaluate(() => ({ ...window.__glMeasure }));
    await page.evaluate(() => {
      window.__frameTimes = [];
      let last;
      function sample(time) {
        if (last) window.__frameTimes.push(time - last);
        last = time;
        window.__sampleRaf = requestAnimationFrame(sample);
      }
      window.__sampleRaf = requestAnimationFrame(sample);
    });
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    for (let index = 0; index < 100; index++) {
      await page.mouse.move(box.x + box.width * (0.5 + 0.2 * Math.sin(index / 20)), box.y + box.height * (0.5 + 0.1 * Math.sin(index / 15)));
      await page.waitForTimeout(10);
    }
    const active = await page.evaluate(() => {
      const canvas = document.querySelector(".viewer-canvas canvas");
      const samples = window.__frameTimes.slice().sort((a, b) => a - b);
      if (!samples.length) throw new Error("No animation frames were observed during movement.");
      return { draws: window.__glMeasure.draws, width: canvas.width, height: canvas.height, frames: samples.length,
        p50: samples[Math.ceil(samples.length * 0.5) - 1], p95: samples[Math.ceil(samples.length * 0.95) - 1] };
    });
    await page.mouse.up();
    await page.evaluate(() => cancelAnimationFrame(window.__sampleRaf));
    for (let attempt = 0; attempt < 100; attempt++) {
      const moving = await page.evaluate(async () => {
        const { inspectViewer } = await import("/src/viewer/viewerDiagnostics.ts");
        const viewer = inspectViewer();
        if (!viewer) throw new Error("Viewer diagnostics are unavailable.");
        return viewer.performance?.moving ?? false;
      });
      if (!moving) break;
      await page.waitForTimeout(100);
    }
    const settled = await page.evaluate(() => {
      const canvas = document.querySelector(".viewer-canvas canvas");
      return { width: canvas.width, height: canvas.height };
    });
    let edit;
    if (file === "10-rotary-fixture") {
      const uploads = await page.evaluate(() => ({ ...window.__glMeasure }));
      await page.evaluate(async () => {
        const { useCadStore } = await import("/src/state/useCadStore.ts");
        useCadStore.getState().updateParameter("platter_thickness", { expression: "16mm" });
      });
      for (let attempt = 0; attempt < 240; attempt++) {
        const ready = await page.evaluate(async () => {
          const { useCadStore } = await import("/src/state/useCadStore.ts");
          return useCadStore.getState().rebuild.status === "succeeded";
        });
        if (ready) break;
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(300);
      const current = await page.evaluate(async () => {
        const { useCadStore } = await import("/src/state/useCadStore.ts");
        const state = useCadStore.getState();
        return { status: state.rebuild.status, expression: state.history.present.parameters.platter_thickness.expression, bodies: state.rebuild.result?.meshes.length };
      });
      if (current.status !== "succeeded" || current.expression !== "16mm" || current.bodies !== 40) throw new Error("Edit did not produce the current fixture geometry.");
      const after = await page.evaluate(() => ({ ...window.__glMeasure }));
      edit = { uploads: after.uploads - uploads.uploads, bytes: after.bytes - uploads.bytes };
    }
    reports.push({ file, bodies: count, triangles: snapshot.meshes.reduce((sum, mesh) => sum + mesh.triangles, 0), allNative: true,
      active: { ...active, draws: active.draws - before.draws }, settled, edit });
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(reports, null, 2) + "\n");
  console.log(`Viewer measurements saved to ${output}`);
} finally {
  await browser.close();
}
