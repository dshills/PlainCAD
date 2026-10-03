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
  test(`${mode}: native multi-body cut scopes, atomic failure, reference repair, edits and save/open/STL`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect.poll(async () => (await state(page)).status).toBe("succeeded");
    const { ids, cutId } = await fixture(page, mode);
    const base = mode === "extrude" ? 2000 : 1000;
    const volume = (r: number) =>
      base - (Math.PI * r * r * 10) / (mode === "extrude" ? 1 : 4);
    await ready(page, ids, [volume(2), base, base]);
    const scope = page.getByRole("group", {
      name: "Cut target scope",
      exact: true,
    });
    await scope
      .getByLabel("Include target Upper Body", { exact: true })
      .check();
    await ready(page, ids, [volume(2), volume(2), base]);
    expect(
      (await state(page)).document.features.find((f) => f.id === cutId),
    ).toMatchObject({ targetBodyIds: ids.slice(0, 2) });
    const scoped = await state(page);
    for (const id of ids.slice(0, 2))
      expect(
        scoped.result!.meshes.find((m) => m.bodyId === id)?.kernelOperation,
      ).toBe("cut");
    if (mode === "extrude") {
      const s = await state(page);
      expect(
        s.result!.meshes.find((m) => m.bodyId === ids[0])!.bounds.min[2],
      ).toBeCloseTo(0, 5);
      expect(
        s.result!.meshes.find((m) => m.bodyId === ids[1])!.bounds.min[2],
      ).toBeCloseTo(20, 5);
      expect(
        s.result!.meshes.find((m) => m.bodyId === ids[1])!.bounds.max[2],
      ).toBeCloseTo(30, 5);
    }
    // First targets succeed, but a later disjoint target must roll the entire feature back.
    await scope.getByLabel("Include target Far Body", { exact: true }).check();
    await expect.poll(async () => (await state(page)).status).toBe("failed");
    let s = await state(page);
    for (const id of ids)
      expect(
        s.result!.meshes.find((m) => m.bodyId === id)!.geometryAssertions!
          .volume,
      ).toBeCloseTo(base, 5);
    expect(s.result!.errors.find((e) => e.sourceId === cutId)?.message).toMatch(
      /target "Far".*removed no volume/,
    );
    expect(s.result!.metrics?.disposalFailures).toBe(0);
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeDisabled();
    await scope
      .getByLabel("Include target Far Body", { exact: true })
      .uncheck();
    await ready(page, ids, [volume(2), volume(2), base]);
    await page.getByLabel("Parameter radius expression").fill("3mm");
    await page.getByLabel("Parameter radius expression").press("Enter");
    await ready(page, ids, [volume(3), volume(3), base]);
    await page
      .getByRole("list", { name: "Sketch and feature history" })
      .getByRole("button", { name: /Scoped cut/ })
      .click();
    // Persist a lost ID; never infer another body in its place. Explicit removal repairs it.
    await page.evaluate(
      async ({ cutId, ids }) => {
        const sp = "/src/state/useCadStore.ts",
          dp = "/src/cad/document/CadDocument.ts";
        const { upsertFeature } = await import(dp);
        (await import(sp)).useCadStore
          .getState()
          .updateDocument((d: CadDocument) =>
            upsertFeature(d, {
              ...d.features.find((f) => f.id === cutId)!,
              targetBodyIds: [ids[0], ids[1], "body:lost"],
            }),
          );
      },
      { cutId, ids },
    );
    await expect.poll(async () => (await state(page)).status).toBe("failed");
    s = await state(page);
    expect(
      s.result!.errors.find((e) => e.sourceId === cutId)?.message,
    ).toContain("body:lost");
    await scope
      .getByLabel("Include target Lost or downstream body body:lost", {
        exact: true,
      })
      .click();
    await expect(
      scope.getByLabel("Include target Lost or downstream body body:lost", {
        exact: true,
      }),
    ).toHaveCount(0);
    await ready(page, ids, [volume(3), volume(3), base]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await state(page)).status).toBe("failed");
    expect(
      (await state(page)).document.features.find((f) => f.id === cutId),
    ).toMatchObject({ targetBodyIds: [ids[0], ids[1], "body:lost"] });
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await ready(page, ids, [volume(3), volume(3), base]);
    let download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const projectPath = info.outputPath(`${mode}.pcaddoc`);
    await (await download).saveAs(projectPath);
    const saved = JSON.parse(
      await readFile(projectPath, "utf8"),
    ) as CadDocument;
    expect(saved.features.find((f) => f.id === cutId)).toMatchObject({
      targetBodyIds: ids.slice(0, 2),
    });
    await page
      .getByRole("button", {
        name: "Load parametric box template",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await state(page)).document.id)
      .not.toBe(saved.id);
    await page.locator('input[type="file"]').setInputFiles(projectPath);
    await ready(page, ids, [volume(3), volume(3), base]);
    await page.getByRole("button", { name: "Lower", exact: true }).click();
    download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export selected body", exact: true })
      .click();
    const stlPath = info.outputPath(`${mode}.stl`);
    await (await download).saveAs(stlPath);
    expect(stlVolume(await readFile(stlPath)) / volume(3)).toBeCloseTo(1, 2);
    expect(errors).toEqual([]);
  });
}
