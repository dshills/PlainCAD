import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";

async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => { const path = "/src/viewer/viewerDiagnostics.ts"; return (await import(path)).inspectViewer(); });
}
async function loadOrbit(page: Page) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("docs/examples/orbit-drive-housing.pcaddoc");
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.document.name).toBe("ORBIT drive housing");
    expect(state.status).toBe("succeeded");
    expect(state.result?.meshes).toHaveLength(1);
    expect(state.result!.meshes[0].geometrySource).toBe("opencascade");
    expect(state.result!.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(272452.36918433453, 4);
  }).toPass();
  await idle(page);
}
async function idle(page: Page) { await expect.poll(async () => (await viewer(page)).performance?.scheduled).toBe(false); }
async function drawsAfter(page: Page, action: () => Promise<unknown>) {
  const before = (await viewer(page)).performance!.frameCount;
  await action();
  await expect.poll(async () => (await viewer(page)).performance!.frameCount).toBeGreaterThan(before);
  await idle(page);
}

test("native viewport sleeps with solid labels, wakes for scene changes and keeps labels aligned during pan/resize", async ({ page }, info) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { viewerGpu: { draws: number; requests: number } };
    target.viewerGpu = { draws: 0, requests: 0 };
    const prototype = WebGL2RenderingContext.prototype;
    const elements = prototype.drawElements, arrays = prototype.drawArrays;
    prototype.drawElements = function (mode, count, type, offset) { target.viewerGpu.draws++; return elements.call(this, mode, count, type, offset); };
    prototype.drawArrays = function (mode, first, count) { target.viewerGpu.draws++; return arrays.call(this, mode, first, count); };
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => { target.viewerGpu.requests++; return request(callback); };
  });
  await loadOrbit(page);
  const original = await aiSnapshot(page);
  await drawsAfter(page, () => page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", state = (await import(path)).useCadStore.getState();
    state.select({ kind: "feature", id: state.history.present.features.find((feature: { type: string }) => feature.type === "extrude")!.id, documentId: state.history.present.id });
  }));
  const label = page.getByRole("group", { name: "Solid driving dimensions" });
  await expect(label).toBeVisible();
  const labelBefore = await label.getAttribute("style");
  const before = (await viewer(page)).performance!;
  const gpu = () => page.evaluate(() => (window as typeof window & { viewerGpu: { draws: number; requests: number } }).viewerGpu);
  const idleBefore = await gpu();
  await page.waitForTimeout(500);
  const idleAfter = await gpu();
  expect((await viewer(page)).performance).toMatchObject({ frameCount: before.frameCount, scheduled: false });
  expect(idleAfter).toEqual(idleBefore);
  const canvas = page.locator(".viewer-canvas canvas").first(), box = (await canvas.boundingBox())!;
  await drawsAfter(page, async () => {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 5 });
    await page.mouse.up({ button: "right" });
  });
  await expect(label).toBeVisible();
  expect(await label.getAttribute("style")).not.toBe(labelBefore);
  await drawsAfter(page, () => page.setViewportSize({ width: 1400, height: 900 }));
  await expect(label).toBeVisible();
  await drawsAfter(page, () => page.evaluate(async () => {
    const path = "/src/state/useThemeState.ts"; (await import(path)).useThemeState.getState().setTheme("dark");
  }));
  expect((await viewer(page)).background).toBe("161e26");
  await drawsAfter(page, () => page.evaluate(async () => {
    const statePath = "/src/state/useCadStore.ts", sectionPath = "/src/state/sectionState.ts";
    const state = (await import(statePath)).useCadStore.getState();
    (await import(sectionPath)).useSectionState.getState().setSection(state.documentSession, "Z", 0, true);
  }));
  expect((await viewer(page)).meshes[0].clippingEnabled).toBe(true);
  await drawsAfter(page, () => page.evaluate(async () => {
    const statePath = "/src/state/useCadStore.ts", sectionPath = "/src/state/sectionState.ts";
    const state = (await import(statePath)).useCadStore.getState();
    (await import(sectionPath)).useSectionState.getState().clear(state.documentSession);
  }));
  await drawsAfter(page, () => page.evaluate(async () => {
    const statePath = "/src/state/useCadStore.ts", inspectionPath = "/src/state/inspectionState.ts";
    const state = (await import(statePath)).useCadStore.getState(), inspection = (await import(inspectionPath)).useInspectionState.getState();
    const sketch = Object.values(state.history.present.sketches)[0] as { id: string; entities: Record<string, { id: string; type: string }> };
    const points = Object.values(sketch.entities).filter((entity) => entity.type === "point");
    inspection.setReference(state.documentSession, "first", { sketchId: sketch.id, entityId: points[0].id });
    inspection.setReference(state.documentSession, "second", { sketchId: sketch.id, entityId: points[1].id });
  }));
  expect((await viewer(page)).measurementLine).toHaveLength(6);
  await drawsAfter(page, () => page.evaluate(async () => {
    const statePath = "/src/state/useCadStore.ts", inspectionPath = "/src/state/inspectionState.ts";
    (await import(inspectionPath)).useInspectionState.getState().clear((await import(statePath)).useCadStore.getState().documentSession);
  }));
  expect((await viewer(page)).measurementLine).toEqual([]);
  const after = await aiSnapshot(page);
  expect(after.document).toEqual(original.document);
  expect(after.past).toBe(original.past);
  expect(after.result).toEqual(original.result);
  await writeFile(info.outputPath("viewer-idle.json"), JSON.stringify({ idleWindowMs: 500, before, idleBefore, idleAfter }, null, 2));
});

