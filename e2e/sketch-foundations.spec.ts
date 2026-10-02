import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

type State = { document: CadDocument; status: string; result?: RebuildResult };
async function snapshot(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const { useCadStore } = await import(path);
    const state = useCadStore.getState();
    return {
      document: state.history.present,
      status: state.rebuild.status,
      result: state.rebuild.result,
    };
  });
}
async function ready(page: Page, verify: (state: State) => void = () => {}) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.errors).toEqual([]);
    verify(state);
  }).toPass({ timeout: 20000 });
}
function volume(positions: ArrayLike<number>, indices: number[]) {
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    total +=
      (positions[a] *
        (positions[b + 1] * positions[c + 2] -
          positions[b + 2] * positions[c + 1]) -
        positions[a + 1] *
          (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
        positions[a + 2] *
          (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) /
      6;
  }
  return total;
}
function arcBody(state: State, radius: number, z: number) {
  const feature = state.document.features[1];
  const mesh = state.result!.meshes.find(
    (m) => m.bodyId === `body:${feature.id}`,
  )!;
  expect(mesh.geometrySource).toBe("opencascade");
  expect(volume(mesh.positions, mesh.indices)).toBeGreaterThan(
    ((Math.PI * radius * radius) / 2) * 5 * 0.99,
  );
  expect(volume(mesh.positions, mesh.indices)).toBeLessThan(
    ((Math.PI * radius * radius) / 2) * 5 * 1.01,
  );
  const min = [-radius, 0, z],
    max = [radius, radius, z + 5];
  mesh.bounds.min.forEach((value, i) => expect(value).toBeCloseTo(min[i], 3));
  mesh.bounds.max.forEach((value, i) => expect(value).toBeCloseTo(max[i], 3));
}
async function point(page: Page, x: string, y: string) {
  await page.getByLabel("Geometry type", { exact: true }).selectOption("point");
  await page.getByLabel("New point X", { exact: true }).fill(x);
  await page.getByLabel("New point Y", { exact: true }).fill(y);
  await page.getByRole("button", { name: "Add geometry", exact: true }).click();
}
async function commit(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press("Enter");
}

test("arc authoring, construction, driving dimensions, face offsets, save/open and explicit plane repair", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add center rectangle", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await ready(page, (state) => expect(state.result?.meshes).toHaveLength(1));
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await page
    .getByLabel("Sketch plane type", { exact: true })
    .selectOption("offset");
  await page
    .getByLabel("Sketch plane reference", { exact: true })
    .selectOption({ label: "Extrude 1 — end cap" });
  await page.getByLabel("Sketch plane offset", { exact: true }).fill("3mm");
  await page
    .getByRole("button", { name: "Apply sketch plane", exact: true })
    .click();
  await point(page, "0mm", "0mm");
  await point(page, "10mm", "0mm");
  await point(page, "-10mm", "0mm");
  await page.getByLabel("Geometry type", { exact: true }).selectOption("arc");
  await page
    .getByLabel("Geometry point 1", { exact: true })
    .selectOption({ label: "point 1" });
  await page
    .getByLabel("Geometry point 2", { exact: true })
    .selectOption({ label: "point 2" });
  await page
    .getByLabel("Geometry point 3", { exact: true })
    .selectOption({ label: "point 3" });
  await page.getByRole("button", { name: "Add geometry", exact: true }).click();
  await page.getByLabel("Geometry type", { exact: true }).selectOption("line");
  await page
    .getByLabel("Geometry point 1", { exact: true })
    .selectOption({ label: "point 3" });
  await page
    .getByLabel("Geometry point 2", { exact: true })
    .selectOption({ label: "point 2" });
  await page.getByRole("button", { name: "Add geometry", exact: true }).click();
  await point(page, "0mm", "15mm");
  await page.getByLabel("Geometry type", { exact: true }).selectOption("line");
  await page
    .getByLabel("Geometry point 1", { exact: true })
    .selectOption({ label: "point 1" });
  await page
    .getByLabel("Geometry point 2", { exact: true })
    .selectOption({ label: "point 4" });
  await page.getByLabel("New construction geometry", { exact: true }).check();
  await page.getByRole("button", { name: "Add geometry", exact: true }).click();
  await page
    .getByLabel("Constraint points", { exact: true })
    .selectOption([{ label: "point 1" }]);
  await page
    .getByRole("button", { name: "Add constraint", exact: true })
    .click();
  await page
    .getByLabel("Constraint type", { exact: true })
    .selectOption("horizontal");
  await page.getByLabel("Constraint points", { exact: true }).selectOption([]);
  await page
    .getByLabel("Constraint entities", { exact: true })
    .selectOption([{ label: "line 1" }]);
  await page
    .getByRole("button", { name: "Add constraint", exact: true })
    .click();
  await page
    .getByLabel("Dimension type", { exact: true })
    .selectOption("radius");
  await page
    .getByLabel("Dimension reference 1", { exact: true })
    .selectOption({ label: "arc 1" });
  await page
    .getByRole("button", { name: "Add dimension", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await commit(page, "Distance", "5mm");
  await ready(page, (state) => arcBody(state, 10, 13));
  const original = await snapshot(page),
    childId =
      original.document.features[1].type === "extrude"
        ? original.document.features[1].sketchId
        : "";
  const entityIds = Object.keys(
    original.document.sketches[childId].entities,
  ).sort();
  await page
    .getByRole("button", { name: /Sketch 2/ })
    .first()
    .click();
  const dimension = page.getByLabel("Dimension 1 expression", { exact: true });
  await dimension.fill("20mm");
  await dimension.press("Tab");
  await ready(page, (state) => arcBody(state, 20, 13));
  // A duplicate dimension is a failed solve, with export gated until repaired.
  await page
    .getByLabel("Dimension type", { exact: true })
    .selectOption("radius");
  await page
    .getByLabel("Dimension reference 1", { exact: true })
    .selectOption({ label: "arc 1" });
  await page
    .getByLabel("New dimension expression", { exact: true })
    .fill("20mm");
  await page
    .getByRole("button", { name: "Add dimension", exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Remove dimension 2", exact: true })
    .click();
  await ready(page, (state) => arcBody(state, 20, 13));
  await page
    .getByRole("button", { name: /Extrude 1/ })
    .first()
    .click();
  await commit(page, "Distance", "14mm");
  await ready(page, (state) => arcBody(state, 20, 17));
  const edited = await snapshot(page);
  expect(edited.document.features[1].id).toBe(original.document.features[1].id);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = testInfo.outputPath("arc.pcaddoc");
  await (await saving).saveAs(project);
  expect(await readFile(project, "utf8")).not.toMatch(
    /solvedSketches|geometrySource|kernelHandle/,
  );
  await page.reload();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(project);
  await ready(page, (state) => {
    expect(state.document.id).toBe(edited.document.id);
    arcBody(state, 20, 17);
  });
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const exportPanel = page.getByRole("dialog", { name: "STL export options" });
  await exportPanel.getByLabel("STL mode").selectOption("shells");
  await exportPanel.getByRole("button", { name: "Generate STL" }).click();
  const stl = testInfo.outputPath("arc.stl");
  await (await exporting).saveAs(stl);
  const bytes = await readFile(stl);
  expect(bytes.length).toBe(84 + 50 * bytes.readUInt32LE(80));
  const positions: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < bytes.readUInt32LE(80); i++) {
    for (let j = 0; j < 9; j++)
      positions.push(bytes.readFloatLE(84 + i * 50 + 12 + j * 4));
    indices.push(i * 3, i * 3 + 1, i * 3 + 2);
  }
  expect(volume(positions, indices)).toBeCloseTo(
    (await snapshot(page)).result!.meshes.reduce(
      (v, m) => v + volume(m.positions, m.indices),
      0,
    ),
    1,
  );
  await page
    .getByRole("button", { name: /Extrude 1/ })
    .first()
    .click();
  await page
    .getByRole("button", {
      name: "Suppress or unsuppress feature",
      exact: true,
    })
    .click();
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  expect(
    (await snapshot(page)).result?.errors.some(
      (e) => e.sourceId === childId && e.message.includes("reference lost"),
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: /Sketch 2/ })
    .first()
    .click();
  await expect(
    page.getByText(/Geometry is preserved; select a replacement plane/),
  ).toBeVisible();
  await page
    .getByLabel("Sketch plane type", { exact: true })
    .selectOption("origin");
  await page
    .getByRole("button", { name: "Apply sketch plane", exact: true })
    .click();
  await ready(page, (state) => {
    expect(state.result?.meshes).toHaveLength(1);
    arcBody(state, 20, 0);
  });
  expect(
    Object.keys(
      (await snapshot(page)).document.sketches[childId].entities,
    ).sort(),
  ).toEqual(entityIds);
  await page.screenshot({ path: testInfo.outputPath("repaired-arc.png") });
  expect(errors).toEqual([]);
});
