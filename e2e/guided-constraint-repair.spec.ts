import { focusedWorkspaceStorageState } from "./workspaceStorage";
import type { ResolvedSketch } from "../src/cad/sketch/SketchSolver";
import { test, expect, type Page } from "@playwright/test";
import type { CadDocument, Sketch } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import { applyExtrusion } from "./extrudeWorkflow";

test.use({
  storageState: focusedWorkspaceStorageState("http://127.0.0.1:5279"),
});
interface Snapshot {
  document: CadDocument;
  status: string;
  result?: RebuildResult;
  past: number;
  session: number;
}
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      status: state.rebuild.status,
      result: state.rebuild.result,
      past: state.history.past.length,
      session: state.documentSession,
    };
  });
}
async function settled(page: Page, failed = false) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe(failed ? "failed" : "succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    if (!failed) expect(state.result?.errors).toEqual([]);
  }).toPass({ timeout: 30000 });
}
async function duplicateFixture(page: Page) {
  return page.evaluate(async () => {
    const dp = "/src/cad/document/CadDocument.ts",
      sp = "/src/cad/sketch/SketchModel.ts",
      cp = "/src/cad/sketch/canvasGeometry.ts",
      solverPath = "/src/cad/sketch/SketchSolver.ts";
    const docs = await import(dp),
      { createXySketch } = await import(sp),
      { addCanvasGeometry } = await import(cp),
      { solveSketch } = await import(solverPath);
    const empty = createXySketch("Constraint repair rectangle");
    const baseSketch: Sketch = addCanvasGeometry(
      empty,
      solveSketch(empty, {}),
      "rectangle",
      [
        { x: 0, y: 0 },
        { x: 20, y: 10 },
      ],
    ).sketch;
    const solved: ResolvedSketch = solveSketch(baseSketch, {});
    const bottom = solved.lines.find(
      (line) => line.start.y === 0 && line.end.y === 0,
    );
    const right = solved.lines.find(
      (line) => line.start.x === 20 && line.end.x === 20,
    );
    const top = solved.lines.find(
      (line) => line.start.y === 10 && line.end.y === 10,
    );
    if (!bottom || !right || !top)
      throw new Error("Rectangle fixture edges unavailable");
    const sketch = {
      ...baseSketch,
      constraints: [
        {
          id: "keep-horizontal",
          type: "horizontal" as const,
          entityIds: [bottom.id],
          pointIds: [],
        },
        {
          id: "repair-duplicate",
          type: "horizontal" as const,
          entityIds: [bottom.id],
          pointIds: [],
        },
        {
          id: "other-vertical",
          type: "vertical" as const,
          entityIds: [right.id],
          pointIds: [],
        },
      ],
    } satisfies Sketch;
    return {
      document: docs.upsertSketch(
        docs.createEmptyDocument("Focused constraint repair"),
        sketch,
      ),
      sketchId: sketch.id,
      bottomId: bottom.id,
      topId: top.id,
      rightId: right.id,
    };
  });
}
async function openDuplicateCard(
  page: Page,
  fixture: Awaited<ReturnType<typeof duplicateFixture>>,
) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "duplicate-intent.pcaddoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture.document)),
  });
  await expect
    .poll(async () => (await snapshot(page)).document.id)
    .toBe(fixture.document.id);
  await settled(page, true);
  await expect(page.locator(".app-shell")).toHaveClass(/focused-workspace/);
  const failed = await snapshot(page);
  const errors = failed.result!.errors.filter((issue) => {
    const details = issue.details as { constraintId?: string } | undefined;
    return details?.constraintId === "repair-duplicate";
  });
  expect(errors).toHaveLength(1);
  expect(errors[0].sourceId).toBe(fixture.sketchId);
  expect(errors[0].message).toMatch(/redundant constraint/);
  await page.getByLabel("Task panel", { exact: true }).selectOption("issues");
  const card = page
    .locator(".repair-card")
    .filter({ hasText: "Repair a sketch constraint" });
  await expect(card).toHaveCount(1);
  await card
    .getByRole("button", { name: "Show and repair", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Sketch canvas", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Selected canvas constraint", { exact: true }),
  ).toContainText("Constraint ID: repair-duplicate. Type: horizontal.");
  await expect(
    page.getByLabel("Canvas constraint entity 1", { exact: true }),
  ).toHaveValue(fixture.bottomId);
  await expect(
    page.locator(
      '.canvas-constraint-selected[data-constraint-id="repair-duplicate"]',
    ),
  ).toHaveCount(1);
  await expect(
    page.getByLabel("Show all constraints", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", {
      name: "Apply constraint references",
      exact: true,
    }),
  ).toBeVisible();
  expect((await snapshot(page)).document).toEqual(failed.document);
  expect((await snapshot(page)).past).toBe(failed.past);
  return { card, failed };
}
async function extrudeRepaired(page: Page) {
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await applyExtrusion(page);
  await settled(page);
  await expect(async () => {
    const model = await snapshot(page),
      meshes = model.result!.meshes;
    expect(meshes).toHaveLength(1);
    expect(meshes[0].geometrySource).toBe("opencascade");
    expect(meshes[0].geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(meshes[0].geometryAssertions!.volume).toBeCloseTo(2000, 6);
    for (let axis = 0; axis < 3; axis++) {
      expect(meshes[0].bounds.min[axis]).toBeCloseTo(0, 6);
      expect(meshes[0].bounds.max[axis]).toBeCloseTo([20, 10, 10][axis], 6);
    }
  }).toPass({ timeout: 30000 });
}
test("Focused duplicate-constraint card selects exact references, consumes focus, and explicitly deletes one intent with Undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await settled(page);
  const fixture = await duplicateFixture(page),
    { card, failed } = await openDuplicateCard(page, fixture);
  const disclosure = page.getByText("Inspect and repair constraints (3)", {
    exact: true,
  });
  await disclosure.click();
  await expect(
    page.getByRole("button", {
      name: "Apply constraint references",
      exact: true,
    }),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "Show and repair", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Apply constraint references",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Inspect canvas constraint C3 V/ })
    .click();
  const selected = page.getByLabel("Selected canvas constraint", {
    exact: true,
  });
  await expect(selected).toContainText("Constraint ID: other-vertical.");
  const editState = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      store = (await import(path)).useCadStore;
    const previousResult = store.getState().rebuild.result;
    store.getState().updateDocument((document: CadDocument) => ({
      ...document,
      name: "Same document edited after repair focus",
    }));
    return {
      queued: store.getState().rebuild.status,
      oldResultRetained: store.getState().rebuild.result === previousResult,
    };
  });
  expect(editState.queued).toBe("queued");
  expect(editState.oldResultRetained).toBe(true);
  await settled(page, true);
  await expect(selected).toContainText("Constraint ID: other-vertical.");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled(page, true);
  expect((await snapshot(page)).document).toEqual(failed.document);
  await expect(selected).toContainText("Constraint ID: other-vertical.");
  await expect(
    page.getByLabel("Canvas constraint entity 1", { exact: true }),
  ).toHaveValue(fixture.rightId);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Sketch canvas", exact: true }),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "Show and repair", exact: true })
    .click();
  await expect(selected).toContainText("Constraint ID: repair-duplicate.");
  await expect(
    page.getByLabel("Canvas constraint entity 1", { exact: true }),
  ).toHaveValue(fixture.bottomId);
  const beforeDelete = await snapshot(page);
  await page
    .getByRole("button", { name: "Delete canvas constraint", exact: true })
    .click();
  await settled(page);
  const after = await snapshot(page),
    sketch = after.document.sketches[fixture.sketchId];
  expect(after.past).toBe(beforeDelete.past + 1);
  expect(sketch.constraints.map((c) => c.id)).toEqual([
    "keep-horizontal",
    "other-vertical",
  ]);
  expect(sketch.entities).toEqual(
    fixture.document.sketches[fixture.sketchId].entities,
  );
  expect(after.result!.profiles![fixture.sketchId]).toHaveLength(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled(page, true);
  expect((await snapshot(page)).document.sketches).toEqual(
    beforeDelete.document.sketches,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await settled(page);
  expect((await snapshot(page)).document.sketches).toEqual(
    after.document.sketches,
  );
  await extrudeRepaired(page);
  expect(errors).toEqual([]);
});
test("Focused constraint repair explicitly changes ordered references without replacing intent and builds native geometry", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const fixture = await duplicateFixture(page),
    { failed } = await openDuplicateCard(page, fixture);
  await page
    .getByLabel("Canvas constraint entity 1", { exact: true })
    .selectOption(fixture.topId);
  expect((await snapshot(page)).document).toEqual(failed.document);
  await page
    .getByRole("button", { name: "Apply constraint references", exact: true })
    .click();
  await settled(page);
  const repaired = await snapshot(page),
    sketch = repaired.document.sketches[fixture.sketchId];
  expect(repaired.past).toBe(failed.past + 1);
  expect(sketch.constraints).toEqual(
    failed.document.sketches[fixture.sketchId].constraints.map((constraint) =>
      constraint.id === "repair-duplicate"
        ? { ...constraint, entityIds: [fixture.topId] }
        : constraint,
    ),
  );
  expect(sketch.entities).toEqual(
    failed.document.sketches[fixture.sketchId].entities,
  );
  expect(repaired.result!.profiles![fixture.sketchId]).toHaveLength(1);
  await expect(
    page.getByLabel("Selected canvas constraint", { exact: true }),
  ).toContainText("Constraint ID: repair-duplicate. Type: horizontal.");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled(page, true);
  expect((await snapshot(page)).document.sketches).toEqual(
    failed.document.sketches,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await settled(page);
  expect((await snapshot(page)).document.sketches).toEqual(
    repaired.document.sketches,
  );
  await extrudeRepaired(page);
});
