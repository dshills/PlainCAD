import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createEmptyDocument } from "../src/cad/document/CadDocument";
import type { JsonValue } from "../src/commands/registry";
interface Snapshot {
  document: { id: string; features: unknown[]; parameters: { thickness: { expression: string } } };
  session: number;
  history: { undo: number };
  rebuild: { status: string; native: boolean; bodies: { id: string; assertions: { valid: boolean; solidCount: number; volume: number }; bounds: { min: number[]; max: number[] } }[] };
}
interface Plan { planId: string; status: string; results: { id?: string; bodyId?: string }[]; nativeProof: { bodyId: string; valid: boolean; solidCount: number; volume: number }[] }
async function command<T = unknown>(page: Page, command: string, args: JsonValue = {}): Promise<T> {
  const response = await page.evaluate(async (text: string) => {
    const request = JSON.parse(text), discovery = await window.plaincadCommands.list();
    if (!discovery.ok) throw new Error(discovery.error.message);
    return window.plaincadCommands.execute({ ...request, session: (discovery.value as { session: number }).session });
  }, JSON.stringify({ command, arguments: args }));
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return (response as { value: unknown }).value as T;
}
async function waitAvailable(page: Page) {
  await expect.poll(async () => {
    const discovery = await command<{ commands: { id: string; bindings: { available: boolean }[] }[] }>(page, "commands.list");
    return discovery.commands.find(item => item.id === "plan.preview")?.bindings.some(binding => binding.available);
  }, { timeout: 30000 }).toBe(true);
}
export function commandPlansAcceptance(options: { nativeReplacement?: boolean } = {}) {
test("stages a non-template scoped cut on the main canvas and accepts it with one Undo", async ({ page }) => {
  await page.goto("/"); await page.waitForFunction(() => Boolean(window.plaincadCommands));
  const original = JSON.stringify(createEmptyDocument("Command plan native plate"));
  await command(page, "document.import", { text: original });
  await waitAvailable(page);
  const accepted = await command<Snapshot>(page, "runtime.snapshot");
  const staged = await command<Plan>(page, "plan.preview", { label: "Offset plate with bore", steps: [
    { command: "cad.component.create", arguments: { name: "Plate", as: "plate" } },
    { command: "cad.sketch.create", arguments: { name: "Outline", componentId: { $result: { step: 0, path: ["id"] } }, plane: "XY", as: "outline" } },
    { command: "cad.sketch.rectangle", arguments: { sketchId: "$outline", origin: { x: "2mm", y: "3mm" }, width: "30mm", height: "18mm", as: "rectangle" } },
    { command: "cad.feature.extrude", arguments: { sketchId: "$outline", profileId: "$rectangle.profile0", distance: "7mm", as: "base" } },
    { command: "cad.sketch.create", arguments: { name: "Bore center", componentId: "$plate", plane: "XY", as: "drill" } },
    { command: "cad.sketch.point", arguments: { sketchId: "$drill", point: { x: "14mm", y: "12mm" }, as: "center" } },
    { command: "cad.feature.hole", arguments: { sketchId: "$drill", centerPointIds: ["$center"], targetBodyIds: [{ $result: { step: 3, path: ["bodyId"] } }], diameter: "6mm", throughAll: true } },
  ] });
  expect(staged.status).toBe("ready");
  await expect(page.getByRole("button", { name: "Fit model in viewport" })).toBeEnabled();
  await page.getByRole("button", { name: "Fit model in viewport" }).click();
  expect(staged.nativeProof).toHaveLength(1);
  expect(staged.nativeProof[0]).toMatchObject({ valid: true, solidCount: 1 });
  expect(staged.nativeProof[0].volume).toBeCloseTo(3780 - 63 * Math.PI, 5);
  await expect(page.getByRole("region", { name: "Command plan preview" })).toBeVisible();
  const beforeApply = await command<Snapshot>(page, "runtime.snapshot");
  expect(beforeApply.document).toEqual(accepted.document);
  expect(beforeApply.history.undo).toBe(accepted.history.undo);
  expect(beforeApply.rebuild.bodies).toEqual(accepted.rebuild.bodies);
  await page.getByRole("button", { name: "Apply command plan", exact: true }).click();
  const applied = await command<Snapshot>(page, "runtime.awaitNative");
  expect(applied.history.undo).toBe(accepted.history.undo + 1);
  expect(applied.rebuild.native).toBe(true);
  expect(applied.rebuild.bodies).toHaveLength(1);
  expect(applied.rebuild.bodies[0].assertions.volume).toBeCloseTo(3780 - 63 * Math.PI, 5);
  [2, 3, 0].forEach((value, index) => expect(applied.rebuild.bodies[0].bounds.min[index]).toBeCloseTo(value, 5));
  [32, 21, 7].forEach((value, index) => expect(applied.rebuild.bodies[0].bounds.max[index]).toBeCloseTo(value, 5));
  await command(page, "history.undo");
  await expect.poll(async () => (await command<Snapshot>(page, "runtime.snapshot")).document.features.length).toBe(0);
  expect((await command<Snapshot>(page, "runtime.snapshot")).history.undo).toBe(accepted.history.undo);
});
test("cancels native parameter proposals and rejects editing from replaced sessions", async ({ page }) => {
  await page.goto("/"); await page.waitForFunction(() => Boolean(window.plaincadCommands));
  const text = await readFile("src/persistence/fixtures/schema-v13.pcaddoc", "utf8");
  await command(page, "document.import", { text });
  const accepted = await command<Snapshot>(page, "runtime.awaitNative");
  const plan = { label: "Thicker plate", steps: [{ command: "cad.parameter.update", arguments: { parameterId: "thickness-parameter", expression: "9mm" } }] };
  const first = await command<Plan>(page, "plan.preview", plan);
  expect(first.nativeProof[0].volume).toBeCloseTo(1800 - 9 * Math.PI, 5);
  await page.getByRole("button", { name: "Cancel command plan", exact: true }).click();
  const cancelled = await command<Snapshot>(page, "runtime.snapshot");
  expect(cancelled.document.parameters.thickness.expression).toBe("5");
  expect(cancelled.history.undo).toBe(accepted.history.undo);
  expect(cancelled.rebuild.bodies[0].assertions.volume).toBeCloseTo(1000 - 5 * Math.PI, 5);
  await command(page, "document.import", { text });
  await command(page, "runtime.awaitNative");
  const staleEdit = await page.evaluate(async (oldSession: number) => window.plaincadCommands.execute({
    command: "cad.parameter.update", session: oldSession,
    arguments: { parameterId: "thickness-parameter", expression: "9mm" },
  }), accepted.session);
  expect(staleEdit).toMatchObject({ ok: false, error: { code: "stale_session" } });
  expect((await command<Snapshot>(page, "runtime.snapshot")).document.parameters.thickness.expression).toBe("5");
});

if (options.nativeReplacement) test("invalidates an outstanding native proof when its same-ID project is externally replaced", async ({ page }) => {
  await page.goto("/"); await page.waitForFunction(() => Boolean(window.plaincadCommands));
  const text = await readFile("src/persistence/fixtures/schema-v13.pcaddoc", "utf8");
  await command(page, "document.import", { text });
  const accepted = await command<Snapshot>(page, "runtime.awaitNative");
  const proposal = await command<Plan>(page, "plan.preview", {
    label: "Outstanding thicker plate",
    steps: [{ command: "cad.parameter.update", arguments: { parameterId: "thickness-parameter", expression: "9mm" } }],
  });
  expect(proposal.nativeProof[0].volume).toBeCloseTo(1800 - 9 * Math.PI, 5);
  expect((await command<{ status: string }>(page, "plan.status")).status).toBe("ready");
  // Development-only race harness: simulate an external recovery/load replacing
  // the project while a real private native proof is outstanding. UI/API import
  // is intentionally guarded during plans; this is not an automation capability
  // or a production bypass. Parse through the same validated project boundary.
  await page.evaluate(async (projectText: string) => {
    const storePath = "/src/state/useCadStore.ts", codecPath = "/src/persistence/projectCodec.ts";
    const { useCadStore } = await import(storePath), { importProjectText } = await import(codecPath);
    useCadStore.getState().setDocument(importProjectText(projectText));
  }, text);
  expect((await command<{ status: string }>(page, "plan.status")).status).toBe("idle");
  const replacement = await command<Snapshot>(page, "runtime.awaitNative");
  expect(replacement.document.id).toBe(accepted.document.id);
  expect(replacement.session).toBeGreaterThan(accepted.session);
  const failedApply = await page.evaluate(async (planId: string) => {
    const discovery = await window.plaincadCommands.list();
    if (!discovery.ok) throw new Error(discovery.error.message);
    return window.plaincadCommands.execute({ command: "plan.apply", session: (discovery.value as { session: number }).session, arguments: { planId } });
  }, proposal.planId);
  expect(failedApply.ok).toBe(false);
  if (!failedApply.ok) expect(failedApply.error.message).toMatch(/stale|unavailable|preview/i);
  const current = await command<Snapshot>(page, "runtime.snapshot");
  expect(current.document.parameters.thickness.expression).toBe("5");
  expect(current.history.undo).toBe(0);
  expect(current.rebuild.native).toBe(true);
  expect(current.rebuild.bodies[0].assertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(current.rebuild.bodies[0].assertions.volume).toBeCloseTo(1000 - 5 * Math.PI, 5);
  expect(current.rebuild.bodies[0].bounds.min[2]).toBeCloseTo(0, 5);
  expect(current.rebuild.bodies[0].bounds.max[2]).toBeCloseTo(5, 5);
});

}
