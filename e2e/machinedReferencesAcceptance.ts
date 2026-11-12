import { expect, type Page, type TestInfo } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";
import type { GeometryAssertions } from "../src/cad/kernel/KernelAdapter";
import { expectedVolume, machinedReferenceFixture, pocketFloorRef, rimId, stockBodyId } from "../src/tests/fixtures/machinedReferences";

async function command(page: Page, commandId: string, args: Record<string, unknown> = {}) {
  const response = await page.evaluate(async ({ commandId, args }) => {
    const current = await window.plaincadCommands.execute({ command: "runtime.snapshot" });
    if (!current.ok) return current;
    return window.plaincadCommands.execute({ command: commandId, arguments: args, session: (current.value as { session: number }).session });
  }, { commandId, args });
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}

async function native(page: Page, expected: number) {
  const snapshot = await command(page, "runtime.awaitNative") as unknown as {
    session: number; document: CadDocument; rebuild: { native: boolean; bodies: { id: string; assertions: GeometryAssertions }[] };
  };
  expect(snapshot.rebuild.native).toBe(true);
  expect(snapshot.rebuild.bodies).toHaveLength(1);
  const [body] = snapshot.rebuild.bodies;
  expect(body).toMatchObject({ id: stockBodyId, assertions: { valid: true, solidCount: 1 } });
  expect(body.assertions.volume).toBeCloseTo(expected, 5);
  return snapshot;
}

async function clickSketch(page: Page, x: number, y: number) {
  const canvas = page.getByRole("group", { name: "Sketch drawing canvas", exact: true });
  const box = await canvas.boundingBox(), viewBox = await canvas.getAttribute("viewBox");
  if (!box || !viewBox) throw new Error("Sketch canvas is unavailable.");
  const [minX, minY, width, height] = viewBox.split(/[\s,]+/).map(Number);
  await page.mouse.click(box.x + (x - minX) / width * box.width, box.y + (-y - minY) / height * box.height);
}

async function measureMachinedGeometry(page: Page, depth: number, diameter: number) {
  const panel = page.getByRole("region", { name: "Measurements" });
  await panel.getByRole("button", { name: "Pick in model", exact: true }).click();
  await panel.getByText("Choose model geometry by name", { exact: true }).click();
  const target = panel.getByRole("combobox", { name: "Model measurement target" });
  await target.selectOption(`edge:${rimId}`);
  await expect(panel.getByLabel("Model measured diameter")).toHaveText(`${diameter.toFixed(4)} mm`);
  await expect(panel.getByLabel("Model measured radius")).toHaveText(`${(diameter / 2).toFixed(4)} mm`);
  await panel.getByRole("button", { name: "Clear measurements" }).click();
  await target.selectOption("face:extrude:machined-stock:endCap");
  await target.selectOption(`face:${pocketFloorRef.stableFaceId}`);
  await expect(panel.getByLabel("Model measured distance")).toHaveText(`${depth.toFixed(4)} mm`);
  await panel.getByRole("button", { name: "Done measuring", exact: true }).click();
}

export async function machinedReferencesAcceptance(page: Page, info: TestInfo) {
  const errors: string[] = [], violations: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("recordMachinedCspViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => {
    (window as unknown as { recordMachinedCspViolation: (directive: string) => void }).recordMachinedCspViolation(event.violatedDirective);
  }));
  const { document: source } = machinedReferenceFixture();
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.plaincadCommands));
  await command(page, "document.import", { text: JSON.stringify(source) });
  const initial = await native(page, expectedVolume());
  await measureMachinedGeometry(page, 6, 4);

  await command(page, "sketch.facePocket");
  const picker = page.getByRole("region", { name: "Draw on a face" });
  await picker.getByRole("button", { name: "Blind pocket — pocket floor", exact: true }).click();
  await picker.getByRole("button", { name: "Draw here", exact: true }).click();
  const sketch = Object.values((await native(page, expectedVolume())).document.sketches).find(item => !initial.document.sketches[item.id])!;
  expect(sketch.plane).toEqual(pocketFloorRef);
  await page.getByRole("button", { name: "Draw tool: rectangle", exact: true }).click();
  await clickSketch(page, 17, 15);
  await clickSketch(page, 20, 18);
  await native(page, expectedVolume());
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await expect(page.getByRole("group", { name: "Sketch drawing canvas", exact: true })).toHaveCount(0);

  // Reassign the sketch, then repair it back to the actual proved floor via the inspector.
  await command(page, "selection.set", { kind: "sketch", id: sketch.id });
  const type = page.getByRole("combobox", { name: "Sketch plane type", exact: true });
  const reference = page.getByRole("combobox", { name: "Sketch plane reference", exact: true });
  const applyPlane = page.getByRole("button", { name: "Apply sketch plane", exact: true });
  await type.selectOption("origin");
  await applyPlane.click();
  expect((await native(page, expectedVolume())).document.sketches[sketch.id].plane).toEqual({ type: "origin", plane: "XY" });
  await type.selectOption("face");
  await reference.selectOption(pocketFloorRef.stableFaceId);
  await applyPlane.click();
  expect((await native(page, expectedVolume())).document.sketches[sketch.id].plane).toEqual(pocketFloorRef);

  await command(page, "parameter.update", { parameterId: "pocket-depth-param", patch: { expression: "8mm" } });
  await native(page, expectedVolume(8, 4));
  await command(page, "parameter.update", { parameterId: "bore-size-param", patch: { expression: "6mm" } });
  const edited = await native(page, expectedVolume(8, 6));
  const saving = page.waitForEvent("download");
  await command(page, "file.saveProject");
  const path = info.outputPath("machined-references.pcaddoc");
  await (await saving).saveAs(path);
  await page.locator('input[type="file"]').first().setInputFiles(path);
  await expect.poll(async () => (await command(page, "runtime.snapshot") as { session: number }).session).toBeGreaterThan(edited.session);
  expect((await native(page, expectedVolume(8, 6))).document.sketches[sketch.id].plane).toEqual(pocketFloorRef);
  await measureMachinedGeometry(page, 8, 6);
  // The same floor ID is scriptable, but its native target is still the original stock body.
  const preview = await command(page, "plan.preview", { steps: [
    { command: "cad.sketch.createOnFace", arguments: { name: "Nested outline", featureId: pocketFloorRef.featureId, stableFaceId: pocketFloorRef.stableFaceId, as: "floor" } },
    { command: "cad.sketch.rectangle", arguments: { sketchId: "$floor", origin: { x: "17mm", y: "15mm" }, width: "3mm", height: "3mm" } },
    { command: "cad.feature.pocket", arguments: { sketchId: "$floor", targetBodyId: stockBodyId, distance: "1mm" } },
  ] }) as { planId: string };
  await native(page, expectedVolume(8, 6));
  await command(page, "plan.apply", { planId: preview.planId });
  await native(page, expectedVolume(8, 6) - 9);
  await expect(command(page, "cad.sketch.createOnFace", {
    name: "Lost original floor", featureId: pocketFloorRef.featureId, stableFaceId: pocketFloorRef.stableFaceId,
  })).rejects.toThrow(/native face reference was lost/i);
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
}
