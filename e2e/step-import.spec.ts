import { expect, test } from "@playwright/test";
import { assertStepImportWorkflow, openStepImport, stepFixture, stepCommand } from "./stepImportAcceptance";

test("STEP UI and JSON import preserve placed native geometry, cancel, undo, save/open and STL", async ({ page }, info) => {
  await assertStepImportWorkflow(page, info);
});

test("same-ID project replacement aborts the pending native STEP preview and forbids Apply", async ({ page }) => {
  const previewScript = (url: URL) => url.pathname.includes("extrudePreviewWorker") && url.searchParams.has("worker_file");
  let release: () => void = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route(previewScript, async route => { await blocked; await route.abort().catch(() => undefined); });
  await page.goto("/");
  const dialog = await openStepImport(page);
  const requested = page.waitForRequest(request => previewScript(new URL(request.url())));
  try {
    await dialog.getByLabel("STEP file", { exact: true }).setInputFiles(await stepFixture());
    await requested;
    await expect(dialog.getByRole("status")).toContainText("Validating STEP solid");
    await page.evaluate(async () => {
      const storePath = "/src/state/useCadStore.ts";
      const store = (await import(storePath)).useCadStore;
      store.getState().setDocument({ ...store.getState().history.present });
    });
    await expect(dialog).toBeHidden();
    expect(await stepCommand(page, { command: "file.applyStepImport" })).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(await stepCommand(page, { command: "runtime.snapshot" })).toMatchObject({ ok: true, value: { document: { features: [] }, history: { undo: 0 } } });
  } finally { release(); }
});
