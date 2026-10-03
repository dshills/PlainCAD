import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

type State = { document: CadDocument; status: string; result?: RebuildResult };
async function state(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const s = (await import(path)).useCadStore.getState();
    return {
      document: s.history.present,
      status: s.rebuild.status,
      result: s.rebuild.result,
    };
  });
}
async function ready(page: Page, ids: string[], volumes: number[]) {
  await expect(async () => {
    const s = await state(page);
    expect(s.status).toBe("succeeded");
    expect(s.result?.documentId).toBe(s.document.id);
    expect(s.result?.meshes).toHaveLength(ids.length);
    expect(s.result?.metrics?.disposalFailures).toBe(0);
    for (const [i, id] of ids.entries()) {
      const mesh = s.result!.meshes.find((m) => m.bodyId === id)!;
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(volumes[i], 4);
    }
  }).toPass({ timeout: 20000 });
}
function stlVolume(bytes: Buffer) {
  const n = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + 50 * n);
  let volume = 0;
  for (let t = 0; t < n; t++) {
    const p = Array.from({ length: 9 }, (_, i) =>
      bytes.readFloatLE(96 + t * 50 + i * 4),
    );
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return volume;
}
async function fixture(page: Page, mode: "extrude" | "revolve") {
  return page.evaluate(async (mode) => {
    const sp = "/src/state/useCadStore.ts",
      dp = "/src/cad/document/CadDocument.ts",
      kp = "/src/cad/sketch/SketchModel.ts",
      pp = "/src/cad/sketch/profileDetection.ts",
      rp = "/src/cad/sketch/SketchSolver.ts";
    const ops = await import(dp),
      sketches = await import(kp),
      { solveSketch } = await import(rp),
      { detectProfiles } = await import(pp);
    let doc = ops.upsertParameter(ops.createEmptyDocument("Multi body cuts"), {
      id: "radius",
      name: "radius",
      expression: "2mm",
      value: 0,
      unit: "mm",
    });
    const ids: string[] = [];
    for (const [i, name] of ["Lower", "Upper", "Far"].entries()) {
      let sketch = sketches.addCornerRectangle(
        sketches.createSketchOnPlane(`${name} section`, {
          type: "offset",
          base: "XY",
          offset: {
            expression: `${mode === "extrude" && i === 1 ? 20 : 0}mm`,
            unit: "mm",
          },
        }),
        mode === "extrude" ? "20mm" : "10mm",
        "10mm",
      );
      const x = i === 2 ? 100 : 0,
        y = mode === "revolve" && i === 1 ? 20 : 0;
      sketch = {
        ...sketch,
        entities: Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]: [string, any]) => [
            id,
            e.type === "point"
              ? {
                  ...e,
                  x: { ...e.x, expression: `(${e.x.expression}) + ${x}mm` },
                  y: { ...e.y, expression: `(${e.y.expression}) + ${y}mm` },
                }
              : e,
          ]),
        ),
      };
      const feature = ops.createExtrudeFeature({
        name,
        sketchId: sketch.id,
        profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
        operation: "newBody",
        direction: "positive",
        distance: { expression: "10mm", unit: "mm" },
      });
      doc = ops.upsertFeature(ops.upsertSketch(doc, sketch), feature);
      ids.push(`body:${feature.id}`);
    }
    const tool =
      mode === "extrude"
        ? sketches.addCircleAt(
            sketches.createXySketch("Cut section"),
            "5mm",
            "5mm",
            "radius",
          )
        : sketches.addCornerRectangle(
            sketches.createXySketch("Cut section"),
            "radius",
            "40mm",
          );
    doc = ops.upsertSketch(doc, tool);
    const common = {
      name: "Scoped cut",
      sketchId: tool.id,
      profileId: detectProfiles(
        solveSketch(tool, {
          radius: { value: 2, unit: "mm", dimension: "length" },
        }),
      ).profiles[0].id,
      operation: "cut" as const,
      targetBodyIds: [ids[0]],
    };
    const cut =
      mode === "extrude"
        ? ops.createExtrudeFeature({
            ...common,
            direction: "positive",
            distance: { expression: "40mm", unit: "mm" },
            termination: { type: "throughAll" },
          })
        : {
            ...common,
            id: "scoped-revolve",
            type: "revolve" as const,
            axis: { type: "origin" as const, axis: "Y" as const },
            angle: { expression: "360deg", unit: "deg" },
          };
    doc = ops.upsertFeature(doc, cut);
    const store = (await import(sp)).useCadStore.getState();
    store.setDocument(doc);
    store.select({ kind: "feature", id: cut.id, documentId: doc.id });
    return { ids, cutId: cut.id };
  }, mode);
}
for (const mode of ["extrude", "revolve"] as const) {
  test(`${mode}: native capture saves intersected IDs, ignores downstream/new bodies and supports explicit recapture`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await expect.poll(async () => (await state(page)).status).toBe("succeeded");
    const { ids, cutId } = await fixture(page, mode);
    const base = mode === "extrude" ? 2000 : 1000;
    const volume = base - (Math.PI * 4 * 10) / (mode === "extrude" ? 1 : 4);
    await ready(page, ids, [volume, base, base]);
    await page
      .getByRole("combobox", { name: "Target body", exact: true })
      .selectOption("");
    await expect.poll(async () => (await state(page)).status).toBe("failed");
    const capture = page.getByRole("button", {
      name: "Capture intersected targets",
      exact: true,
    });
    await capture.click();
    await ready(page, ids, [volume, volume, base]);
    expect(
      (await state(page)).document.features.find((f) => f.id === cutId),
    ).toMatchObject({ targetBodyIds: ids.slice(0, 2) });
    // A new upstream body overlaps the tool but must remain outside the saved scope.
    const newId = await page.evaluate(
      async ({ cutId }) => {
        const sp = "/src/state/useCadStore.ts",
          dp = "/src/cad/document/CadDocument.ts";
        const { upsertFeature } = await import(dp);
        const store = (await import(sp)).useCadStore.getState();
        const id = "extraUpstream";
        store.updateDocument((d: CadDocument) => {
          const step = d.features.find((f) => f.id === cutId)!.timelineStep!;
          const shifted = {
            ...d,
            timelineCursor: (d.timelineCursor ?? 0) + 1,
            features: d.features.map((f) =>
              (f.timelineStep ?? 0) >= step
                ? { ...f, timelineStep: f.timelineStep! + 1 }
                : f,
            ),
            sketches: Object.fromEntries(
              Object.entries(d.sketches).map(([key, sketch]) => [
                key,
                (sketch.timelineStep ?? 0) >= step
                  ? { ...sketch, timelineStep: sketch.timelineStep! + 1 }
                  : sketch,
              ]),
            ),
          };
          return upsertFeature(shifted, {
            ...d.features[0],
            id,
            name: "New upstream",
            timelineStep: step,
          });
        });
        return `body:${id}`;
      },
      { cutId },
    );
    await ready(page, [...ids, newId], [volume, volume, base, base]);
    expect(
      (await state(page)).document.features.find((f) => f.id === cutId),
    ).toMatchObject({ targetBodyIds: ids.slice(0, 2) });
    await capture.click();
    await ready(page, [...ids, newId], [volume, volume, base, volume]);
    expect(
      (await state(page)).document.features.find((f) => f.id === cutId),
    ).toMatchObject({ targetBodyIds: [...ids.slice(0, 2), newId] });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await ready(page, [...ids, newId], [volume, volume, base, base]);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await ready(page, [...ids, newId], [volume, volume, base, volume]);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const path = info.outputPath(`${mode}.pcaddoc`);
    await (await download).saveAs(path);
    const saved = JSON.parse(await readFile(path, "utf8")) as CadDocument;
    expect(JSON.stringify(saved)).not.toContain("capturedTargetBodyIds");
    await page
      .getByRole("button", {
        name: "Load parametric box template",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await state(page)).document.id)
      .not.toBe(saved.id);
    await page.locator('input[type="file"]').setInputFiles(path);
    await ready(page, [...ids, newId], [volume, volume, base, volume]);
    await page.getByRole("button", { name: "Lower", exact: true }).click();
    const stl = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export selected body", exact: true })
      .click();
    const stlPath = info.outputPath(`${mode}.stl`);
    await (await stl).saveAs(stlPath);
    expect(stlVolume(await readFile(stlPath)) / volume).toBeCloseTo(1, 2);
    if (mode === "extrude") {
      await page
        .getByRole("list", { name: "Sketch and feature history" })
        .getByRole("button", { name: /Scoped cut/ })
        .click();
      await page
        .getByRole("combobox", { name: "Direction", exact: true })
        .selectOption("negative");
      await expect.poll(async () => (await state(page)).status).toBe("failed");
      const before = (await state(page)).document.updatedAt;
      await page
        .getByRole("button", {
          name: "Capture intersected targets",
          exact: true,
        })
        .click();
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "intersects no upstream body volume" }),
      ).toBeVisible();
      expect((await state(page)).document.updatedAt).toBe(before);
      expect(
        (await state(page)).document.features.find((f) => f.id === cutId),
      ).toMatchObject({ targetBodyIds: [...ids.slice(0, 2), newId] });
    }
  });
}
test("native hole capture finds targets of different centers and discards an in-flight result after edits", async ({
  page,
}) => {
  await page.goto("/");
  await expect.poll(async () => (await state(page)).status).toBe("succeeded");
  const { ids, cutId } = await fixture(page, "extrude");
  await ready(page, ids, [2000 - Math.PI * 4 * 10, 2000, 2000]);
  await page.evaluate(
    async ({ ids, cutId }) => {
      const sp = "/src/state/useCadStore.ts",
        dp = "/src/cad/document/CadDocument.ts",
        kp = "/src/cad/sketch/SketchModel.ts";
      const { upsertFeature, upsertSketch } = await import(dp),
        sketches = await import(kp);
      (await import(sp)).useCadStore
        .getState()
        .updateDocument((d: CadDocument) => {
          const first = sketches.addPoint(
            sketches.createXySketch("Drill centers"),
            "5mm",
            "5mm",
          );
          const center = sketches.addPoint(first.sketch, "105mm", "5mm");
          const withoutCut = {
            ...d,
            features: d.features.filter((f) => f.id !== cutId),
          };
          return upsertFeature(upsertSketch(withoutCut, center.sketch), {
            id: cutId,
            name: "Scoped hole",
            type: "hole",
            sketchId: center.sketch.id,
            centerPointIds: [first.pointId, center.pointId],
            targetBodyIds: [ids[0]],
            diameter: { expression: "4mm", unit: "mm" },
            depth: "throughAll",
          });
        });
    },
    { ids, cutId },
  );
  await expect.poll(async () => (await state(page)).status).toBe("failed");
  expect(
    (await state(page)).document.features.find((f) => f.id === cutId),
  ).toMatchObject({ targetBodyIds: [ids[0]] });
  const capture = page.getByRole("button", {
    name: "Capture intersected targets",
    exact: true,
  });
  await capture.click();
  await ready(page, ids, [
    2000 - Math.PI * 4 * 10,
    2000 - Math.PI * 4 * 10,
    2000 - Math.PI * 4 * 10,
  ]);
  expect(
    (await state(page)).document.features.find((f) => f.id === cutId),
  ).toMatchObject({ targetBodyIds: ids });
  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const p = "/src/ui/commands/targetScopeCaptureCommand.ts";
        return (await import(p)).useTargetScopeCapture.getState().busy;
      });
    })
    .toBe(false);
  // Click and edit in one browser turn, before any worker message can be delivered.
  await capture.evaluate(
    async (button, { ids, cutId }) => {
      const sp = "/src/state/useCadStore.ts",
        dp = "/src/cad/document/CadDocument.ts";
      const { upsertFeature } = await import(dp);
      const store = (await import(sp)).useCadStore.getState();
      (button as HTMLButtonElement).click();
      store.updateDocument((d: CadDocument) =>
        upsertFeature(d, {
          ...d.features.find((f) => f.id === cutId)!,
          targetBodyIds: [ids[0]],
        }),
      );
    },
    { ids, cutId },
  );
  await expect.poll(async () => (await state(page)).status).toBe("failed");
  await expect(
    page.getByRole("alert").filter({ hasText: "Project changed" }),
  ).toBeVisible();
  expect(
    (await state(page)).document.features.find((f) => f.id === cutId),
  ).toMatchObject({ targetBodyIds: [ids[0]] });
  await page.evaluate(
    async ({ ids, cutId }) => {
      const sp = "/src/state/useCadStore.ts",
        dp = "/src/cad/document/CadDocument.ts";
      const { upsertFeature, upsertSketch } = await import(dp);
      (await import(sp)).useCadStore
        .getState()
        .updateDocument((d: CadDocument) => {
          const f = d.features.find((f) => f.id === cutId)!;
          if (f.type !== "hole") throw new Error("Expected hole");
          const sketch = d.sketches[f.sketchId];
          return upsertFeature(
            upsertSketch(d, {
              ...sketch,
              plane: {
                type: "offset",
                base: "XY",
                offset: { expression: "40mm", unit: "mm" },
              },
            }),
            { ...f, targetBodyIds: ids },
          );
        });
    },
    { ids, cutId },
  );
  await expect.poll(async () => (await state(page)).status).toBe("failed");
  const before = (await state(page)).document.updatedAt;
  await capture.click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "intersects no upstream body volume" }),
  ).toBeVisible();
  expect((await state(page)).document.updatedAt).toBe(before);
  expect(
    (await state(page)).document.features.find((f) => f.id === cutId),
  ).toMatchObject({ targetBodyIds: ids });
});

