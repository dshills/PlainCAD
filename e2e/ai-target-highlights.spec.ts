import { test, expect, type Page } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present as CadDocument,
      result: state.rebuild.result as RebuildResult,
      selection: state.selection,
      past: state.history.past.length,
      session: state.documentSession,
    };
  });
}
async function highlighted(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    const viewer = (await import(path)).inspectViewer();
    if (!viewer || viewer.meshes.length !== 2)
      throw new Error("Expected both native solids in the mounted viewer.");
    return viewer.meshes
      .filter((m: { highlighted?: boolean }) => m.highlighted)
      .map((m: { bodyId: string }) => m.bodyId);
  });
}
async function expectNative(page: Page, volumes: number[]) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect
    .poll(async () => (await snapshot(page)).result?.meshes.length)
    .toBe(2);
  const meshes = (await snapshot(page)).result.meshes;
  for (const [i, mesh] of meshes.entries()) {
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(mesh.geometryAssertions!.volume).toBeCloseTo(volumes[i], 3);
  }
}
test("AI ambiguous dimensions highlight distinct native solids, preserve selection and scope, and change only the explicitly chosen target", async ({
  page,
}) => {
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
      json: { error: "No provider calls expected." },
    });
  });
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.evaluate(async () => {
    const storePath = "/src/state/useCadStore.ts",
      buildPath = "/src/ai/buildPlan.ts",
      emptyPath = "/src/cad/document/CadDocument.ts",
      planPath = "/src/tests/fixtures/aiTargetsPlan.ts";
    const [store, build, empty, plans] = await Promise.all([
      import(storePath),
      import(buildPath),
      import(emptyPath),
      import(planPath),
    ]);
    const staged = build.buildAiPlan(
      empty.createEmptyDocument(),
      plans.separatePartsPlan,
    );
    store.useCadStore.getState().setDocument(staged.document);
    store.useCadStore.getState().activateComponent(staged.componentId);
    store.useCadStore.getState().select({
      kind: "feature",
      id: staged.document.features[0].id,
      documentId: staged.document.id,
    });
  });
  await expectNative(page, [1000, 500]);
  const before = await snapshot(page),
    ids = before.result.meshes.map((m) => m.bodyId);
  await page
    .getByRole("button", { name: "Open AI drawer", exact: true })
    .click();
  const drawer = page.getByRole("region", { name: "AI modeling assistant" });
  await drawer.getByRole("button", { name: "This part", exact: true }).click();
  await drawer
    .getByLabel("What would you like to make?")
    .fill("Make this thicker to 8 mm");
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(drawer.getByLabel("AI clarification")).toContainText(
    "Which dimension",
  );
  await drawer
    .getByRole("button", { name: "Show geometry for width", exact: true })
    .click();
  await expect.poll(() => highlighted(page)).toEqual([ids[0]]);
  await drawer
    .getByRole("button", { name: "Show geometry for depth", exact: true })
    .click();
  await expect.poll(() => highlighted(page)).toEqual([ids[1]]);
  expect((await snapshot(page)).selection).toEqual(before.selection);
  expect((await snapshot(page)).document).toEqual(before.document);
  expect((await snapshot(page)).past).toBe(before.past);
  await expect(
    drawer.getByRole("button", { name: "This part", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // Busy/open-file context clears the rendered hint and does not revive it afterward.
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.setState({ fileBusy: true });
  });
  await expect.poll(() => highlighted(page)).toEqual([]);
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    (await import(path)).useCadStore.setState({ fileBusy: false });
  });
  // Flush the next painted frame/effect cycle before proving the hint stays cleared.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect.poll(() => highlighted(page)).toEqual([]);
  await drawer
    .getByRole("button", { name: "Show geometry for depth", exact: true })
    .click();
  await expect.poll(() => highlighted(page)).toEqual([ids[1]]);
  await drawer
    .getByRole("button", { name: "Change depth (10mm)", exact: true })
    .click();
  await expect.poll(() => highlighted(page)).toEqual([]);
  await expect(drawer.getByLabel("AI edit target")).toContainText("depth");
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  const apply = drawer.getByRole("button", {
    name: "Apply AI parameter edits",
  });
  await expect(apply).toBeEnabled();
  await expect(drawer.getByLabel("Proposed parameter changes")).toContainText(
    "10mm → 8mm",
  );
  await expect(drawer).toContainText("1400.000 mm³");
  expect((await snapshot(page)).document).toEqual(before.document);
  expect((await snapshot(page)).selection).toEqual(before.selection);
  await apply.click();
  await expectNative(page, [1000, 400]);
  const after = await snapshot(page);
  expect(after.past).toBe(before.past + 1);
  expect(after.document.features).toEqual(before.document.features);
  expect(after.document.sketches).toEqual(before.document.sketches);
  // Apply retains its existing behavior of selecting the last affected feature.
  expect(after.selection.selectedIds[0]).toMatchObject({
    kind: "feature",
    id: before.document.features.at(-1)!.id,
  });
  const changed = Object.keys(before.document.parameters).filter(
    (name) =>
      JSON.stringify(after.document.parameters[name]) !==
      JSON.stringify(before.document.parameters[name]),
  );
  expect(changed).toEqual(["ai_1_depth"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectNative(page, [1000, 500]);
  expect((await snapshot(page)).document).toEqual(before.document);
  expect(requests).toBe(0);
});
