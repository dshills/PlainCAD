import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import type { CadDocument } from "../src/cad/document/schema";

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
async function commit(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}
function geometry(
  state: State,
  id: string,
  expected: number,
  operation: string,
) {
  const mesh = state.result!.meshes.find((m) => m.bodyId === `body:${id}`)!;
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.kernelOperation).toBe(operation);
  expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(
    Math.abs(mesh.geometryAssertions!.volume - expected) / expected,
  ).toBeLessThan(1e-7);
  let signed = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3,
      b = mesh.indices[i + 1] * 3,
      c = mesh.indices[i + 2] * 3,
      p = mesh.positions;
    signed +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  expect(signed / expected).toBeCloseTo(1, 2);
  return mesh;
}
async function fixture(
  page: Page,
  mode: "edges" | "toFace" | "boolean" | "revolve",
) {
  return page.evaluate(async (mode) => {
    const storePath = "/src/state/useCadStore.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      sketchPath = "/src/cad/sketch/SketchModel.ts",
      solvePath = "/src/cad/sketch/SketchSolver.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts";
    const { useCadStore } = await import(storePath),
      ops = await import(docPath),
      sketches = await import(sketchPath),
      { solveSketch } = await import(solvePath),
      { detectProfiles } = await import(profilePath);
    let document = ops.createEmptyDocument(`Native ${mode}`);
    const append = (width: number, height: number, x = 0) => {
      let sketch = sketches.addCornerRectangle(
        sketches.createXySketch(
          `Section ${Object.keys(document.sketches).length + 1}`,
        ),
        `${width}mm`,
        `${height}mm`,
      );
      if (x)
        sketch = {
          ...sketch,
          entities: Object.fromEntries(
            Object.entries(sketch.entities).map(
              ([id, entity]: [string, any]) => [
                id,
                entity.type === "point"
                  ? {
                      ...entity,
                      x: {
                        ...entity.x,
                        expression: `(${entity.x.expression}) + ${x}mm`,
                      },
                    }
                  : entity,
              ],
            ),
          ),
        };
      const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
      document = ops.upsertSketch(document, sketch);
      const feature = ops.createExtrudeFeature({
        name: `Solid ${document.features.length + 1}`,
        sketchId: sketch.id,
        profileId: profile.id,
        operation: "newBody",
        direction: "positive",
        distance: { expression: "10mm", unit: "mm" },
      });
      document = ops.upsertFeature(document, feature);
      const line = profile.outerLoop.segments.find(
        (segment: any) =>
          Math.abs(
            Math.hypot(
              segment.end.x - segment.start.x,
              segment.end.y - segment.start.y,
            ) - width,
          ) < 1e-6,
      );
      if (!line)
        throw new Error("Fixture profile has no edge matching its width.");
      return { id: feature.id, sketchId: sketch.id, lineId: line.id };
    };
    const base = append(
      mode === "toFace" ? 30 : 20,
      mode === "toFace" ? 20 : 10,
    );
    const tool =
      mode === "toFace"
        ? append(10, 5)
        : mode === "boolean"
          ? append(10, 10, 15)
          : undefined;
    if (mode === "revolve") document = { ...document, features: [] };
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({
      kind: mode === "revolve" ? "sketch" : "feature",
      id: mode === "revolve" ? base.sketchId : (tool?.id ?? base.id),
      documentId: document.id,
    });
    return { base, tool };
  }, mode);
}