async function joinFixture(page: Page, mode: "extrude" | "revolve") {
  return page.evaluate(async (mode) => {
    const sp = "/src/state/useCadStore.ts",
      dp = "/src/cad/document/CadDocument.ts",
      kp = "/src/cad/sketch/SketchModel.ts",
      pp = "/src/cad/sketch/profileDetection.ts",
      rp = "/src/cad/sketch/SketchSolver.ts";
    const ops = await import(dp),
      sketches = await import(kp),
      { solveSketch } = await import(rp),
      { detectProfiles } = await import(pp);
    let doc = ops.upsertParameter(ops.createEmptyDocument("Multi body joins"), {
      id: "size",
      name: "size",
      expression: mode === "extrude" ? "40mm" : "25mm",
      value: 0,
      unit: "mm",
    });
    const ids: string[] = [];
    for (const [i, name] of ["First", "Middle", "Last", "Far"].entries()) {
      const x = mode === "extrude" ? [0, 20, 40, 100][i] : [0, 10, -20, 100][i];
      let sketch = sketches.addCornerRectangle(
        sketches.createXySketch(`${name} section`),
        "10mm",
        "10mm",
      );
      sketch = {
        ...sketch,
        entities: Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]: [string, any]) => [
            id,
            e.type === "point"
              ? {
                  ...e,
                  x: { ...e.x, expression: `(${e.x.expression}) + ${x}mm` },
                }
              : e,
          ]),
        ),
      };
      const feature = ops.createExtrudeFeature({
        name,
        sketchId: sketch.id,
        profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
        operation: "newBody",
        direction: "positive",
        distance: { expression: "10mm", unit: "mm" },
      });
      doc = ops.upsertFeature(ops.upsertSketch(doc, sketch), feature);
      ids.push(`body:${feature.id}`);
    }
    let sketch = sketches.addCornerRectangle(
      sketches.createXySketch("Bridge section"),
      "size",
      "10mm",
    );
    if (mode === "extrude")
      sketch = {
        ...sketch,
        entities: Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]: [string, any]) => [
            id,
            e.type === "point"
              ? { ...e, x: { ...e.x, expression: `(${e.x.expression}) + 5mm` } }
              : e,
          ]),
        ),
      };
    const common = {
      name: "Scoped join",
      sketchId: sketch.id,
      profileId: detectProfiles(
        solveSketch(sketch, {
          size: {
            value: mode === "extrude" ? 40 : 25,
            dimension: "length",
            unit: "mm",
          },
        }),
      ).profiles[0].id,
      operation: "join" as const,
      targetBodyIds: [ids[0], ids[2]],
    };
    const join =
      mode === "extrude"
        ? ops.createExtrudeFeature({
            ...common,
            direction: "positive",
            distance: { expression: "10mm", unit: "mm" },
          })
        : {
            ...common,
            id: "scoped-revolve",
            type: "revolve" as const,
            axis: { type: "origin" as const, axis: "Y" as const },
            angle: { expression: "360deg", unit: "deg" },
          };
    doc = ops.upsertFeature(ops.upsertSketch(doc, sketch), join);
    const store = (await import(sp)).useCadStore.getState();
    store.setDocument(doc);
    store.select({ kind: "feature", id: join.id, documentId: doc.id });
    return { ids, joinId: join.id };
  }, mode);
}

