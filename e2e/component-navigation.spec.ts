import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
async function ready(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/state/useCadStore.ts",
          state = (await import(path)).useCadStore.getState();
        return state.rebuild.status;
      }),
    )
    .toBe("succeeded");
}
async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer();
  });
}
test("component visibility/isolation filters native bodies, sketch overlays and fit without modeling edits; timeline ownership and view reset", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  const authored = await page.evaluate(async () => {
    const dp = "/src/cad/document/CadDocument.ts",
      cp = "/src/cad/document/components.ts",
      sp = "/src/cad/sketch/SketchModel.ts",
      pp = "/src/cad/sketch/profileDetection.ts",
      rp = "/src/cad/sketch/SketchSolver.ts",
      statePath = "/src/state/useCadStore.ts";
    const ops = await import(dp),
      { addComponent } = await import(cp),
      model = await import(sp),
      { solveSketch } = await import(rp),
      { detectProfiles } = await import(pp),
      { useCadStore } = await import(statePath);
    let document = ops.createEmptyDocument("Navigation project");
    for (const [i, name] of ["Bracket", "Cover"].entries()) {
      const added = addComponent(document, name);
      let sketch = model.addCornerRectangle(
        model.createXySketch(`${name} section`),
        "20mm",
        "10mm",
      );
      sketch = {
        ...sketch,
        componentId: added.component.id,
        entities: Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]: [string, any]) => [
            id,
            e.type === "point"
              ? {
                  ...e,
                  x: {
                    ...e.x,
                    expression: `(${e.x.expression}) + ${i * 100}mm`,
                  },
                }
              : e,
          ]),
        ),
      };
      document = ops.upsertSketch(added.document, sketch);
      document = ops.upsertFeature(
        document,
        ops.createExtrudeFeature({
          name: `${name} solid`,
          sketchId: sketch.id,
          profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
          operation: "newBody",
          direction: "positive",
          distance: { expression: "10mm", unit: "mm" },
        }),
      );
    }
    useCadStore.getState().setDocument(document);
    return JSON.stringify(document);
  });
  await ready(page);
  const original = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    return {
      document: JSON.stringify(state.history.present),
      result: state.rebuild.result,
      past: state.history.past.length,
    };
  });
  expect(original.document).toBe(authored);
  expect(original.result.success).toBe(true);
  for (const mesh of original.result.meshes) {
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(mesh.geometryAssertions.volume).toBeCloseTo(2000, 7);
  }
  const allPoints = (await viewer(page)).sketchPoints.length;
  expect(allPoints).toBeGreaterThan(0);
  await page.getByLabel("Show component Cover", { exact: true }).uncheck();
  await expect
    .poll(async () => (await viewer(page)).meshes.map((m) => m.visible))
    .toEqual([true, false]);
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(allPoints / 2);
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
  await expect
    .poll(async () => (await viewer(page)).cameraTarget)
    .toEqual([10, 5, 5]);
  await page
    .getByRole("button", { name: "Isolate component Cover", exact: true })
    .click();
  await expect
    .poll(async () => (await viewer(page)).meshes.map((m) => m.visible))
    .toEqual([false, true]);
  await expect(
    page.getByLabel("Show component Cover", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
  await expect
    .poll(async () => (await viewer(page)).cameraTarget)
    .toEqual([110, 5, 5]);
  await page
    .getByRole("button", { name: "Activate component Cover", exact: true })
    .click();
  const track = page.getByRole("list", { name: "Sketch and feature history" });
  await expect(track.getByRole("listitem")).toHaveCount(4);
  await expect(
    track.locator(".timeline-owner", { hasText: "Cover" }),
  ).toHaveCount(2);
  await page
    .getByLabel("Timeline: active component only", { exact: true })
    .check();
  await expect(track.getByRole("listitem")).toHaveCount(2);
  await expect(track).toContainText("Cover solid");
  await expect(track).not.toContainText("Bracket solid");
  await page
    .getByRole("button", { name: "Activate component Bracket", exact: true })
    .click();
  await expect(track).toContainText("Bracket solid");
  await expect(track).not.toContainText("Cover solid");
  const unchanged = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    return {
      document: JSON.stringify(state.history.present),
      result: state.rebuild.result,
      past: state.history.past.length,
    };
  });
  expect(unchanged).toEqual(original);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("navigation.pcaddoc");
  await (await download).saveAs(path);
  expect(await readFile(path, "utf8")).not.toMatch(
    /hiddenComponentIds|hiddenBodyIds|activeComponentTimeline/,
  );
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await ready(page);
  await expect(
    page.getByLabel("Timeline: active component only", { exact: true }),
  ).not.toBeChecked();
  await expect
    .poll(async () => (await viewer(page)).meshes.map((m) => m.visible))
    .toEqual([true, true]);
  await expect
    .poll(async () => (await viewer(page)).sketchPoints.length)
    .toBe(allPoints);
  await expect(track.getByRole("listitem")).toHaveCount(4);
  await page.screenshot({
    path: info.outputPath("component-navigation.png"),
    fullPage: true,
  });
});