test("native ORBIT source points retain world coordinates in one marker batch and visibility disposes/recreates instances", async ({ page }, info) => {
  await loadOrbit(page);
  const original = await aiSnapshot(page), hidden = await viewer(page);
  expect(hidden.performance!.markerBatches).toBe(0);
  await drawsAfter(page, () => page.getByRole("button", { name: "Show all components", exact: true }).click());
  const shown = await viewer(page);
  expect(shown.sketchPoints.length).toBeGreaterThan(50);
  expect(shown.performance!.markerBatches).toBe(1);
  const expected = await page.evaluate(async () => {
    const statePath = "/src/state/useCadStore.ts", planePath = "/src/cad/sketch/planes.ts";
    const state = (await import(statePath)).useCadStore.getState(), { transformPoint } = await import(planePath);
    return Object.entries(state.rebuild.result.solvedSketches).flatMap(([id, solved]: [string, any]) => Object.values(solved.points).map((point: any) => {
      const world = transformPoint(state.rebuild.result.sketchPlanes[id], point.x, point.y);
      return { id: point.id as string, position: [world.x, world.y, world.z] };
    }));
  });
  expect(shown.sketchPoints).toHaveLength(expected.length);
  for (const point of expected) {
    const rendered = shown.sketchPoints.find((candidate) => candidate.id === point.id)!;
    rendered.position.forEach((value, axis) => expect(value).toBeCloseTo(point.position[axis], 3));
  }
  const checkbox = page.getByRole("checkbox", { name: /^Show sketch .* in 3D$/ }).first();
  await drawsAfter(page, () => checkbox.uncheck());
  expect((await viewer(page)).sketchPoints.length).toBeLessThan(expected.length);
  await drawsAfter(page, () => checkbox.check());
  expect((await viewer(page)).sketchPoints).toEqual(shown.sketchPoints);
  expect((await viewer(page)).resources).toEqual(shown.resources);
  const after = await aiSnapshot(page);
  expect(after.document).toEqual(original.document);
  expect(after.result).toEqual(original.result);
  await page.screenshot({ path: info.outputPath("orbit-batched-markers.png") });
  await writeFile(info.outputPath("marker-batches.json"), JSON.stringify({ points: expected.length, markerBatches: shown.performance!.markerBatches, hiddenDrawCalls: hidden.performance!.drawCalls, shownDrawCalls: shown.performance!.drawCalls }, null, 2));
});
