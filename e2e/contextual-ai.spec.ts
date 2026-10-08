import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function snapshot(
  page: Page,
): Promise<{
  document: CadDocument;
  result?: RebuildResult;
  past: number;
  session: number;
}> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      result: state.rebuild.result,
      past: state.history.past.length,
      session: state.documentSession,
    };
  });
}
const volume = (distance: number) => (2400 - 4 * Math.PI) * distance;
async function expectNative(page: Page, distance: number) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume(distance), 4);
  const mesh = (await snapshot(page)).result!.meshes[0];
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
}

test("contextual scope, exact local feature sizing, native preview, stale selection, undo and durable exports", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  let requests = 0;
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      json: {
        providers: ["anthropic", "openai", "google"].map((id) => ({
          id,
          label: id,
          model: "test-model",
          available: false,
        })),
      },
    }),
  );
  await page.route("**/api/ai/generate", (route) => {
    requests += 1;
    return route.fulfill({
      status: 500,
      json: { error: "Local numeric editing must not call a provider." },
    });
  });
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      buildPath = "/src/ai/buildPlan.ts",
      emptyPath = "/src/cad/document/CadDocument.ts",
      planPath = "/src/tests/fixtures/aiPlan.ts";
    const [
      { useCadStore },
      { buildAiPlan },
      { createEmptyDocument },
      { aiPlatePlan },
    ] = await Promise.all([
      import(storePath),
      import(buildPath),
      import(emptyPath),
      import(planPath),
    ]);
    const staged = buildAiPlan(createEmptyDocument(), aiPlatePlan),
      state = useCadStore.getState();
    state.setDocument(staged.document);
    state.activateComponent(staged.componentId);
    state.select({
      kind: "feature",
      id: staged.document.features[0].id,
      documentId: staged.document.id,
    });
  });
  await expectNative(page, 5);
  const before = await snapshot(page),
    feature = before.document.features[0];
  await page
    .getByRole("button", { name: "Open AI assistant", exact: true })
    .click();
  const drawer = page.getByRole("region", { name: "AI modeling assistant" });
  await drawer
    .getByLabel("What would you like to make?")
    .fill("Make this thicker to 8 mm");
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(drawer.getByLabel("AI clarification")).toContainText(
    "choose This part or Selected feature",
  );
  expect(requests).toBe(0);
  await drawer
    .getByRole("combobox", { name: "AI scope", exact: true }).selectOption("feature");
  await expect(drawer.getByLabel("AI edit target")).toContainText(
    `${feature.name} → distance`,
  );
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  const apply = drawer.getByRole("button", { name: "Apply AI feature edits" });
  await expect(apply).toBeEnabled();
  await expect(drawer.getByLabel("Proposed parameter changes")).toContainText(
    "distance: ai_1_thickness → 8mm",
  );
  await expect(drawer).toContainText(`${volume(8).toFixed(3)} mm³`);
  expect((await snapshot(page)).document).toEqual(before.document);
  // Selecting a different feature invalidates an already completed preview.
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    state.select({
      kind: "feature",
      id: state.history.present.features[1].id,
      documentId: state.history.present.id,
    });
  });
  await expect(apply).toBeDisabled();
  await page.evaluate(async (id) => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    state.select({ kind: "feature", id, documentId: state.history.present.id });
  }, feature.id);
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(apply).toBeEnabled();
  await drawer.getByLabel("Proposed distance (mm)").fill("9");
  await expect(apply).toBeDisabled();
  await drawer
    .getByRole("button", { name: "Preview dimension changes" })
    .click();
  await expect(apply).toBeEnabled();
  await expect(drawer).toContainText(`${volume(9).toFixed(3)} mm³`);
  await apply.click();
  await expectNative(page, 9);
  const after = await snapshot(page);
  expect(after.past).toBe(before.past + 1);
  expect(after.document.parameters).toEqual(before.document.parameters);
  expect(after.document.sketches).toEqual(before.document.sketches);
  expect(after.document.features.map((f) => f.id)).toEqual(
    before.document.features.map((f) => f.id),
  );
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectNative(page, 5);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectNative(page, 9);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const projectPath = info.outputPath("contextual.pcaddoc");
  await (await saved).saveAs(projectPath);
  await page.locator('input[type="file"]').setInputFiles(projectPath);
  await expect
    .poll(async () => (await snapshot(page)).session)
    .toBeGreaterThan(after.session);
  await expectNative(page, 9);
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath("contextual.stl");
  await (await exported).saveAs(stlPath);
  const bytes = await readFile(stlPath),
    triangles = bytes.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(0);
  expect(bytes.length).toBe(84 + triangles * 50);
  let signedVolume = 0;
  for (let i = 0; i < triangles; i += 1) {
    const offset = 84 + i * 50 + 12;
    const a = [0, 1, 2].map((j) => bytes.readFloatLE(offset + j * 4));
    const b = [0, 1, 2].map((j) => bytes.readFloatLE(offset + 12 + j * 4));
    const c = [0, 1, 2].map((j) => bytes.readFloatLE(offset + 24 + j * 4));
    signedVolume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  expect(signedVolume).toBeGreaterThan(0);
  expect(Math.abs(signedVolume / volume(9) - 1)).toBeLessThan(0.01);
  expect(requests).toBe(0);
});
