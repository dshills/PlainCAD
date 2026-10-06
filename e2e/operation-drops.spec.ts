import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";
import type { OperationTargetSnapshot } from "../src/viewer/operationDropPicking";

async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    expect(state.result?.documentId).toBe(state.document.id);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      const mesh = state.result!.meshes[0];
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      // Relative 1e-7 matches native acceptance elsewhere and allows only
      // 0.000134 mm³ at the largest authored-edge fixture volume (1340 mm³).
      expect(Math.abs(mesh.geometryAssertions!.volume / volume - 1), `Native BRep volume ${mesh.geometryAssertions!.volume}; expected ${volume}`).toBeLessThan(1e-7);
    }
  }).toPass({ timeout: 30000 });
}
async function fixture(page: Page, plane: "XY" | "XZ" | "YZ" = "XY") {
  await page.goto("/");
  await ready(page);
  const ids = await page.evaluate(async (plane) => {
    const docsPath = "/src/cad/document/CadDocument.ts",
      geometryPath = "/src/cad/sketch/canvasGeometry.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      solverPath = "/src/cad/sketch/SketchSolver.ts",
      statePath = "/src/state/useCadStore.ts";
    const docs = await import(docsPath),
      { addCanvasGeometry } = await import(geometryPath),
      { createSketchOnPlane } = await import(modelPath),
      { solveSketch } = await import(solverPath),
      { useCadStore } = await import(statePath);
    let document = docs.upsertParameter(
      docs.createEmptyDocument("Operation target model"),
      {
        id: "height",
        name: "height",
        expression: "10mm",
        value: 10,
        unit: "mm",
      },
    );
    const ids = [];
    for (const [name, start, end] of [
      ["First profile", { x: -10, y: -6 }, { x: 10, y: 6 }],
      ["Loose profile", { x: 35, y: -4 }, { x: 47, y: 4 }],
    ] as const) {
      let sketch = createSketchOnPlane(name, plane);
      sketch = addCanvasGeometry(
        sketch,
        solveSketch(sketch, {}),
        "rectangle",
        [start, end],
        false,
      ).sketch;
      document = docs.upsertSketch(document, sketch);
      ids.push(sketch.id);
    }
    useCadStore.getState().setDocument(document);
    return ids;
  }, plane);
  await ready(page);
  return ids;
}
async function viewportLocal(
  page: Page,
  sketchId: string,
  x: number,
  y: number,
  normal = 0,
) {
  const point = await page.evaluate(
    async ({ sketchId, x, y, normal }) => {
      const statePath = "/src/state/useCadStore.ts",
        planePath = "/src/cad/sketch/planes.ts",
        viewerPath = "/src/viewer/viewerDiagnostics.ts";
      const state = (await import(statePath)).useCadStore.getState();
      const world = (await import(planePath)).transformPoint(
        state.rebuild.result.sketchPlanes[sketchId],
        x,
        y,
        normal,
      );
      return (await import(viewerPath)).projectViewerPoint([
        world.x,
        world.y,
        world.z,
      ]);
    },
    { sketchId, x, y, normal },
  );
  if (!point) throw new Error("Viewer projection unavailable");
  const canvas = page.locator(".viewer-canvas canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Viewer canvas unavailable");
  return {
    canvas,
    local: { x: point.x, y: point.y },
    screen: { x: box.x + point.x, y: box.y + point.y },
  };
}
for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane} operation tokens target actual viewport profiles/cap groups, preview native geometry, edit/save/open/STL`, async ({
    page,
  }, info) => {
    const [, sketchId] = await fixture(page, plane);
    const before = await aiSnapshot(page);
    const profile = await viewportLocal(page, sketchId, 41, 0);
    await page
      .getByRole("button", { name: "Use Extrude on geometry", exact: true })
      .dragTo(profile.canvas, { targetPosition: profile.local });
    const extrude = page.getByRole("dialog", { name: "Extrude", exact: true });
    await expect(extrude).toBeVisible();
    await page.getByLabel("Extrude distance", { exact: true }).fill("height");
    expect((await aiSnapshot(page)).document).toEqual(before.document);
    await applyExtrusion(page);
    await ready(page, 960);
    const solid = await aiSnapshot(page);
    const source = solid.document.features[0];
    expect(source.type).toBe("extrude");
    if (source.type !== "extrude") throw new Error("Extrusion missing");
    expect(source.sketchId).toBe(sketchId);
    expect(solid.past).toBe(before.past + 1);
    await page
      .getByRole("button", { name: "Use Fillet on geometry", exact: true })
      .click();
    const cap = await viewportLocal(page, sketchId, 47, 0, 10);
    await page.mouse.click(cap.screen.x, cap.screen.y);
    const fillet = page.getByRole("dialog", { name: "Fillet", exact: true });
    await expect(fillet).toBeVisible();
    await expect(fillet.getByRole("status")).toContainText(
      "Native preview ready",
    );
    expect((await aiSnapshot(page)).document).toEqual(solid.document);
    await fillet
      .getByRole("button", { name: "Apply fillet", exact: true })
      .click();
    await ready(page);
    const rounded = await aiSnapshot(page),
      volume = rounded.result!.meshes[0].geometryAssertions!.volume;
    expect(rounded.result!.meshes[0].kernelOperation).toBe("fillet");
    expect(volume).toBeLessThan(959);
    expect(volume).toBeGreaterThan(850);
    expect(rounded.past).toBe(solid.past + 1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await ready(page, 960);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await ready(page, volume);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await ready(page, 960);
    await page
      .getByRole("button", { name: "Use Chamfer on geometry", exact: true })
      .click();
    const card = page.getByRole("button", {
      name: `Preview on ${source.name} — start cap perimeter (all original edges)`,
      exact: true,
    });
    await card.focus();
    await card.press("Enter");
    const chamfer = page.getByRole("dialog", { name: "Chamfer", exact: true });
    await expect(chamfer.getByRole("status")).toContainText(
      "Native preview ready",
    );
    expect((await aiSnapshot(page)).document).toEqual(solid.document);
    await chamfer
      .getByRole("button", { name: "Apply chamfer", exact: true })
      .click();
    await ready(page, 941.3333333333333);
    const height = page.getByRole("textbox", {
      name: "Parameter height expression",
      exact: true,
    });
    await height.fill("14mm");
    await height.press("Enter");
    await ready(page, 1325.3333333333333);
    const final = await aiSnapshot(page);
    expect(final.result!.meshes[0].kernelOperation).toBe("chamfer");
    const expectedBounds =
      plane === "XY"
        ? { min: [35, -4, 0], max: [47, 4, 14] }
        : plane === "XZ"
          ? { min: [35, -14, -4], max: [47, 0, 4] }
          : { min: [0, 35, -4], max: [14, 47, 4] };
    for (const side of ["min", "max"] as const)
      expectedBounds[side].forEach((coordinate, axis) =>
        expect(final.result!.meshes[0].bounds[side][axis]).toBeCloseTo(
          coordinate,
          6,
        ),
      );
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const projectPath = info.outputPath(`${plane}-operations.pcaddoc`);
    await (await saving).saveAs(projectPath);
    await page.locator('input[type="file"]').setInputFiles(projectPath);
    await expect
      .poll(async () => (await aiSnapshot(page)).session)
      .toBeGreaterThan(final.session);
    await ready(page, 1325.3333333333333);
    expect((await aiSnapshot(page)).document.features).toEqual(
      final.document.features,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath(`${plane}-operations.stl`);
    await (await exporting).saveAs(stl);
    expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(
      1325.3333333333333,
      3,
    );
  });
}
test("operation cancellation and same-ID session replacement discard drafts without committing stale previews", async ({
  page,
}) => {
  const [, sketchId] = await fixture(page);
  const before = await aiSnapshot(page);
  const begin = page.getByRole("button", {
    name: "Use Extrude on geometry",
    exact: true,
  });
  await begin.click();
  const bounds = await page.locator(".viewer-canvas canvas").boundingBox();
  if (!bounds) throw new Error("Viewer unavailable");
  await page.mouse.click(
    bounds.x + bounds.width - 12,
    bounds.y + bounds.height - 12,
  );
  await expect(page.getByRole("alert")).toContainText(
    "Arbitrary faces and edges are unsupported",
  );
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await page
    .getByRole("button", { name: "Cancel operation targets", exact: true })
    .click();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await begin.click();
  const profileCard = page.getByRole("button", {
    name: "Preview on Loose profile — region 1",
    exact: true,
  });
  const beforeHover = await profileCard.boundingBox();
  await profileCard.hover();
  const afterHover = await profileCard.boundingBox();
  expect(beforeHover).not.toBeNull();
  expect(afterHover).not.toBeNull();
  expect(afterHover!.y).toBeCloseTo(beforeHover!.y, 6);
  await profileCard.click();
  const dialog = page.getByRole("dialog", { name: "Extrude", exact: true });
  await expect(dialog.getByRole("status")).toContainText(
    "Native preview ready",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await begin.click();
  await page
    .getByRole("button", {
      name: "Preview on Loose profile — region 1",
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Native preview ready",
  );
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    state.setDocument(state.history.present);
  });
  await ready(page);
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText("Project or component changed");
  expect((await aiSnapshot(page)).document.features).toHaveLength(0);
  expect((await aiSnapshot(page)).document.sketches[sketchId]).toEqual(
    before.document.sketches[sketchId],
  );
});


test("section changes refresh operation overlays before pointer input", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Use Extrude on geometry", exact: true }).click();
  const targets = (): Promise<OperationTargetSnapshot[] | undefined> => page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer()?.operationTargets;
  });
  await expect.poll(targets).toHaveLength(2);
  const targetIds = (await targets())!.map((target) => target.targetId);
  expect(targetIds.every((id) => typeof id === "string")).toBe(true);
  expect((await targets())!.every((target) => target.clippingPlanes.length === 0)).toBe(true);
  const before = await aiSnapshot(page);
  for (const change of [
    { axis: "X", offset: 40, positive: true },
    { axis: "Y", offset: -2, positive: false },
    { axis: undefined, offset: 0, positive: true },
  ] as const) {
    // A real section-state update exercises the mounted viewer effect. Keep
    // the mouse stationary so picking cannot repair the overlay as a side effect.
    await page.evaluate(async (change) => {
      const sectionPath = "/src/state/sectionState.ts";
      const statePath = "/src/state/useCadStore.ts";
      const { useSectionState } = await import(sectionPath);
      const { useCadStore } = await import(statePath);
      useSectionState.getState().setSection(useCadStore.getState().documentSession, change.axis, change.offset, change.positive);
    }, change);
    await expect(async () => {
      const actual = await page.evaluate(async () => {
        const path = "/src/viewer/viewerDiagnostics.ts";
        const snapshot = (await import(path)).inspectViewer();
        return { plane: snapshot?.sectionPlane, targets: snapshot?.operationTargets };
      });
      expect(actual.targets).toHaveLength(2);
      expect(actual.targets!.map((target: OperationTargetSnapshot) => target.targetId)).toEqual(targetIds);
      for (const target of actual.targets!) expect(target.clippingPlanes).toEqual(actual.plane ? [actual.plane] : []);
      expect(Boolean(actual.plane)).toBe(Boolean(change.axis));
      if (actual.plane) expect(actual.plane.constant).toBe(change.positive ? -change.offset : change.offset);
    }).toPass({ timeout: 10000 });
  }
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await page.getByRole("button", { name: "Cancel operation targets", exact: true }).click();
  await expect.poll(targets).toEqual([]);
});

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane} viewer selects one authored cap edge and preserves exact chamfer geometry through history, parameter edit and STL`, async ({ page }, info) => {
    const [, sketchId] = await fixture(page, plane);
    const profile = await viewportLocal(page, sketchId, 41, 0);
    await page.getByRole("button", { name: "Use Extrude on geometry", exact: true }).dragTo(profile.canvas, { targetPosition: profile.local });
    await page.getByLabel("Extrude distance", { exact: true }).fill("height");
    await applyExtrusion(page); await ready(page, 960);
    const before = await aiSnapshot(page);
    await page.getByRole("button", { name: "Use Chamfer on geometry", exact: true }).click();
    const edge = await viewportLocal(page, sketchId, 47, 0, 10);
    await page.mouse.click(edge.screen.x, edge.screen.y);
    const dialog = page.getByRole("dialog", { name: "Chamfer", exact: true });
    await expect(dialog.getByRole("status")).toContainText("Native preview ready", { timeout: 30000 });
    await dialog.getByRole("button", { name: "Apply chamfer", exact: true }).click(); await ready(page, 956);
    const applied = await aiSnapshot(page), treatment = applied.document.features.at(-1);
    expect(treatment?.type).toBe("chamfer");
    if (treatment?.type !== "chamfer") throw new Error("Expected chamfer");
    expect(treatment.targetEdgeRefs[0].sourceEntityId).toBeTruthy();
    expect(treatment.targetEdgeRefs[0].role).toBe("endCapPerimeter");
    expect(applied.past).toBe(before.past + 1);
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await ready(page, 960);
    await page.getByRole("button", { name: "Redo", exact: true }).click(); await ready(page, 956);
    const height = page.getByRole("textbox", { name: "Parameter height expression", exact: true });
    await height.fill("14mm"); await height.press("Enter"); await ready(page, 1340);
    const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click();
    const projectPath = info.outputPath(`${plane}-individual-edge.pcaddoc`); await (await saving).saveAs(projectPath);
    await page.locator('input[type="file"]').setInputFiles(projectPath); await ready(page, 1340);
    expect((await aiSnapshot(page)).document.features.at(-1)).toEqual(treatment);
    const exporting = page.waitForEvent("download"); await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stlPath = info.outputPath(`${plane}-individual-edge.stl`); await (await exporting).saveAs(stlPath);
    // Float32 vertices permit 0.0134 mm³ error here, well below a missing
    // individual edge treatment's 2 mm³ minimum volume change.
    const exportedVolume = stlSignedVolume(await readFile(stlPath));
    expect(Math.abs(exportedVolume / 1340 - 1), `STL volume ${exportedVolume}; expected 1340`).toBeLessThan(1e-5);
  });
}
