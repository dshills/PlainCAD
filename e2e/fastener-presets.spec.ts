import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { CommandRequest, CommandResponse } from "../src/commands/registry";
import { stlSignedVolume } from "./aiAcceptanceHelpers";
import { openNewPartMenu } from "./newPartWorkflow";

type Snapshot = {
  document: CadDocument;
  history: { undo: number };
  rebuild: { status: string; native: boolean; bodies: Array<{ assertions: { volume: number; solidCount: number }; bounds: { min: number[]; max: number[] } }> };
};

async function command(page: Page, request: Omit<CommandRequest, "session">) {
  const response = await page.evaluate(async (serialized) => {
    const input = JSON.parse(serialized);
    const listed = await window.plaincadCommands.list();
    if (!listed.ok) throw new Error(listed.error.message);
    return await window.plaincadCommands.execute({ ...input, session: (listed.value as { session: number }).session }) as unknown;
  }, JSON.stringify(request)) as CommandResponse;
  if (!response.ok) throw new Error(response.error.message);
  return response.value;
}

const snapshot = async (page: Page) => await command(page, { command: "runtime.snapshot" }) as unknown as Snapshot;
async function palette(page: Page, name: string) {
  await page.getByRole("button", { name: "All tools" }).click();
  const dialog = page.getByRole("dialog", { name: "Command Palette" });
  await dialog.getByLabel("Filter commands").fill(name);
  await dialog.getByRole("button", { name: new RegExp("^" + name, "i") }).click();
}

test.use({ storageState: { cookies: [], origins: [] } });
test("socket-head blanks have native envelopes and a real hex socket in metric and inch units", async ({ page }) => {
  await page.goto("/");
  await palette(page, "Insert fastener");
  const dialog = page.getByRole("dialog", { name: "Insert fastener" });
  await dialog.getByLabel("Fastener size").selectOption("m3");
  await dialog.getByLabel("Length below head").fill("12mm");
  await dialog.getByRole("button", { name: "Preview fastener" }).click();
  await expect(await snapshot(page)).toMatchObject({ history: { undo: 0 }, document: { features: [] } });
  await page.getByRole("button", { name: "Apply command plan" }).click();
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.history.undo).toBe(1);
    expect(state.rebuild.native).toBe(true);
    const [body] = state.rebuild.bodies;
    expect(body.assertions.solidCount).toBe(1);
    expect(body.assertions.volume).toBeCloseTo(Math.PI * (1.5 ** 2 * 12 + 2.75 ** 2 * 3) - Math.sqrt(3) / 2 * 2.5 ** 2 * 1.5, 5);
    expect(body.bounds.min[2]).toBeCloseTo(-12, 3);
    expect(body.bounds.max[2]).toBeCloseTo(3, 3);
  }).toPass();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).document.features.length).toBe(0);
  await expect.poll(async () => (await snapshot(page)).rebuild.status).toBe("succeeded");
  const plan = await command(page, { command: "plan.preview", arguments: { steps: [
    { command: "cad.hardware.fastener", arguments: { size: "4-40", length: ".5in" } },
  ] } }) as { planId: string };
  await command(page, { command: "plan.apply", arguments: { planId: plan.planId } });
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.rebuild.native).toBe(true);
    expect(state.rebuild.bodies[0].bounds.min[2]).toBeCloseTo(-12.7, 3);
    expect(state.rebuild.bodies[0].bounds.max[2]).toBeCloseTo(2.8448, 3);
  }).toPass();
});

test("guided holes save preset intent and place a verified tap-drill callout on the drawing", async ({ page }) => {
  await page.goto("/");
  await openNewPartMenu(page);
  await page.locator("summary").filter({ hasText: "Start from example" }).click();
  await page.getByRole("button", { name: "Load parametric box template" }).click();
  await page.getByRole("button", { name: "Place holes on face" }).click();
  await page.getByRole("button", { name: "Hole on Box Extrude — end cap", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Place holes on face" });
  await dialog.getByLabel("Hole size preset").selectOption("4-40");
  await expect(dialog.getByLabel("Guided hole diameter")).toHaveValue("0.136in");
  await dialog.getByLabel("Hole preset type").selectOption("tapDrill");
  await expect(dialog.getByLabel("Guided hole diameter")).toHaveValue("0.089in");
  await dialog.getByRole("button", { name: "Add hole center" }).click();
  await dialog.getByRole("button", { name: "Apply face holes" }).click();
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.document.features.at(-1)).toMatchObject({ preset: { size: "4-40", kind: "tapDrill" } });
    expect(state.rebuild.bodies[0].assertions.volume).toBeCloseTo(80000 - 20 * Math.PI * (0.089 * 25.4 / 2) ** 2, 5);
  }).toPass();
  await palette(page, "Shop drawing");
  const [drawing] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download drawing SVG" }).click(),
  ]);
  const path = await drawing.path();
  expect(path).toBeTruthy();
  const svg = await readFile(path!, "utf8");
  expect(svg).toContain("#4-40 UNC tap drill");
  expect(svg).toContain("Ø2.261 mm");
});

