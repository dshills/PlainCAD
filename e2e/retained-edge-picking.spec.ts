import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import type { OperationTarget } from "../src/ui/commands/operationDropCommand";
import { applyModeling } from "./modelingWorkflow";

type Case = { plane: "XY" | "XZ" | "YZ"; mode: "cut" | "join" | "split"; direction: "positive" | "symmetric" };
async function fixture(page: Page, settings: Case) {
  await page.goto("/");
  const ids = await page.evaluate(async (settings) => {
    const dp = "/src/cad/document/CadDocument.ts", cp = "/src/cad/sketch/canvasGeometry.ts",
      mp = "/src/cad/sketch/SketchModel.ts", sp = "/src/cad/sketch/SketchSolver.ts",
      pp = "/src/cad/sketch/profileDetection.ts", storePath = "/src/state/useCadStore.ts";
    const ops = await import(dp), { addCanvasGeometry } = await import(cp), { createSketchOnPlane } = await import(mp),
      { solveSketch } = await import(sp), { detectProfiles } = await import(pp), { useCadStore } = await import(storePath);
    let document = ops.upsertParameter(ops.createEmptyDocument("Retained edge picker"), {
      id: "depth", name: "depth", expression: "10mm", unit: "mm", value: 10,
    });
    const baseSketch = createSketchOnPlane("Base section", settings.plane);
    const outline = addCanvasGeometry(baseSketch, solveSketch(baseSketch, {}), "rectangle", [{ x: -10, y: -6 }, { x: 10, y: 6 }]).sketch;
    const profile = detectProfiles(solveSketch(outline, {})).profiles[0];
    const base = ops.createExtrudeFeature({ name: "Base", sketchId: outline.id, profileId: profile.id,
      operation: "newBody", direction: settings.direction, distance: { expression: "depth", unit: "mm" } });
    document = ops.upsertFeature(ops.upsertSketch(document, outline), base);
    const toolBase = createSketchOnPlane("Boolean tool", settings.plane);
    const tool = addCanvasGeometry(toolBase, solveSketch(toolBase, {}), settings.mode === "cut" ? "circle" : "rectangle",
      settings.mode === "cut" ? [{ x: 0, y: 0 }, { x: 2, y: 0 }] : settings.mode === "join" ? [{ x: 5, y: -2 }, { x: 15, y: 2 }] : [{ x: -1, y: -6 }, { x: 1, y: 6 }]).sketch;
    const modifier = ops.createExtrudeFeature({ name: settings.mode, sketchId: tool.id,
      profileId: detectProfiles(solveSketch(tool, {})).profiles[0].id,
      operation: settings.mode === "join" ? "join" : "cut", targetBodyIds: [`body:${base.id}`],
      direction: settings.direction, distance: { expression: "depth", unit: "mm" } });
    document = ops.upsertFeature(ops.upsertSketch(document, tool), modifier);
    useCadStore.getState().setDocument(document);
    const left = profile.outerLoop.segments!.find((segment: any) => Math.abs(segment.start.x + 10) < 1e-7 && Math.abs(segment.end.x + 10) < 1e-7)!;
    const top = profile.outerLoop.segments!.find((segment: any) => Math.abs(segment.start.y - 6) < 1e-7 && Math.abs(segment.end.y - 6) < 1e-7)!;
    // The XZ left edge projects beneath the chooser; the retained top edge has
    // a unique, visible midpoint outside it in the initial isometric view.
    return { ownerId: base.id, sketchId: outline.id, leftId: left.id, pickedId: settings.plane === "XZ" ? top.id : left.id,
      toolEntityIds: Object.keys(tool.entities) };
  }, settings);
  await ready(page, undefined, settings.mode === "split" ? 2 : 1);
  return ids;
}
async function ready(page: Page, volume?: number, solids = 1) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.errors).toEqual([]);
    expect(state.result?.meshes).toHaveLength(1);
    const mesh = state.result!.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: solids });
    if (volume !== undefined) expect(Math.abs(mesh.geometryAssertions!.volume / volume - 1)).toBeLessThan(1e-7);
  }).toPass({ timeout: 30000 });
}
async function targets(page: Page, operation: "fillet" | "chamfer"): Promise<OperationTarget[]> {
  return page.evaluate(async (operation) => {
    const path = "/src/ui/commands/operationDropCommand.ts";
    return (await import(path)).operationDropTargets(operation);
  }, operation);
}
const cases = [
  { plane: "XY", mode: "cut", direction: "positive", operation: "chamfer" },
  { plane: "XZ", mode: "join", direction: "positive", operation: "fillet" },
  { plane: "YZ", mode: "cut", direction: "symmetric", operation: "chamfer" },
] as const;
for (const settings of cases) {
  test(`${settings.plane} ${settings.mode} retained viewport edge supports ${settings.operation}, parameter edit, save/open and oriented STL`, async ({ page }, info) => {
    const ids = await fixture(page, settings);
    const baseVolume = (depth: number) => (settings.mode === "cut" ? 240 - 4 * Math.PI : 260) * depth;
    const removed = (settings.plane === "XZ" ? 20 : 12) * (settings.operation === "fillet" ? 1 - Math.PI / 4 : 0.5);
    await ready(page, baseVolume(10));
    const available = await targets(page, settings.operation);
    expect(available.some((edge) => edge.kind === "edge" && edge.sourceEntityId === ids.pickedId)).toBe(true);
    expect(available.filter((edge) => edge.kind === "edge" && !edge.sourceEntityId)).toHaveLength(settings.mode === "cut" ? 2 : 0);
    expect(available.every((edge) => edge.kind === "edge" && edge.ownerId === ids.ownerId && !ids.toolEntityIds.includes(edge.sourceEntityId ?? ""))).toBe(true);
    const before = await aiSnapshot(page);
    await page.getByRole("button", { name: `Use ${settings.operation === "fillet" ? "Fillet" : "Chamfer"} on geometry`, exact: true }).click();
    const point = await page.evaluate(async ({ sketchId, direction, plane }) => {
      const sp = "/src/state/useCadStore.ts", pp = "/src/cad/sketch/planes.ts", vp = "/src/viewer/viewerDiagnostics.ts";
      const state = (await import(sp)).useCadStore.getState();
      const world = (await import(pp)).transformPoint(state.rebuild.result.sketchPlanes[sketchId], plane === "XZ" ? 0 : -10, plane === "XZ" ? 6 : 0, direction === "symmetric" ? 5 : 10);
      return (await import(vp)).projectViewerPoint([world.x, world.y, world.z]);
    }, { sketchId: ids.sketchId, direction: settings.direction, plane: settings.plane });
    const box = await page.locator(".viewer-canvas canvas").boundingBox();
    if (!box || !point) throw new Error("Viewer projection unavailable.");
    const click = { x: box.x + point.x, y: box.y + point.y };
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, click)).toBe("CANVAS");
    await page.mouse.click(click.x, click.y);
    const title = settings.operation === "fillet" ? "Fillet" : "Chamfer";
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog.getByRole("status")).toContainText("Native preview ready");
    expect((await aiSnapshot(page)).document).toEqual(before.document);
    const draftSource = await page.evaluate(async () => {
      const path = "/src/ui/commands/modelingDraftCommand.ts";
      return (await import(path)).useModelingDraft.getState().draft?.feature;
    });
    expect(draftSource).toMatchObject({ targetEdgeRefs: [{ featureId: ids.ownerId, sourceEntityId: ids.pickedId, role: "endCapPerimeter" }] });
    await applyModeling(page, title);
    await ready(page, baseVolume(10) - removed);
    const depth = page.getByRole("textbox", { name: "Parameter depth expression", exact: true });
    await depth.fill("12mm");
    await depth.press("Enter");
    await ready(page, baseVolume(12) - removed);
    const final = await aiSnapshot(page), mesh = final.result!.meshes[0];
    const expected = settings.plane === "XY" ? { min: [-10, -6, 0], max: [10, 6, 12] }
      : settings.plane === "XZ" ? { min: [-10, -12, -6], max: [15, 0, 6] }
        : { min: [-6, -10, -6], max: [6, 10, 6] };
    for (const side of ["min", "max"] as const)
      expected[side].forEach((value, axis) => expect(mesh.bounds[side][axis]).toBeCloseTo(value, 6));
    const saving = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    const project = info.outputPath("retained-edge.pcaddoc");
    await (await saving).saveAs(project);
    const saved = JSON.parse(await readFile(project, "utf8"));
    expect(saved).not.toHaveProperty("availableEdges");
    expect(saved.features).toEqual(final.document.features);
    await page.locator('input[type="file"]').setInputFiles(project);
    await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(final.session);
    await ready(page, baseVolume(12) - removed);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("retained-edge.stl");
    await (await downloading).saveAs(stl);
    const bytes = await readFile(stl), volume = stlSignedVolume(bytes);
    // Meshed fillets approximate analytic curves; the exact BRep assertion above
    // stays at 1e-7 relative while STL verifies orientation and a bounded approximation.
    expect(volume).toBeGreaterThan(0);
    expect(Math.abs(volume / (baseVolume(12) - removed) - 1)).toBeLessThan(2e-4);
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let triangle = 0; triangle < bytes.readUInt32LE(80); triangle++)
      for (let vertex = 0; vertex < 3; vertex++)
        for (let axis = 0; axis < 3; axis++) {
          const value = bytes.readFloatLE(96 + triangle * 50 + vertex * 12 + axis * 4);
          bounds.min[axis] = Math.min(bounds.min[axis], value);
          bounds.max[axis] = Math.max(bounds.max[axis], value);
        }
    for (let axis = 0; axis < 3; axis++) {
      expect(bounds.min[axis]).toBeCloseTo(expected.min[axis], 5);
      expect(bounds.max[axis]).toBeCloseTo(expected.max[axis], 5);
    }
  });
}

