import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { CommandResponse } from "../src/commands/registry";

async function cliSnapshot(url: string, token: string): Promise<CommandResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/plaincad-live.mjs", "--url", url], { cwd: process.cwd(), env: { ...process.env, PLAINCAD_LIVE_TOKEN: token }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", diagnostic = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Live CLI test timed out.")); }, 70000);
    child.stdout.on("data", chunk => { output += String(chunk); if (output.length > 16 * 1024 * 1024) { child.kill(); reject(new Error("Live CLI response exceeded its test limit.")); } });
    child.stderr.on("data", chunk => { diagnostic += String(chunk); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (code) reject(new Error(diagnostic || "Live CLI failed.")); else { try { resolve(JSON.parse(output)); } catch (error) { reject(error); } } });
    child.stdin.end('{"command":"runtime.snapshot"}\n');
  });
}

export async function liveSessionAcceptance({ page, request, baseURL }: { page: Page; request: APIRequestContext; baseURL?: string }) {
  expect(baseURL).toBeDefined();
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.plaincadCommands));
  const text = await readFile("src/persistence/fixtures/schema-v13.pcaddoc", "utf8");
  const local = (command: string, args: unknown = {}) => page.evaluate(async ({ command, args }) => {
    const discovery = await window.plaincadCommands.list();
    if (!discovery.ok) throw new Error(discovery.error.message);
    const session = (discovery.value as { session: number }).session;
    return window.plaincadCommands.execute({ command, session, arguments: args });
  }, { command, args });
  expect((await local("document.import", { text })).ok).toBe(true);
  expect((await local("runtime.awaitNative")).ok).toBe(true);
  expect((await local("selection.set", { kind: "parameter", id: "thickness-parameter" })).ok).toBe(true);
  expect((await local("automation.open")).ok).toBe(true);
  const connected = page.waitForResponse(response => response.url().endsWith("/api/live/connect") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Connect live agent", exact: true }).click();
  const capability = await (await connected).json() as { agentToken: string };
  await expect(page.getByRole("button", { name: "Disconnect live agent" })).toBeVisible();
  const remote = async (command: string, session?: number, args: unknown = {}) => {
    const response = await request.post(`${baseURL}/api/live/execute`, { headers: { Authorization: `Bearer ${capability.agentToken}` }, data: { command, ...(session === undefined ? {} : { session }), arguments: args } });
    return await response.json() as CommandResponse;
  };
  const initial = await cliSnapshot(baseURL!, capability.agentToken);
  expect(initial.ok).toBe(true);
  if (!initial.ok) return;
  const snapshot = initial.value as unknown as { session: number; selection: { selectedIds: { id: string }[] }; document: { parameters: Record<string, { expression: string }> }; rebuild: { native: boolean; bodies: { assertions: { valid: boolean; solidCount: number; volume: number } }[] } };
  expect(snapshot.selection.selectedIds[0].id).toBe("thickness-parameter");
  expect(snapshot.rebuild.native).toBe(true);
  expect((await remote("parameter.update", snapshot.session, { parameterId: "thickness-parameter", patch: { expression: "8mm" } })).ok).toBe(true);
  const updated = await remote("runtime.awaitNative", snapshot.session);
  expect(updated.ok).toBe(true);
  if (updated.ok) {
    const geometry = updated.value as unknown as typeof snapshot;
    expect(geometry.document.parameters.thickness.expression).toBe("8mm");
    expect(geometry.rebuild.bodies[0].assertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(geometry.rebuild.bodies[0].assertions.volume).toBeCloseTo(1600 - 8 * Math.PI, 6);
  }
  expect((await local("runtime.snapshot")).ok).toBe(true);
  expect((await remote("history.undo", snapshot.session)).ok).toBe(true);
  const undone = await remote("runtime.awaitNative", snapshot.session);
  expect(undone.ok).toBe(true);
  if (undone.ok) expect((undone.value as unknown as typeof snapshot).rebuild.bodies[0].assertions.volume).toBeCloseTo(1000 - 5 * Math.PI, 6);
  expect((await local("document.import", { text })).ok).toBe(true);
  expect(await remote("parameter.update", snapshot.session, { parameterId: "thickness-parameter", patch: { expression: "9mm" } })).toMatchObject({ ok: false, error: { code: "stale_session" } });
  await page.getByRole("button", { name: "Disconnect live agent", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect live agent", exact: true })).toBeVisible();
  const revoked = await request.post(`${baseURL}/api/live/execute`, { headers: { Authorization: `Bearer ${capability.agentToken}` }, data: { command: "runtime.snapshot" } });
  expect(revoked.status()).toBe(410);
}
