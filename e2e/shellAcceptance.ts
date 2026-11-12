import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEmptyDocument } from "../src/cad/document/CadDocument";
import type { CadDocument } from "../src/cad/document/schema";
import type { JsonValue } from "../src/commands/registry";
import { stlSignedVolume } from "./aiAcceptanceHelpers";

type Snapshot = {
  session: number;
  document: CadDocument;
  history: { undo: number };
  rebuild: {
    native: boolean;
    bodies: { id: string; bounds: { min: number[]; max: number[] }; assertions: { valid: boolean; solidCount: number; volume: number } }[];
  };
};

async function command<T = unknown>(page: Page, id: string, args: JsonValue = {}): Promise<T> {
  const response = await page.evaluate(async (text) => {
    const snapshot = await window.plaincadCommands.execute({ command: "runtime.snapshot" });
    if (!snapshot.ok) throw new Error(snapshot.error.message);
    return window.plaincadCommands.execute({ ...JSON.parse(text), session: (snapshot.value as { session: number }).session });
  }, JSON.stringify({ command: id, arguments: args }));
  if (!response.ok) throw new Error(`${id}: ${response.error.message}`);
  return response.value as T;
}

async function native(page: Page, bodyId: string, volume: number) {
  const snapshot = await command<Snapshot>(page, "runtime.awaitNative");
  expect(snapshot.rebuild.native).toBe(true);
  expect(snapshot.rebuild.bodies).toHaveLength(1);
  const body = snapshot.rebuild.bodies[0];
  expect(body.id).toBe(bodyId);
  expect(body.assertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(body.assertions.volume).toBeCloseTo(volume, 6);
  [0, -8, 0].forEach((n, i) => expect(body.bounds.min[i]).toBeCloseTo(n, 6));
  [20, 0, 10].forEach((n, i) => expect(body.bounds.max[i]).toBeCloseTo(n, 6));
  return snapshot;
}

export function shellAcceptance(title: string) {
  test(title, async ({ page }, info) => {
    await page.goto("/");
    await command(page, "document.import", { text: JSON.stringify(createEmptyDocument("Native shell test")) });
    const wall = await command<{ id: string }>(page, "cad.parameter.add", { name: "wall", expression: "1mm" });
    const sketch = await command<{ id: string }>(page, "cad.sketch.create", { name: "Box outline", plane: "XZ" });
    await command(page, "cad.sketch.rectangle", { sketchId: sketch.id, width: "20mm", height: "10mm" });
    const source = await command<{ id: string; bodyId: string }>(page, "cad.feature.extrude", { sketchId: sketch.id, distance: "8mm" });
    const original = await native(page, source.bodyId, 1600);
    await command(page, "selection.set", { kind: "body", id: source.bodyId });
    await command(page, "feature.shell");
    const dialog = page.getByRole("dialog", { name: "Shell", exact: true });
    const apply = dialog.getByRole("button", { name: "Apply Shell" });
    await dialog.getByRole("textbox", { name: "Wall thickness" }).fill("5mm");
    await expect(dialog.getByRole("alert")).toContainText("collapses the cavity");
    await expect(apply).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel Shell" }).click();
    expect((await native(page, source.bodyId, 1600)).history.undo).toBe(original.history.undo);
    await command(page, "feature.shell");
    await dialog.getByRole("combobox", { name: "Opening face" }).selectOption("startCap");
    await dialog.getByRole("textbox", { name: "Wall thickness" }).fill("wall");
    await expect(dialog.getByRole("status")).toHaveText("Native Shell preview ready");
    await apply.click();
    const applied = await native(page, source.bodyId, 592);
    expect(applied.history.undo).toBe(original.history.undo + 1);
    const shell = applied.document.features.find(feature => feature.type === "shell")!;
    expect(shell).toMatchObject({ sourceFeatureId: source.id, opening: "startCap", wallThickness: { expression: "wall", parameterRefs: { wall: wall.id } } });
    await command(page, "feature.edit");
    const editing = page.getByRole("dialog", { name: "Edit Shell", exact: true });
    await editing.getByRole("combobox", { name: "Opening face" }).selectOption("endCap");
    await expect(editing.getByRole("status")).toHaveText("Native Shell preview ready");
    await editing.getByRole("button", { name: "Apply Shell" }).click();
    expect((await native(page, source.bodyId, 592)).document.features.find(feature => feature.id === shell.id)).toMatchObject({ opening: "endCap" });
    await command(page, "history.undo");
    expect((await native(page, source.bodyId, 592)).document.features.find(feature => feature.id === shell.id)).toMatchObject({ opening: "startCap" });
    await command(page, "history.undo");
    await native(page, source.bodyId, 1600);

    const plan = await command<{ planId: string }>(page, "plan.preview", { label: "Shell from a stable cap", steps: [
      { command: "cad.feature.shell", arguments: { sourceFeatureId: source.id, opening: "endCap", wallThickness: "wall" } },
    ] });
    expect((await native(page, source.bodyId, 1600)).history.undo).toBe(original.history.undo);
    await command(page, "plan.apply", { planId: plan.planId });
    expect((await native(page, source.bodyId, 592)).history.undo).toBe(original.history.undo + 1);
    await command(page, "cad.parameter.update", { parameterId: wall.id, expression: "2mm" });
    const edited = await native(page, source.bodyId, 1024);

    const saving = page.waitForEvent("download");
    await command(page, "file.saveProject");
    const file = info.outputPath("shelled-box.pcaddoc");
    await (await saving).saveAs(file);
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await expect.poll(async () => (await command<Snapshot>(page, "runtime.snapshot")).session).toBeGreaterThan(edited.session);
    await native(page, source.bodyId, 1024);
    const exporting = page.waitForEvent("download");
    await command(page, "file.exportStl");
    const stl = info.outputPath("shelled-box.stl");
    await (await exporting).saveAs(stl);
    expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(1024, 5);
  });
}