test("split authored boundaries omit full cap groups and new boolean edges while unchanged original edges remain selectable", async ({ page }) => {
  const ids = await fixture(page, { plane: "XY", mode: "split", direction: "positive" });
  await ready(page, 2160, 2);
  const state = await aiSnapshot(page);
  expect(state.result!.availableFaces!.some((face) => face.id === `extrude:${ids.ownerId}:endCap`)).toBe(false);
  const available = await targets(page, "fillet");
  expect(available).toHaveLength(4);
  expect(available.every((edge) => edge.kind === "edge" && edge.sourceEntityId && !ids.toolEntityIds.includes(edge.sourceEntityId))).toBe(true);
  await page.getByRole("button", { name: "Use Fillet on geometry", exact: true }).click();
  await expect(page.locator('[data-operation-target]').filter({ hasText: "perimeter (all original edges)" })).toHaveCount(0);
  expect((await aiSnapshot(page)).document).toEqual(state.document);
});

test("retained-edge native preview cannot apply after same-ID project replacement", async ({ page }) => {
  const ids = await fixture(page, { plane: "XY", mode: "join", direction: "positive" });
  await page.getByRole("button", { name: "Use Chamfer on geometry", exact: true }).click();
  await page.locator(`[data-operation-target="edge:${ids.ownerId}:endCapPerimeter:${ids.leftId}"]`).click();
  const dialog = page.getByRole("dialog", { name: "Chamfer", exact: true });
  await expect(dialog.getByRole("status")).toContainText("Native preview ready");
  const before = await aiSnapshot(page);
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", store = (await import(path)).useCadStore.getState();
    store.setDocument(store.history.present);
  });
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(before.session);
  await expect.poll(async () => page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    return (await import(path)).useCadStore.getState().rebuild.result?.availableEdges?.length;
  })).toBeGreaterThan(0);
  await ready(page, 2600);
  await expect(dialog.getByRole("button", { name: "Apply chamfer", exact: true })).toBeDisabled();
  expect((await aiSnapshot(page)).document.features).toEqual(before.document.features);
});