test("native join capture preserves the authored primary body and diagnoses face-only contact", async ({
  page,
}) => {
  await page.goto("/");
  await expect.poll(async () => (await state(page)).status).toBe("succeeded");
  const { ids, joinId } = await joinFixture(page, "extrude");
  await page.evaluate(
    async ({ ids, joinId }) => {
      const sp = "/src/state/useCadStore.ts",
        dp = "/src/cad/document/CadDocument.ts";
      const { upsertFeature } = await import(dp);
      (await import(sp)).useCadStore
        .getState()
        .updateDocument((d: CadDocument) =>
          upsertFeature(d, {
            ...d.features.find((f) => f.id === joinId)!,
            targetBodyIds: [ids[2], ids[0]],
          }),
        );
    },
    { ids, joinId },
  );
  await ready(page, [ids[2], ids[1], ids[3]], [5000, 1000, 1000]);
  const capture = page.getByRole("button", {
    name: "Capture intersected targets",
    exact: true,
  });
  await capture.click();
  await ready(page, [ids[2], ids[3]], [5000, 1000]);
  expect(
    (await state(page)).document.features.find((f) => f.id === joinId),
  ).toMatchObject({ targetBodyIds: [ids[2], ids[0], ids[1]] });
  await page.evaluate(
    async ({ ids, joinId }) => {
      const sp = "/src/state/useCadStore.ts",
        dp = "/src/cad/document/CadDocument.ts";
      const { upsertFeature } = await import(dp);
      (await import(sp)).useCadStore
        .getState()
        .updateDocument((d: CadDocument) => {
          const feature = d.features.find((f) => f.id === joinId)!;
          if (!("sketchId" in feature))
            throw new Error("Expected sketch feature");
          const sketch = d.sketches[feature.sketchId];
          return upsertFeature(
            {
              ...d,
              parameters: {
                ...d.parameters,
                size: { ...d.parameters.size, expression: "5mm" },
              },
              sketches: {
                ...d.sketches,
                [sketch.id]: {
                  ...sketch,
                  entities: Object.fromEntries(
                    Object.entries(sketch.entities).map(([key, e]) => [
                      key,
                      e.type === "point"
                        ? {
                            ...e,
                            x: {
                              ...e.x,
                              expression: e.x.expression.replace(
                                /\+ 5mm$/,
                                "+ 50mm",
                              ),
                            },
                          }
                        : e,
                    ]),
                  ),
                },
              },
            },
            { ...feature, targetBodyIds: [ids[2]] },
          );
        });
    },
    { ids, joinId },
  );
  await ready(page, ids, [1000, 1000, 1500, 1000]);
  const before = (await state(page)).document.updatedAt;
  await capture.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "face-only contact" }),
  ).toBeVisible();
  expect((await state(page)).document.updatedAt).toBe(before);
  expect(
    (await state(page)).document.features.find((f) => f.id === joinId),
  ).toMatchObject({ targetBodyIds: [ids[2]] });
  await ready(page, ids, [1000, 1000, 1500, 1000]);
});

test("native revolve join capture retains an authored primary body", async ({
  page,
}) => {
  await page.goto("/");
  await expect.poll(async () => (await state(page)).status).toBe("succeeded");
  const { ids, joinId } = await joinFixture(page, "revolve");
  await page.evaluate(
    async ({ ids, joinId }) => {
      const sp = "/src/state/useCadStore.ts",
        dp = "/src/cad/document/CadDocument.ts";
      const { upsertFeature } = await import(dp);
      (await import(sp)).useCadStore
        .getState()
        .updateDocument((d: CadDocument) =>
          upsertFeature(d, {
            ...d.features.find((f) => f.id === joinId)!,
            targetBodyIds: [ids[2], ids[0]],
          }),
        );
    },
    { ids, joinId },
  );
  const volume = Math.PI * 25 * 25 * 10;
  await ready(page, [ids[2], ids[1], ids[3]], [volume, 1000, 1000]);
  await page
    .getByRole("button", { name: "Capture intersected targets", exact: true })
    .click();
  await ready(page, [ids[2], ids[3]], [volume, 1000]);
  expect(
    (await state(page)).document.features.find((f) => f.id === joinId),
  ).toMatchObject({ targetBodyIds: [ids[2], ids[0], ids[1]] });
});
