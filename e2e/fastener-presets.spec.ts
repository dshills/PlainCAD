import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { CommandRequest, CommandResponse } from "../src/commands/registry";
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
