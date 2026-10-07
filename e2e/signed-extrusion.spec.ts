import { applyModeling } from "./modelingWorkflow";
import { applyExtrusion } from "./extrudeWorkflow";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument, OriginPlane } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

type State = { document: CadDocument; status: string; result?: RebuildResult };
async function snapshot(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      status: state.rebuild.status,
      result: state.rebuild.result,
    };
  });
}
async function ready(page: Page, check: (state: State) => void = () => {}) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.errors).toEqual([]);
    expect(state.result?.metrics?.disposalFailures).toBe(0);
    check(state);
  }).toPass({ timeout: 20000 });
}
async function fixture(
  page: Page,
  plane: OriginPlane,
  direction: "negative" | "symmetric",
) {
  return page.evaluate(
    async ({ plane, direction }) => {
      const paths = [
        "/src/state/useCadStore.ts",
        "/src/cad/document/CadDocument.ts",
        "/src/cad/sketch/SketchModel.ts",
        "/src/cad/sketch/SketchSolver.ts",
        "/src/cad/sketch/profileDetection.ts",
      ];
      const [
        { useCadStore },
        ops,
        sketches,
        { solveSketch },
        { detectProfiles },
      ] = await Promise.all(paths.map((path) => import(path)));
      let document = ops.createEmptyDocument("Signed extrusion");
      document = ops.upsertParameter(document, {
        id: "depth",
        name: "depth",
        expression: "10mm",
        value: 10,
        unit: "mm",
        authoredUnit: "mm",
      });
      const sketch = sketches.addCornerRectangle(
        sketches.createSketchOnPlane("Owner section", plane),
        "20mm",
        "10mm",
      );
      document = ops.upsertSketch(document, sketch);
      const owner = ops.createExtrudeFeature({
        name: "Signed owner",
        sketchId: sketch.id,
        profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
        distance: { expression: "depth", unit: "mm" },
        direction,
        operation: "newBody",
      });
      document = ops.upsertFeature(document, owner);
      const child = sketches.addCornerRectangle(
        sketches.createSketchOnPlane("Face section", "XY"),
        "2mm",
        "2mm",
      );
      document = ops.upsertSketch(document, child);
      useCadStore.getState().setDocument(document);
      useCadStore
        .getState()
        .select({ kind: "sketch", id: child.id, documentId: document.id });
      return {
        owner: owner.id,
        child: child.id,
      };
    },
    { plane, direction },
  );
}
function native(state: State, id: string, volume: number) {
  const mesh = state.result!.meshes.find(
    (mesh) => mesh.bodyId === `body:${id}`,
  )!;
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 6);
  return mesh;
}
async function select(page: Page, kind: "feature" | "parameter", id: string) {
  await page.evaluate(
    async ({ kind, id }) => {
      const path = "/src/state/useCadStore.ts";
      const state = (await import(path)).useCadStore.getState();
      state.select({ kind, id, documentId: state.history.present.id });
    },
    { kind, id },
  );
}
async function commit(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press("Enter");
}
function signedVolume(stl: Buffer) {
  const triangles = stl.readUInt32LE(80);
  expect(stl.length).toBe(84 + triangles * 50);
  let volume = 0;
  for (let i = 0; i < triangles; i++) {
    const p = Array.from({ length: 9 }, (_, j) =>
      stl.readFloatLE(84 + i * 50 + 12 + j * 4),
    );
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return volume;
}
for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: signed owner face planes track edits, diagnose suppression, save/open and export native geometry`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await ready(page);
    for (const direction of ["negative", "symmetric"] as const) {
      const ids = await fixture(page, plane, direction);
      await ready(page);
      for (const role of ["startCap", "endCap"] as const) {
        await page
          .getByLabel("Sketch plane type", { exact: true })
          .selectOption("offset");
        await page
          .getByLabel("Sketch plane reference", { exact: true })
          .selectOption(`extrude:${ids.owner}:${role}`);
        await page
          .getByLabel("Sketch plane offset", { exact: true })
          .fill("1mm");
        await page
          .getByRole("button", { name: "Apply sketch plane", exact: true })
          .click();
        await ready(page);
        const transform = await page.evaluate(async (child) => {
          const paths = [
            "/src/state/useCadStore.ts",
            "/src/cad/sketch/planes.ts",
          ];
          const [{ useCadStore }, { resolveDocumentPlanes }] =
            await Promise.all(paths.map((path) => import(path)));
          const document = useCadStore.getState().history.present;
          return resolveDocumentPlanes(
            document,
            useCadStore.getState().rebuild.result?.parameterValues ?? {},
          ).transforms.get(child);
        }, ids.child);
        expect(transform).toBeDefined();
        const axis = plane === "XY" ? "z" : plane === "XZ" ? "y" : "x";
        const normal = plane === "XZ" ? -1 : 1;
        const start = direction === "negative" ? -10 : -5;
        const height = role === "startCap" ? start - 1 : start + 11;
        expect(transform!.origin[axis]).toBeCloseTo(height * normal, 6);
        expect(transform!.normal[axis]).toBeCloseTo(
          normal * (role === "startCap" ? -1 : 1),
          6,
        );
      }
      await page
        .getByRole("button", { name: "Extrude selected sketch", exact: true })
        .click();
      await applyExtrusion(page);
      await commit(page, "Distance", "2mm");
      const childFeature = (await snapshot(page)).document.features[1].id;
      await select(page, "parameter", "depth");
      await commit(page, "depth expression", "20mm");
      await ready(page, (state) => {
        native(state, ids.owner, 4000);
        const mesh = native(state, childFeature, 8);
        const axis = plane === "XY" ? 2 : plane === "XZ" ? 1 : 0;
        const end = direction === "negative" ? 0 : 10;
        expect(mesh.bounds.min[axis]).toBeCloseTo(
          plane === "XZ" ? -end - 3 : end + 1,
          5,
        );
        expect(mesh.bounds.max[axis]).toBeCloseTo(
          plane === "XZ" ? -end - 1 : end + 3,
          5,
        );
      });
      await select(page, "feature", ids.owner);
      await page
        .getByRole("button", {
          name: "Suppress or unsuppress feature",
          exact: true,
        })
        .click();
      await expect(async () => {
        const state = await snapshot(page);
        expect(state.status).toBe("failed");
        expect(state.result?.errors).toContainEqual(
          expect.objectContaining({
            sourceId: ids.child,
            message: expect.stringContaining("reference lost"),
          }),
        );
      }).toPass({ timeout: 20000 });
      await expect(
        page.getByRole("button", { name: "Export STL", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", {
          name: "Suppress or unsuppress feature",
          exact: true,
        })
        .click();
      await ready(page);
      const saved = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      const projectPath = testInfo.outputPath(`${direction}.pcaddoc`);
      await (await saved).saveAs(projectPath);
      await page.reload();
      await ready(page);
      await page.locator('input[type="file"]').setInputFiles(projectPath);
      await ready(page, (state) => {
        native(state, ids.owner, 4000);
        native(state, childFeature, 8);
      });
      await page
        .getByRole("button", { name: "Export STL", exact: true })
        .click();
      await page.getByLabel("Output files", { exact: true }).selectOption("shells");
      const exported = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Generate STL", exact: true })
        .click();
      const stlPath = testInfo.outputPath(`${direction}.stl`);
      await (await exported).saveAs(stlPath);
      expect(signedVolume(await readFile(stlPath))).toBeCloseTo(4008, 3);
    }
  });
}

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: signed native edge treatments change exact volume and survive repair and persistence`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await ready(page);
    const corner = 1 - Math.PI / 4;
    for (const direction of ["negative", "symmetric"] as const) {
      const ids = await fixture(page, plane, direction);
      await ready(page);
      const state = await snapshot(page);
      const owner = state.document.features.find((f) => f.id === ids.owner)!;
      if (owner.type !== "extrude") throw new Error("Expected extrusion owner");
      const line = Object.values(
        state.document.sketches[owner.sketchId].entities,
      ).find((e) => e.type === "line")!;
      await select(page, "feature", ids.owner);
      await expect(
        page.getByRole("button", {
          name: "Fillet extrusion edges",
          exact: true,
        }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Fillet extrusion edges", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Fillet", exact: true })
        .getByRole("combobox", { name: "Source edge", exact: true })
        .selectOption(line.id);
      await applyModeling(page, "Fillet");
      await ready(page, (state) =>
        native(state, ids.owner, 2000 - 20 * corner),
      );
      await page
        .getByRole("combobox", { name: "Edge role", exact: true })
        .selectOption("startCapPerimeter");
      await page
        .getByRole("combobox", { name: "Source edge", exact: true })
        .selectOption(line.id);
      await ready(page, (state) =>
        native(state, ids.owner, 2000 - 20 * corner),
      );
      await page
        .getByRole("combobox", { name: "Edge role", exact: true })
        .selectOption("profileEdge");
      await page
        .getByRole("combobox", { name: "Source edge", exact: true })
        .selectOption(line.id);
      await commit(page, "Fillet radius", "2mm");
      await ready(page, (state) =>
        native(state, ids.owner, 2000 - 80 * corner),
      );
      await select(page, "parameter", "depth");
      await commit(page, "depth expression", "20mm");
      await ready(page, (state) =>
        native(state, ids.owner, 4000 - 160 * corner),
      );
      const fillet = (await snapshot(page)).document.features[1].id;
      await select(page, "feature", fillet);
      await page
        .getByRole("combobox", { name: "Edge role", exact: true })
        .selectOption("endCapPerimeter");
      await page
        .getByRole("combobox", { name: "Source edge", exact: true })
        .selectOption(line.id);
      await ready(page, (state) =>
        native(state, ids.owner, 4000 - 80 * corner),
      );
      await page
        .getByRole("button", { name: "Chamfer extrusion edges", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Chamfer", exact: true })
        .getByRole("combobox", { name: "Source edge", exact: true })
        .selectOption(line.id);
      const expected = 4000 - 80 * corner - 10;
      await applyModeling(page, "Chamfer");
      await ready(page, (state) => {
        const mesh = native(state, ids.owner, expected);
        expect(mesh.kernelOperation).toBe("chamfer");
        const axis = plane === "XY" ? 2 : plane === "XZ" ? 1 : 0;
        const start = direction === "negative" ? -20 : -10;
        const min = plane === "XZ" ? -start - 20 : start;
        expect(mesh.bounds.min[axis]).toBeCloseTo(min, 5);
        expect(mesh.bounds.max[axis]).toBeCloseTo(min + 20, 5);
      });
      await commit(page, "Chamfer distance", "100mm");
      await expect(async () => {
        const state = await snapshot(page);
        expect(state.status).toBe("failed");
        expect(state.result?.errors).toContainEqual(
          expect.objectContaining({
            sourceId: state.document.features[2].id,
            message: expect.stringContaining("chamfer failed"),
          }),
        );
      }).toPass({ timeout: 20000 });
      await expect(
        page.getByRole("button", { name: "Export STL", exact: true }),
      ).toBeDisabled();
      await commit(page, "Chamfer distance", "1mm");
      await ready(page, (state) => native(state, ids.owner, expected));
      const saved = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      const projectPath = testInfo.outputPath(`${direction}-edges.pcaddoc`);
      await (await saved).saveAs(projectPath);
      await page.reload();
      await ready(page);
      await page.locator('input[type="file"]').setInputFiles(projectPath);
      await ready(page, (state) => native(state, ids.owner, expected));
      const exported = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export STL", exact: true })
        .click();
      const path = testInfo.outputPath(`${direction}-edges.stl`);
      await (await exported).saveAs(path);
      expect(signedVolume(await readFile(path)) / expected).toBeCloseTo(1, 2);
    }
  });
}
