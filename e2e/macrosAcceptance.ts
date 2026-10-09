import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { JsonValue } from "../src/commands/registry";
interface Snapshot {
  document: { parameters: { thickness: { expression: string } } };
  history: { undo: number };
  rebuild: { native: boolean; bodies: { assertions: { valid: boolean; solidCount: number; volume: number }; bounds: { min: number[]; max: number[] } }[] };
}
async function command<T = unknown>(page: Page, command: string, args: JsonValue = {}): Promise<T> {
  const response = await page.evaluate(async (text: string) => {
    const request = JSON.parse(text);
    const discovery = await window.plaincadCommands.list();
    if (!discovery.ok) throw new Error(discovery.error.message);
    const session = (discovery.value as { session: number }).session;
    return window.plaincadCommands.execute({ ...request, session });
  }, JSON.stringify({ command, arguments: args }));
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return (response as { value: unknown }).value as T;
}

export function macrosAcceptance() {
test("records parameter intent and replays a typed native preview as one reversible edit", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.plaincadCommands));
  const text = await readFile("src/persistence/fixtures/schema-v13.pcaddoc", "utf8");
  await command(page, "document.import", { text });
  await command<Snapshot>(page, "runtime.awaitNative");
  await command(page, "automation.open");
  await page.getByRole("button", { name: "Record workflow", exact: true }).click();
  await expect(page.getByText("Recording · 0 modeling steps")).toBeVisible();
  await command(page, "cad.parameter.update", { parameterId: "thickness-parameter", expression: "8mm" });
  const accepted = await command<Snapshot>(page, "runtime.awaitNative");
  expect(accepted.rebuild.native).toBe(true);
  expect(accepted.rebuild.bodies[0].assertions.volume).toBeCloseTo(1600 - 8 * Math.PI, 6);
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.getByLabel("Workflow name", { exact: true }).fill("Thickness workflow");
  await page.getByText("Make an input adjustable", { exact: true }).click();
  const argument = page.getByRole("combobox", { name: "Argument", exact: true });
  const expressionLabel = "Step 1 · expression = 8mm";
  const selectedValues = await argument.selectOption({ label: expressionLabel });
  expect(selectedValues).toHaveLength(1);
  await expect(argument).toHaveValue(selectedValues[0]);
  expect(await argument.evaluate((select: HTMLSelectElement) => select.selectedOptions[0].label)).toBe(expressionLabel);
  await page.getByLabel("Input name", { exact: true }).fill("newThickness");
  await page.getByRole("button", { name: "Add adjustable input", exact: true }).click();
  await page.getByRole("button", { name: "Save recorded workflow", exact: true }).click();
  const library = await command<{ saved: { id: string }[] }>(page, "macro.list");
  expect(library.saved).toHaveLength(1);
  await page.getByRole("combobox", { name: "Saved workflow", exact: true }).selectOption(library.saved[0].id);
  await page.getByLabel("newThickness", { exact: true }).fill("12mm");
  await page.getByRole("button", { name: "Preview workflow", exact: true }).click();
  await expect.poll(async () => (await command<{ status: string }>(page, "plan.status")).status, { timeout: 60000 }).toBe("ready");
  const preview = await command<{ planId: string; status: string }>(page, "plan.status");
  const beforeApply = await command<Snapshot>(page, "runtime.snapshot");
  expect(beforeApply.document.parameters.thickness.expression).toBe("8mm");
  expect(beforeApply.history.undo).toBe(accepted.history.undo);
  await command(page, "plan.apply", { planId: preview.planId });
  const applied = await command<Snapshot>(page, "runtime.awaitNative");
  expect(applied.history.undo).toBe(accepted.history.undo + 1);
  expect(applied.rebuild.native).toBe(true);
  expect(applied.rebuild.bodies[0].assertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(applied.rebuild.bodies[0].assertions.volume).toBeCloseTo(2400 - 12 * Math.PI, 6);
  expect(applied.rebuild.bodies[0].bounds.min[2]).toBeCloseTo(0, 6);
  expect(applied.rebuild.bodies[0].bounds.max[2]).toBeCloseTo(12, 6);
  await command(page, "history.undo");
  const undone = await command<Snapshot>(page, "runtime.awaitNative");
  expect(undone.document.parameters.thickness.expression).toBe("8mm");
  expect(undone.rebuild.bodies[0].assertions.volume).toBeCloseTo(1600 - 8 * Math.PI, 6);
});

}
