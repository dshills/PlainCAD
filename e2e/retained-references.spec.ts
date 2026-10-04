import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type {
  CadDocument,
  Sketch,
  SketchEntity,
} from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import { applyExtrusion } from "./extrudeWorkflow";
async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; result: RebuildResult; status: string }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      result: state.rebuild.result,
      status: state.rebuild.status,
    };
  });
}
async function ready(page: Page, status = "succeeded") {
  await expect.poll(async () => (await snapshot(page)).status).toBe(status);
  if (status === "succeeded")
    expect((await snapshot(page)).result.errors).toEqual([]);
}
function geometry(
  result: RebuildResult,
  id: string,
  volume: number,
  operation?: string,
) {
  const mesh = result.meshes.find((mesh) => mesh.bodyId === `body:${id}`)!;
  expect(mesh).toBeDefined();
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 6);
  if (operation) expect(mesh.kernelOperation).toBe(operation);
  return mesh;
}
async function fixture(page: Page, mode: "cut" | "join" | "cutJoin" | "split") {
  return page.evaluate(async (mode) => {
    const dp = "/src/cad/document/CadDocument.ts",
      sp = "/src/cad/sketch/SketchModel.ts",
      pp = "/src/cad/sketch/profileDetection.ts",
      rp = "/src/cad/sketch/SketchSolver.ts",
      storePath = "/src/state/useCadStore.ts";
    const ops = await import(dp),
      model = await import(sp),
      { detectProfiles } = await import(pp),
      { solveSketch } = await import(rp),
      { useCadStore } = await import(storePath);
    let document = ops.createEmptyDocument("Retained references");
    const baseSketch = model.addCornerRectangle(
      model.createXySketch("Base section"),
      "20mm",
      "20mm",
    );
    const baseProfile = detectProfiles(solveSketch(baseSketch, {})).profiles[0];
    document = ops.upsertSketch(document, baseSketch);
    const base = ops.createExtrudeFeature({
      name: "Base",
      sketchId: baseSketch.id,
      profileId: baseProfile.id,
      operation: "newBody",
      direction: "positive",
      distance: { expression: "10mm", unit: "mm" },
    });
    document = ops.upsertFeature(document, base);
    let cutId: string | undefined;
    if (mode !== "join") {
      let tool: Sketch =
        mode === "split"
          ? model.addCornerRectangle(
              model.createXySketch("Slot"),
              "2mm",
              "20mm",
            )
          : model.addCircleAt(
              model.createXySketch("Hole section"),
              "10mm",
              "10mm",
              "2mm",
            );
      if (mode === "split")
        tool = {
          ...tool,
          entities: Object.fromEntries(
            Object.entries(tool.entities).map(
              ([id, e]: [string, SketchEntity]) => [
                id,
                e.type === "point"
                  ? {
                      ...e,
                      x: { ...e.x, expression: `(${e.x.expression}) + 9mm` },
                    }
                  : e,
              ],
            ),
          ),
        };
      document = ops.upsertSketch(document, tool);
      const cut = ops.createExtrudeFeature({
        name: "Cut",
        sketchId: tool.id,
        profileId: detectProfiles(solveSketch(tool, {})).profiles[0].id,
        operation: "cut",
        targetBodyIds: [`body:${base.id}`],
        direction: "positive",
        distance: { expression: "10mm", unit: "mm" },
      });
      cutId = cut.id;
      document = ops.upsertFeature(document, cut);
    }
    if (mode === "join" || mode === "cutJoin") {
      let tool: Sketch = model.addCornerRectangle(
        model.createXySketch("Join section"),
        "10mm",
        "20mm",
      );
      tool = {
        ...tool,
        entities: Object.fromEntries(
          Object.entries(tool.entities).map(
            ([id, e]: [string, SketchEntity]) => [
              id,
              e.type === "point"
                ? {
                    ...e,
                    x: { ...e.x, expression: `(${e.x.expression}) + 15mm` },
                  }
                : e,
            ],
          ),
        ),
      };
      document = ops.upsertSketch(document, tool);
      document = ops.upsertFeature(
        document,
        ops.createExtrudeFeature({
          name: "Join",
          sketchId: tool.id,
          profileId: detectProfiles(solveSketch(tool, {})).profiles[0].id,
          operation: "join",
          targetBodyIds: [`body:${base.id}`],
          direction: "positive",
          distance: { expression: "10mm", unit: "mm" },
        }),
      );
    }
    const left = baseProfile.outerLoop.segments.find(
      (s: { start: { x: number }; end: { x: number } }) =>
        s.start.x === 0 && s.end.x === 0,
    );
    if (!left) throw new Error("Missing authored left edge");
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "feature", id: base.id, documentId: document.id });
    return { baseId: base.id, cutId, leftId: left.id };
  }, mode);
}
async function commit(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function circle(page: Page, x: number, y: number) {
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("circle");
  for (const point of [
    [x, y],
    [x + 1, y],
  ]) {
    await page
      .getByLabel("Canvas coordinate X", { exact: true })
      .fill(String(point[0]));
    await page
      .getByLabel("Canvas coordinate Y", { exact: true })
      .fill(String(point[1]));
    await page
      .getByRole("button", { name: "Place coordinate", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("3mm");
  await applyExtrusion(page);
  await ready(page);
}
async function roundTrip(page: Page, info: TestInfo) {
  const before = await snapshot(page),
    download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("references.pcaddoc");
  await (await download).saveAs(path);
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved).not.toHaveProperty("availableFaces");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(before.document.id);
  await ready(page);
  expect((await snapshot(page)).document.sketches).toEqual(saved.sketches);
  return before;
}

test("retained native cap after Cut supports sketch/extrude, owner distance edits, save/open and STL", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  const { baseId } = await fixture(page, "cut");
  await ready(page);
  geometry((await snapshot(page)).result, baseId, 4000 - Math.PI * 40, "cut");
  await page
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Create Sketch" })
    .getByRole("button", { name: "Sketch on Base — end cap", exact: true })
    .click();
  await circle(page, 5, 5);
  let state = await snapshot(page),
    child = state.document.features.at(-1)!;
  const mesh = geometry(state.result, child.id, Math.PI * 3, "extrusion");
  expect(mesh.bounds.min[2]).toBeCloseTo(10, 6);
  expect(mesh.bounds.max[2]).toBeCloseTo(13, 6);
  await page.locator(".feature-chip").filter({ hasText: "Base" }).click();
  await commit(page, "Distance", "14mm");
  await ready(page);
  state = await snapshot(page);
  geometry(state.result, baseId, 5600 - Math.PI * 40, "cut");
  expect(
    geometry(state.result, child.id, Math.PI * 3).bounds.min[2],
  ).toBeCloseTo(14, 6);
  await roundTrip(page, info);
  state = await snapshot(page);
  geometry(state.result, child.id, Math.PI * 3);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const options = page.getByRole("dialog", { name: "STL export options" });
  await options.getByLabel("STL mode", { exact: true }).selectOption("merged");
  await options
    .getByRole("button", { name: "Generate STL", exact: true })
    .click();
  const stl = info.outputPath("references.stl");
  await (await exporting).saveAs(stl);
  const bytes = await readFile(stl),
    count = bytes.readUInt32LE(80);
  expect(count).toBeGreaterThan(0);
  expect(bytes.length).toBe(84 + count * 50);
  let exportedVolume = 0,
    maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const p = Array.from({ length: 9 }, (_, j) =>
      bytes.readFloatLE(96 + i * 50 + j * 4),
    );
    expect(p.every(Number.isFinite)).toBe(true);
    maxZ = Math.max(maxZ, p[2], p[5], p[8]);
    exportedVolume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  expect(maxZ).toBeCloseTo(17, 6);
  const expectedVolume =
    20 * 20 * 14 - Math.PI * 2 ** 2 * 10 + Math.PI * 1 ** 2 * 3;
  // STL tessellation may approximate curves; positive signed volume also verifies winding.
  expect(exportedVolume / expectedVolume).toBeCloseTo(1, 3);
  await page.screenshot({
    path: info.outputPath("retained-cap.png"),
    fullPage: true,
  });
});

test("Join retains the original left side for a native face-based sketch", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  const { baseId, leftId } = await fixture(page, "join");
  await ready(page);
  geometry((await snapshot(page)).result, baseId, 5000, "fuse");
  await page
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Create Sketch" })
    .getByRole("button", {
      name: `Sketch on Base — side ${leftId}`,
      exact: true,
    })
    .click();
  await circle(page, 10, 5);
  const state = await snapshot(page),
    child = state.document.features.at(-1)!;
  const mesh = geometry(state.result, child.id, Math.PI * 3, "extrusion");
  expect(mesh.bounds.min[0]).toBeCloseTo(-3, 6);
  expect(mesh.bounds.max[0]).toBeCloseTo(0, 6);
  await roundTrip(page, info);
  geometry((await snapshot(page)).result, child.id, Math.PI * 3);
});

test("original outer perimeter after Cut excludes the new hole edge; fillet after Cut/Join matches only a retained authored edge", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  let f = await fixture(page, "cut");
  await ready(page);
  await page
    .locator(".body-row")
    .getByRole("button", { name: "Base", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Chamfer extrusion edges", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Chamfer extrusion edges", exact: true })
    .click();
  await commit(page, "Chamfer distance", "1mm");
  await ready(page);
  geometry(
    (await snapshot(page)).result,
    f.baseId,
    4000 - Math.PI * 40 - (40 - 4 / 3),
    "chamfer",
  );
  f = await fixture(page, "cutJoin");
  await ready(page);
  await page
    .getByRole("button", { name: "Fillet extrusion edges", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Source edge", exact: true })
    .selectOption(f.leftId);
  await ready(page);
  geometry(
    (await snapshot(page)).result,
    f.baseId,
    5000 - Math.PI * 40 - 20 * (1 - Math.PI / 4),
    "fillet",
  );
  await commit(page, "Fillet radius", "2mm");
  await ready(page);
  geometry(
    (await snapshot(page)).result,
    f.baseId,
    5000 - Math.PI * 40 - 80 * (1 - Math.PI / 4),
    "fillet",
  );
  await roundTrip(page, info);
  geometry(
    (await snapshot(page)).result,
    f.baseId,
    5000 - Math.PI * 40 - 80 * (1 - Math.PI / 4),
    "fillet",
  );
  // A grouped original perimeter is partially removed by Join and must diagnose loss.
  await page.locator(".feature-chip").filter({ hasText: "Fillet" }).click();
  await page
    .getByRole("combobox", { name: "Source edge", exact: true })
    .selectOption("");
  await ready(page, "failed");
  expect(
    (await snapshot(page)).result.errors.map((e) => e.message).join(" "),
  ).toMatch(/lost|ambiguous/);
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
});

test("split cap references diagnose native ambiguity even for standalone sketches; repair to origin recovers", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const f = await fixture(page, "split");
  await ready(page);
  const state = await snapshot(page);
  expect(state.result.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    3600,
    6,
  );
  expect(
    state.result.availableFaces!.some(
      (face) => face.id === `extrude:${f.baseId}:endCap`,
    ),
  ).toBe(false);
  const sketchId = await page.evaluate(async (baseId) => {
    const dp = "/src/cad/document/CadDocument.ts",
      sp = "/src/cad/sketch/SketchModel.ts",
      storePath = "/src/state/useCadStore.ts";
    const { upsertSketch } = await import(dp),
      { createSketchOnPlane } = await import(sp),
      { useCadStore } = await import(storePath);
    const sketch = createSketchOnPlane("Lost cap", {
      type: "face",
      featureId: baseId,
      stableFaceId: `extrude:${baseId}:endCap`,
    });
    useCadStore
      .getState()
      .updateDocument((document: CadDocument) =>
        upsertSketch(document, sketch),
      );
    useCadStore.getState().select({
      kind: "sketch",
      id: sketch.id,
      documentId: useCadStore.getState().history.present.id,
    });
    return sketch.id;
  }, f.baseId);
  await ready(page, "failed");
  const failed = await snapshot(page);
  expect(failed.result.errors).toContainEqual(
    expect.objectContaining({
      source: "sketch",
      sourceId: sketchId,
      message: expect.stringMatching(/lost|split|ambiguous/),
    }),
  );
  expect(failed.result.sketchPlanes?.[sketchId]).toBeUndefined();
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Sketch plane type", { exact: true })
    .selectOption("origin");
  await page
    .getByRole("button", { name: "Apply sketch plane", exact: true })
    .click();
  await ready(page);
});

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: grouped circle perimeter matches the native seam and removes exact fillet volume`, async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    const id = await page.evaluate(async (plane) => {
      const dp = "/src/cad/document/CadDocument.ts",
        sp = "/src/cad/sketch/SketchModel.ts",
        pp = "/src/cad/sketch/profileDetection.ts",
        rp = "/src/cad/sketch/SketchSolver.ts",
        storePath = "/src/state/useCadStore.ts";
      const ops = await import(dp),
        model = await import(sp),
        { solveSketch } = await import(rp),
        { detectProfiles } = await import(pp),
        { useCadStore } = await import(storePath);
      const sketch = model.addCircleAt(
        model.createSketchOnPlane("Circle", plane),
        "0mm",
        "0mm",
        "10mm",
      );
      let document = ops.upsertSketch(
        ops.createEmptyDocument("Circle rim"),
        sketch,
      );
      const feature = ops.createExtrudeFeature({
        name: "Cylinder",
        sketchId: sketch.id,
        profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
        operation: "newBody",
        direction: "positive",
        distance: { expression: "10mm", unit: "mm" },
      });
      document = ops.upsertFeature(document, feature);
      useCadStore.getState().setDocument(document);
      useCadStore
        .getState()
        .select({ kind: "feature", id: feature.id, documentId: document.id });
      return feature.id;
    }, plane);
    await ready(page);
    geometry((await snapshot(page)).result, id, Math.PI * 1000);
    await page
      .getByRole("button", { name: "Fillet extrusion edges", exact: true })
      .click();
    await ready(page);
    const removed =
      2 * Math.PI * (10 * (1 - Math.PI / 4) - (5 / 6 - Math.PI / 4));
    geometry(
      (await snapshot(page)).result,
      id,
      Math.PI * 1000 - removed,
      "fillet",
    );
  });
}

test("an earlier face sketch stays editable when a later Cut splits its source cap", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  const f = await fixture(page, "split");
  await ready(page);
  const sketchId = await page.evaluate(async (baseId) => {
    const dp = "/src/cad/document/CadDocument.ts",
      sp = "/src/cad/sketch/SketchModel.ts",
      storePath = "/src/state/useCadStore.ts";
    const { upsertSketch } = await import(dp),
      { createSketchOnPlane } = await import(sp),
      { useCadStore } = await import(storePath);
    const sketch = {
      ...createSketchOnPlane("Earlier cap sketch", {
        type: "face",
        featureId: baseId,
        stableFaceId: `extrude:${baseId}:endCap`,
      }),
      timelineStep: 5,
    };
    useCadStore
      .getState()
      .updateDocument((document: CadDocument) =>
        upsertSketch(
          {
            ...document,
            sketches: Object.fromEntries(
              Object.entries(document.sketches).map(([id, s]) => [
                id,
                { ...s, timelineStep: s.timelineStep! * 2 },
              ]),
            ),
            features: document.features.map((feature) => ({
              ...feature,
              timelineStep: feature.timelineStep! * 2,
            })),
          },
          sketch,
        ),
      );
    useCadStore
      .getState()
      .select({
        kind: "sketch",
        id: sketch.id,
        documentId: useCadStore.getState().history.present.id,
      });
    return sketch.id;
  }, f.baseId);
  await ready(page);
  let state = await snapshot(page);
  expect(state.result.sketchPlanes?.[sketchId].origin.z).toBe(10);
  expect(
    state.result.availableFaces!.some(
      (face) => face.id === `extrude:${f.baseId}:endCap`,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("point");
  await page.getByLabel("Canvas coordinate X", { exact: true }).fill("5");
  await page.getByLabel("Canvas coordinate Y", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Place coordinate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await ready(page);
  state = await snapshot(page);
  expect(Object.keys(state.document.sketches[sketchId].entities)).toHaveLength(
    1,
  );
  expect(state.result.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    3600,
    6,
  );
  await roundTrip(page, info);
  expect((await snapshot(page)).result.sketchPlanes?.[sketchId].origin.z).toBe(
    10,
  );
});
