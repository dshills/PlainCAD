import { readFile } from "node:fs/promises";
import { expect, type Page, type TestInfo } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";
import type { CommandRequest, CommandResponse } from "../src/commands/registry";
import { stlSignedVolume } from "./aiAcceptanceHelpers";

export async function stepFixture() {
  const project = JSON.parse(await readFile("src/persistence/fixtures/schema-v21.pcaddoc", "utf8")) as CadDocument;
  const feature = project.features[0];
  if (feature.type !== "stepImport") throw new Error("The schema 21 fixture must embed STEP source.");
  return { name: "Placed bore.step", mimeType: "application/step", buffer: Buffer.from(feature.stepSource) };
}
const volume = 2000 - 40 * Math.PI;

interface Snapshot {
  session: number;
  document: CadDocument;
  history: { undo: number };
  rebuild: {
    native: boolean;
    bodies: Array<{ id: string; bounds: { min: number[]; max: number[] }; assertions: { valid: boolean; solidCount: number; volume: number } }>;
  };
}

export async function stepCommand(page: Page, request: CommandRequest): Promise<CommandResponse> {
  return await page.evaluate(async text => {
    const input = JSON.parse(text);
    const list = await window.plaincadCommands.list();
    if (!list.ok) throw new Error(list.error.message);
    return await window.plaincadCommands.execute({ session: (list.value as { session: number }).session, ...input }) as unknown;
  }, JSON.stringify(request)) as CommandResponse;
}
function snapshot(receipt: CommandResponse): Snapshot {
  if (!receipt.ok) throw new Error(receipt.error.message);
  return receipt.value as unknown as Snapshot;
}
export async function openStepImport(page: Page) {
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Filter commands" }).fill("file.importStep");
  await page.locator('button[data-command="file.importStep"]').click();
  return page.getByRole("dialog", { name: "Import STEP solid", exact: true });
}
export async function assertStepImportWorkflow(page: Page, info: TestInfo, production = false) {
  const response = await page.goto("/");
  if (production) expect(response?.headers()["content-security-policy"]).toContain("worker-src");
  const dialog = await openStepImport(page);
  const before = snapshot(await stepCommand(page, { command: "runtime.snapshot" }));
  const file = dialog.getByLabel("STEP file", { exact: true });
  if (!production) {
    await file.setInputFiles({ name: "malformed.step", mimeType: "application/step", buffer: Buffer.from("invalid STEP") });
    await expect(dialog.getByRole("alert")).toContainText("ISO-10303-21");
    await expect(dialog.getByRole("button", { name: "Add STEP solid", exact: true })).toBeDisabled();
  }
  const fixture = await stepFixture();
  await file.setInputFiles(fixture);
  const apply = dialog.getByRole("button", { name: "Add STEP solid", exact: true });
  await expect(apply).toBeEnabled();
  await expect(dialog.getByRole("status")).toContainText("Native solid ready");
  expect(snapshot(await stepCommand(page, { command: "runtime.snapshot" })).document).toEqual(before.document);
  if (!production) {
    await dialog.getByRole("button", { name: "Cancel STEP import", exact: true }).click();
    await expect(dialog).toBeHidden();
    const text = fixture.buffer.toString("utf8");
    expect(await stepCommand(page, { command: "file.importStep", arguments: { file: { name: "Placed bore.step", text } } })).toMatchObject({ ok: true });
    await expect(apply).toBeEnabled();
  }
  await apply.click();
  await expect(dialog).toBeHidden();
  const accepted = snapshot(await stepCommand(page, { command: "runtime.awaitNative" }));
  const checkGeometry = (state: Snapshot) => {
    expect(state.rebuild.native).toBe(true);
    expect(state.rebuild.bodies).toHaveLength(1);
    const body = state.rebuild.bodies[0];
    expect(body.assertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(body.assertions.volume).toBeCloseTo(volume, 6);
    const bounds = { min: [26, -17, 9], max: [36, 3, 19] };
    for (const side of ["min", "max"] as const)
      body.bounds[side].forEach((value, index) => expect(value).toBeCloseTo(bounds[side][index], 5));
  };
  checkGeometry(accepted);
  expect(accepted.history.undo).toBe(before.history.undo + 1);
  expect(accepted.document.sketches).toEqual(before.document.sketches);
  expect(accepted.document.features).toHaveLength(1);
  expect(accepted.document.features[0]).toMatchObject({ type: "stepImport", operation: "newBody" });
  expect(await stepCommand(page, { command: "history.undo" })).toMatchObject({ ok: true });
  expect(snapshot(await stepCommand(page, { command: "runtime.snapshot" })).document).toEqual(before.document);
  expect(await stepCommand(page, { command: "history.redo" })).toMatchObject({ ok: true });
  checkGeometry(snapshot(await stepCommand(page, { command: "runtime.awaitNative" })));

  const saveDownload = page.waitForEvent("download");
  expect(await stepCommand(page, { command: "file.saveProject" })).toMatchObject({ ok: true });
  const saved = info.outputPath("imported-step.pcaddoc");
  await (await saveDownload).saveAs(saved);
  const savedText = await readFile(saved, "utf8");
  expect(JSON.parse(savedText).features[0].stepSource).toBe(fixture.buffer.toString("utf8"));
  expect(savedText).not.toMatch(/kernelHandle|geometryAssertions|nativeStepExport/);
  expect(await stepCommand(page, { command: "file.openProject", arguments: { file: { name: "imported-step.pcaddoc", text: savedText } } })).toMatchObject({ ok: true });
  const reopened = snapshot(await stepCommand(page, { command: "runtime.awaitNative" }));
  expect(reopened.session).toBeGreaterThan(accepted.session);
  expect(reopened.rebuild.bodies[0].id).toBe(accepted.rebuild.bodies[0].id);
  checkGeometry(reopened);

  const stlDownload = page.waitForEvent("download");
  expect(await stepCommand(page, { command: "file.exportStl" })).toMatchObject({ ok: true });
  const stl = info.outputPath("imported-step.stl");
  await (await stlDownload).saveAs(stl);
  expect(Math.abs(stlSignedVolume(await readFile(stl)) - volume)).toBeLessThan(0.5);
}
