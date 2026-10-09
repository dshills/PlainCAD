import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

export async function commandAgentAcceptance(page: Page) {
  let sent = 0;
  await page.route("**/api/ai/status", route => route.fulfill({ json: { providers: [
    { id: "anthropic", label: "Anthropic", available: true, model: "test-model" },
    { id: "openai", label: "OpenAI", available: true, model: "test-model" },
    { id: "google", label: "Google", available: true, model: "test-model" },
  ] } }));
  await page.route("**/api/ai/commands", route => {
    const request = route.request().postDataJSON();
    expect(request.commandContext.document.parameters.thickness.id).toBe("thickness-parameter");
    expect(request.commandContext.native).toBe(true);
    expect(JSON.stringify(request)).not.toContain("API_KEY");
    sent++;
    return route.fulfill({ json: { proposal: sent === 1 ? { kind: "clarification", label: "Choose thickness", summary: "What thickness should the part have?", warnings: [], steps: [] } : { kind: "plan", label: "Thicker housing", summary: "Set shared thickness to 8 mm.", warnings: ["Every feature using thickness will rebuild."], steps: [{ command: "cad.parameter.update", arguments: { parameterId: "thickness-parameter", expression: "8mm" } }] } } });
  });
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.plaincadCommands));
  const text = await readFile("src/persistence/fixtures/schema-v13.pcaddoc", "utf8");
  const call = (command: string, args: unknown = {}) => page.evaluate(async ({ command, args }) => {
    const discovered = await window.plaincadCommands.list();
    if (!discovered.ok) throw new Error(discovered.error.message);
    return window.plaincadCommands.execute({ command, session: (discovered.value as { session: number }).session, arguments: args });
  }, { command, args });
  expect((await call("document.import", { text })).ok).toBe(true);
  expect((await call("runtime.awaitNative")).ok).toBe(true);
  expect((await call("ai.toggle")).ok).toBe(true);
  await page.getByRole("button", { name: "Command agent", exact: true }).click();
  const panel = page.getByLabel("AI command agent", { exact: true });
  await expect(panel.getByLabel("Command agent model")).toHaveValue("test-model");
  await panel.getByLabel("Describe command agent changes").fill("Make this part thicker");
  await expect(panel.getByRole("button", { name: "Generate command preview" })).toBeDisabled();
  expect(sent).toBe(0);
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Generate command preview" }).click();
  await expect(panel.getByText("What thickness should the part have?", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Apply command plan" })).toHaveCount(0);
  await panel.getByLabel("Describe command agent changes").fill("Set thickness to 8 mm");
  await panel.getByRole("button", { name: "Generate command preview" }).click();
  await expect(panel.getByRole("button", { name: "Apply command plan" })).toBeVisible({ timeout: 90000 });
  const before = await call("runtime.snapshot");
  expect(before.ok).toBe(true);
  if (before.ok) expect((before.value as unknown as { document: { parameters: { thickness: { expression: string } } } }).document.parameters.thickness.expression).not.toBe("8mm");
  const plan = await call("plan.status");
  expect(plan.ok).toBe(true);
  if (plan.ok) expect(JSON.stringify(plan.value)).toContain('"nativeProof"');
  await page.getByLabel("Command plan preview", { exact: true }).getByRole("button", { name: "Apply command plan", exact: true }).click();
  const applied = await call("runtime.awaitNative");
  expect(applied.ok).toBe(true);
  if (applied.ok) {
    const value = applied.value as unknown as { history: { undo: number }; rebuild: { bodies: { assertions: { volume: number; valid: boolean; solidCount: number } }[] } };
    expect(value.history.undo).toBe(1);
    expect(value.rebuild.bodies[0].assertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(value.rebuild.bodies[0].assertions.volume).toBeCloseTo(1600 - 8 * Math.PI, 6);
  }
  await page.getByRole("button", { name: "Undo latest AI change", exact: true }).click();
  const undone = await call("runtime.awaitNative");
  expect(undone.ok).toBe(true);
  if (undone.ok) expect((undone.value as unknown as { rebuild: { bodies: { assertions: { volume: number } }[] } }).rebuild.bodies[0].assertions.volume).toBeCloseTo(1000 - 5 * Math.PI, 6);
  await page.getByRole("button", { name: "Redo latest AI change", exact: true }).click();
  const redone = await call("runtime.awaitNative");
  expect(redone.ok).toBe(true);
  if (redone.ok) {
    const assertions = (redone.value as unknown as { rebuild: { bodies: { assertions: { volume: number; valid: boolean; solidCount: number } }[] } }).rebuild.bodies[0].assertions;
    expect(assertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(assertions.volume).toBeCloseTo(1600 - 8 * Math.PI, 6);
  }
}
