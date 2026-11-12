import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createEmptyDocument } from "../src/cad/document/CadDocument";
import { stableFaceId } from "../src/cad/sketch/planes";
import { applyCadCommand, type CadCommandCall } from "../src/commands/cadCommandOperations";
import type { CommandResponse, JsonValue } from "../src/commands/registry";
import { stlSignedVolume } from "./aiAcceptanceHelpers";

function fixture() {
  let document = createEmptyDocument("Face command plate");
  const run = (call: CadCommandCall) => {
    const applied = applyCadCommand(document, call);
    document = applied.document;
    return applied.result;
  };
  const sketch = run({ command: "cad.sketch.create", arguments: { name: "Plate outline", plane: "XY" } }).id!;
  run({ command: "cad.sketch.rectangle", arguments: { sketchId: sketch, width: "40mm", height: "30mm" } });
  const base = run({ command: "cad.feature.extrude", arguments: { sketchId: sketch, distance: "10mm", name: "Plate" } });
  const faceId = stableFaceId(base.id!, "endCap");
  const steps: CadCommandCall[] = [
    { command: "cad.sketch.createOnFace", arguments: { featureId: base.id!, stableFaceId: faceId, name: "Pocket outline", as: "face" } },
    { command: "cad.sketch.rectangle", arguments: { sketchId: "$face", origin: { x: "10mm", y: "10mm" }, width: "10mm", height: "10mm", as: "region" } },
    { command: "cad.feature.pocket", arguments: { sketchId: "$face", profileId: "$region.profile0", targetBodyId: base.bodyId!, distance: "2mm", as: "pocket" } },
    { command: "cad.feature.update", arguments: { featureId: "$pocket", distance: "3mm" } },
  ];
  return { text: JSON.stringify(document), steps, bodyId: base.bodyId!, featureId: base.id!, faceId };
}
interface NativeSnapshot {
  session: number;
  history: { undo: number };
  rebuild: { native: boolean; bodies: { id: string; assertions: { valid: boolean; solidCount: number; volume: number }; bounds: { min: number[]; max: number[] } }[] };
}
function value(response: CommandResponse) {
  expect(response.ok, JSON.stringify(response.ok ? {} : response)).toBe(true);
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}
async function call(page: Page, command: string, args: JsonValue = {}) {
  return page.evaluate(async (text) => {
    const { command, args } = JSON.parse(text) as { command: string; args: JsonValue };
    const discovered = await window.plaincadCommands.list();
    if (!discovered.ok) throw new Error(discovered.error.message);
    return window.plaincadCommands.execute({ command, arguments: args, session: (discovered.value as { session: number }).session });
  }, JSON.stringify({ command, args }));
}
function assertGeometry(response: CommandResponse, bodyId: string, volume: number, undo: number) {
  const snapshot = value(response) as unknown as NativeSnapshot;
  expect(snapshot.history.undo).toBe(undo);
  expect(snapshot.rebuild.native).toBe(true);
  expect(snapshot.rebuild.bodies).toHaveLength(1);
  const body = snapshot.rebuild.bodies[0];
  expect(body).toMatchObject({ id: bodyId, assertions: { valid: true, solidCount: 1 } });
  [0, 0, 0].forEach((n, axis) => expect(body.bounds.min[axis]).toBeCloseTo(n, 6));
  [40, 30, 10].forEach((n, axis) => expect(body.bounds.max[axis]).toBeCloseTo(n, 6));
  expect(body.assertions.volume).toBeCloseTo(volume, 4);
}
export function facePocketCommandsAcceptance() {
  test("CLI creates a native face pocket, edits its depth and undoes the whole plan", async ({ baseURL }, info) => {
    test.setTimeout(120000);
    const model = fixture(), project = info.outputPath("plate.pcaddoc"), script = info.outputPath("pocket.json");
    await writeFile(project, model.text);
    await writeFile(script, JSON.stringify([
      { command: "runtime.awaitNative" },
      { command: "plan.preview", arguments: { label: "Face pocket", steps: model.steps } },
      { command: "runtime.waitForCommand", arguments: { label: "Apply command plan", property: "onClick" } },
      { label: "Apply command plan", property: "onClick" },
      { command: "runtime.awaitNative" },
      { command: "file.exportStl", awaitArtifact: true },
      { command: "history.undo" }, { command: "runtime.awaitNative" },
    ]));
    const cli = await promisify(execFile)(process.execPath, ["scripts/plaincad-cli.mjs", "--url", baseURL!, "--project", project, "--script", script, "--output", info.outputPath("downloads")], { timeout: 105000, maxBuffer: 8 * 1024 * 1024 });
    const responses = cli.stdout.trim().split("\n").map(line => JSON.parse(line) as CommandResponse & { artifacts: string[] });
    const native = responses.filter(response => response.command === "runtime.awaitNative");
    expect(native).toHaveLength(3);
    assertGeometry(native[0], model.bodyId, 12000, 0);
    assertGeometry(native[1], model.bodyId, 11700, 1);
    assertGeometry(native[2], model.bodyId, 12000, 0);
    const path = responses.find(response => response.command === "file.exportStl")?.artifacts[0];
    expect(path).toBeTruthy();
    expect(stlSignedVolume(await readFile(path!))).toBeCloseTo(11700, 3);
  });

  test("AI uses current native face IDs for an explicit pocket and a one-step Undo", async ({ page }) => {
    const model = fixture();
    await page.route("**/api/ai/status", route => route.fulfill({ json: { providers: [
      { id: "anthropic", label: "Anthropic", available: true, model: "test-model" },
      { id: "openai", label: "OpenAI", available: true, model: "test-model" },
      { id: "google", label: "Google", available: true, model: "test-model" },
    ] } }));
    let offeredFaces: unknown;
    await page.route("**/api/ai/commands", route => {
      offeredFaces = route.request().postDataJSON().commandContext.faces;
      return route.fulfill({ json: { proposal: { kind: "plan", label: "Face pocket", summary: "Cut the rectangle 3 mm inward.", warnings: [], steps: model.steps } } });
    });
    await page.goto("/");
    value(await call(page, "document.import", { text: model.text }));
    assertGeometry(await call(page, "runtime.awaitNative"), model.bodyId, 12000, 0);
    const lost = await call(page, "plan.preview", { steps: [{ command: "cad.sketch.createOnFace", arguments: {
      name: "Lost face", featureId: model.featureId, stableFaceId: `${model.faceId}:lost`,
    } }] });
    expect(lost).toMatchObject({ ok: false, error: { message: expect.stringMatching(/face.*lost|face.*no longer exists/i) } });
    value(await call(page, "ai.toggle"));
    await page.getByRole("button", { name: "Command agent", exact: true }).click();
    const panel = page.getByLabel("AI command agent", { exact: true });
    await expect(panel.getByLabel("Command agent model")).toHaveValue("test-model");
    await panel.getByLabel("Describe command agent changes").fill("Cut a 10 mm square pocket 2 mm deep in the end cap, then set depth to 3 mm.");
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Generate command preview" }).click();
    const apply = page.getByLabel("Command plan preview", { exact: true }).getByRole("button", { name: "Apply command plan", exact: true });
    await expect(apply).toBeEnabled({ timeout: 60000 });
    expect(offeredFaces).toEqual(expect.arrayContaining([expect.objectContaining({ id: model.faceId, bodyId: model.bodyId, featureId: model.featureId })]));
    assertGeometry(await call(page, "runtime.snapshot"), model.bodyId, 12000, 0);
    await apply.click();
    assertGeometry(await call(page, "runtime.awaitNative"), model.bodyId, 11700, 1);
    await page.getByRole("button", { name: "Undo latest AI change", exact: true }).click();
    assertGeometry(await call(page, "runtime.awaitNative"), model.bodyId, 12000, 0);
  });

  test("semantic Through All and To Face use explicit native cut targets", async ({ page }) => {
    const model = fixture();
    await page.goto("/");
    for (const type of ["throughAll", "toFace"] as const) {
      value(await call(page, "document.import", { text: model.text }));
      await call(page, "runtime.awaitNative").then(value);
      const preview = value(await call(page, "plan.preview", { steps: [
        { command: "cad.sketch.create", arguments: { plane: "XY", name: "Cut outline", as: "outline" } },
        { command: "cad.sketch.rectangle", arguments: { sketchId: "$outline", origin: { x: "10mm", y: "10mm" }, width: "10mm", height: "10mm" } },
        { command: "cad.feature.extrude", arguments: { sketchId: "$outline", operation: "cut", targetBodyIds: [model.bodyId],
          termination: type === "throughAll" ? { type } : { type, featureId: model.featureId, stableFaceId: model.faceId } } },
      ] })) as { planId: string };
      value(await call(page, "plan.apply", { planId: preview.planId }));
      assertGeometry(await call(page, "runtime.awaitNative"), model.bodyId, 11000, 1);
    }
  });
}