test("native edge treatments: edit, parameter change, save/open, STL, and invalid-size recovery", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await ready(page);
  const { base } = await fixture(page, "edges");
  await ready(page);
  await page
    .getByRole("button", { name: "Fillet extrusion edges", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Source edge", exact: true })
    .selectOption(base.lineId);
  await ready(page, (s) =>
    geometry(s, base.id, 2000 - 20 * (1 - Math.PI / 4), "fillet"),
  );
  await page
    .getByRole("button", { name: "Add Parameter", exact: true })
    .click();
  await commit(page, "Parameter param_1 name", "roundRadius");
  await commit(page, "Parameter roundRadius expression", "2mm");
  const filletId = (await snapshot(page)).document.features[1].id;
  await page.locator(".timeline-chip").filter({ hasText: "Fillet" }).click();
  await commit(page, "Fillet radius", "roundRadius");
  await ready(page, (s) =>
    geometry(s, base.id, 2000 - 80 * (1 - Math.PI / 4), "fillet"),
  );
  await page
    .getByRole("button", { name: "Chamfer extrusion edges", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Edge role", exact: true })
    .selectOption("startCapPerimeter");
  await page
    .getByRole("combobox", { name: "Source edge", exact: true })
    .selectOption(base.lineId);
  const expected = 2000 - 80 * (1 - Math.PI / 4) - 10;
  await ready(page, (s) => geometry(s, base.id, expected, "chamfer"));
  await commit(page, "Chamfer distance", "100mm");
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("failed");
    expect(state.result?.errors[0].sourceId).toBe(
      state.document.features[2].id,
    );
    expect(state.result?.errors[0].message).toContain("chamfer failed");
    expect(state.result?.bodies[0].id).toBe(`body:${base.id}`);
  }).toPass({ timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  await commit(page, "Chamfer distance", "1mm");
  await ready(page);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const projectPath = testInfo.outputPath("edge-treatments.pcaddoc");
  await (await save).saveAs(projectPath);
  const saved: CadDocument = JSON.parse(await readFile(projectPath, "utf8"));
  expect(saved.features[1].id).toBe(filletId);
  expect(saved.features[1]).toMatchObject({
    radius: { expression: "roundRadius" },
  });
  expect(JSON.stringify(saved)).not.toContain("occtShape");
  await page.reload();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(projectPath);
  await ready(page, (s) => geometry(s, base.id, expected, "chamfer"));
  const exportStl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const path = testInfo.outputPath("edge-treatments.stl");
  await (await exportStl).saveAs(path);
  const stl = await readFile(path),
    triangles = stl.readUInt32LE(80);
  expect(stl.byteLength).toBe(84 + 50 * triangles);
  let signed = 0;
  for (let i = 0; i < triangles; i++) {
    const offset = 84 + 50 * i + 12;
    const p = Array.from({ length: 9 }, (_, j) =>
      stl.readFloatLE(offset + j * 4),
    );
    signed +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  expect(signed / expected).toBeCloseTo(1, 2);
});

test("finite to-face termination follows upstream edits and diagnoses lost references", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const { base, tool } = await fixture(page, "toFace");
  await ready(page);
  await page
    .getByRole("combobox", { name: "Termination", exact: true })
    .selectOption("toFace");
  await page
    .getByRole("combobox", { name: "Target face", exact: true })
    .selectOption(`extrude:${base.id}:endCap`);
  await ready(page, (s) => geometry(s, tool!.id, 500, "toFace"));
  await page.locator(".timeline-chip").filter({ hasText: "Solid 1" }).click();
  await commit(page, "Distance", "20mm");
  await ready(page, (s) => {
    const mesh = geometry(s, tool!.id, 1000, "toFace");
    expect(mesh.bounds.max[2]).toBeCloseTo(20, 5);
  });
  await page
    .getByRole("button", {
      name: "Suppress or unsuppress feature",
      exact: true,
    })
    .click();
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("failed");
    expect(
      state.result?.errors.some(
        (e) => e.sourceId === tool!.id && /to face reference/.test(e.message),
      ),
    ).toBe(true);
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
  await ready(page, (s) => geometry(s, tool!.id, 1000, "toFace"));
});

test("native revolve axes and angle edits, plus real boolean cut and join", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await fixture(page, "revolve");
  await ready(page);
  await page
    .getByRole("button", { name: "Revolve selected sketch", exact: true })
    .click();
  let state = await snapshot(page),
    id = state.document.features[0].id;
  await commit(page, "Angle", "90deg");
  await ready(page, (s) =>
    geometry(s, id, (Math.PI * 400 * 10) / 4, "revolve"),
  );
  await page
    .getByRole("combobox", { name: "Revolve axis", exact: true })
    .selectOption("origin:X");
  await ready(page, (s) =>
    geometry(s, id, (Math.PI * 100 * 20) / 4, "revolve"),
  );
  await commit(page, "Angle", "361deg");
  await expect(async () => {
    state = await snapshot(page);
    expect(state.status).toBe("failed");
    expect(state.result?.errors[0].message).toContain("360");
  }).toPass({ timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  const { base } = await fixture(page, "boolean");
  await ready(page);
  await page
    .getByRole("combobox", { name: "Target body", exact: true })
    .selectOption(`body:${base.id}`);
  await page
    .getByRole("combobox", { name: "Operation", exact: true })
    .selectOption("cut");
  await ready(page, (s) => geometry(s, base.id, 1500, "cut"));
  await page
    .getByRole("combobox", { name: "Operation", exact: true })
    .selectOption("join");
  await ready(page, (s) => geometry(s, base.id, 2500, "fuse"));
  await commit(page, "Distance", "20mm");
  await ready(page, (s) => geometry(s, base.id, 3500, "fuse"));
});

test("Inspector drafts stay visible without changing native geometry until commit", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await ready(page);
  const { base } = await fixture(page, "edges");
  await ready(page, (state) => geometry(state, base.id, 2000, "extrusion"));
  const before = await snapshot(page);
  const input = page.getByRole("textbox", { name: "Distance", exact: true });
  await input.fill("20mm");
  await expect(input).toHaveAttribute("data-dirty", "true");
  await expect(input).toHaveAccessibleDescription(
    "Uncommitted changes — Enter or leave field to apply; Escape cancels.",
  );
  await expect(page.locator(".commit-input-draft")).toBeVisible();
  await expect(page.getByLabel("Distance", { exact: true })).toHaveValue(
    "20mm",
  );
  await page.screenshot({ path: testInfo.outputPath("inspector-draft.png") });
  const unchanged = await snapshot(page);
  expect(unchanged.document).toEqual(before.document);
  expect(unchanged.result).toEqual(before.result);
  await input.press("Escape");
  await expect(input).toHaveValue("10mm");
  await expect(input).not.toHaveAttribute("data-dirty");
  await expect(page.locator(".commit-input-draft")).toHaveCount(0);
  await ready(page, (state) => geometry(state, base.id, 2000, "extrusion"));
  await input.fill("20mm");
  await input.press("Enter");
  await ready(page, (state) => geometry(state, base.id, 4000, "extrusion"));
  await expect(input).not.toHaveAttribute("data-dirty");
  await input.fill("25mm");
  await expect(input).toHaveAttribute("data-dirty", "true");
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.getState().undo();
  });
  await ready(page, (state) => geometry(state, base.id, 2000, "extrusion"));
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("10mm");
  await expect(input).not.toHaveAttribute("data-dirty");
  await input.press("Tab");
  await ready(page, (state) => geometry(state, base.id, 2000, "extrusion"));
});