test("modeled Thread previews and persists native external and internal grooves", async ({ page }) => {
  await page.goto("/");
  await palette(page, "Insert fastener");
  await page.getByRole("button", { name: "Preview fastener" }).click();
  await page.getByRole("button", { name: "Apply command plan" }).click();
  await expect.poll(async () => (await snapshot(page)).rebuild.native).toBe(true);
  const blank = await snapshot(page), shaft = blank.rebuild.bodies[0];
  await command(page, { command: "selection.set", arguments: { kind: "body", id: `body:${blank.document.features[0].id}` } });
  await palette(page, "Modeled Thread");
  let dialog = page.getByRole("dialog", { name: "Modeled Thread" });
  await dialog.getByLabel("Handedness").selectOption("left");
  await dialog.getByRole("button", { name: "Preview thread" }).click();
  await page.getByRole("button", { name: "Apply command plan" }).click();
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.document.features.at(-1)).toMatchObject({ type: "thread", hand: "left", side: "external", size: "m3" });
    expect(state.rebuild.bodies[0].assertions.volume).toBeCloseTo(shaft.assertions.volume - 5.002, 2);
  }).toPass();

  const threaded = await snapshot(page), thread = threaded.document.features.at(-1)!;
  await command(page, { command: "selection.set", arguments: { kind: "feature", id: thread.id } });
  await palette(page, "Edit Selected Feature");
  dialog = page.getByRole("dialog", { name: "Edit Thread" });
  await dialog.getByLabel("Thread length").fill("2mm");
  await dialog.getByRole("button", { name: "Preview thread" }).click();
  await page.getByRole("button", { name: "Apply command plan" }).click();
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.document.features.at(-1)).toMatchObject({ id: thread.id, threadLength: { expression: "2mm" } });
    expect(state.rebuild.bodies[0].assertions.volume).toBeCloseTo(shaft.assertions.volume - (5.002 - 4.160 / 3), 2);
  }).toPass();

  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles((await saved.path())!);
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.history.undo).toBe(0);
    expect(state.document.features.at(-1)).toMatchObject({ id: thread.id, type: "thread" });
    expect(state.rebuild.bodies[0].assertions.volume).toBeCloseTo(shaft.assertions.volume - (5.002 - 4.160 / 3), 2);
  }).toPass();

  const [stl] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    command(page, { command: "file.exportStl", arguments: {} }),
  ]);
  const bytes = await readFile((await stl.path())!);
  expect(bytes.readUInt32LE(80)).toBeGreaterThan(100);
  expect(Math.abs(stlSignedVolume(bytes) - (await snapshot(page)).rebuild.bodies[0].assertions.volume)).toBeLessThan(2);

  const nut = await command(page, { command: "plan.preview", arguments: { label: "Test nut blank and thread", steps: [
    { command: "cad.component.create", arguments: { name: "Nut blank", as: "nut" } },
    { command: "cad.component.place", arguments: { componentId: "$nut", translation: [10, 0, 0], rotation: [0, 0, 0] } },
    { command: "cad.sketch.create", arguments: { name: "Nut bore", componentId: "$nut", plane: "XY", as: "section" } },
    { command: "cad.sketch.circle", arguments: { sketchId: "$section", center: { x: "0mm", y: "0mm" }, radius: "3mm" } },
    { command: "cad.sketch.circle", arguments: { sketchId: "$section", center: { x: "0mm", y: "0mm" }, radius: "1.25mm" } },
    { command: "cad.feature.extrude", arguments: { sketchId: "$section", distance: "4mm", as: "stock" } },
    { command: "cad.feature.thread", arguments: { targetBodyId: "$stock.body", size: "m3", side: "internal", hand: "right", threadLength: "3mm" } },
  ] } }) as { planId: string };
  await command(page, { command: "plan.apply", arguments: { planId: nut.planId } });
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.rebuild.bodies).toHaveLength(2);
    expect(state.rebuild.bodies[1].assertions.volume).toBeCloseTo(Math.PI * (9 - 1.25 ** 2) * 4 - 3.372, 2);
  }).toPass();
});
