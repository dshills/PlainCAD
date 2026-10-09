#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";

const MAXIMUM = 6 * 1024 * 1024;
function options(values) {
  const options = { url: "http://127.0.0.1:5278" };
  for (let i = 0; i < values.length; i++) {
    if (!["--url", "--script"].includes(values[i]) || !values[i + 1]) throw new Error("Usage: node scripts/plaincad-live.mjs [--url http://127.0.0.1:5278] [--script commands.json]");
    options[values[i].slice(2)] = values[++i];
  }
  const url = new URL(options.url);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Use an HTTP loopback application origin.");
  options.url = url.origin;
  return options;
}
async function input(script) {
  if (script) {
    if ((await stat(script)).size > MAXIMUM) throw new Error("Script exceeds 6 MiB.");
    const data = await readFile(script);
    if (data.length > MAXIMUM) throw new Error("Script exceeds 6 MiB.");
    const parsed = JSON.parse(data.toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length > 1000) throw new Error("Script must be an array with at most 1000 command requests.");
    return parsed;
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) { if ((bytes += chunk.length) > MAXIMUM) throw new Error("Input exceeds 6 MiB."); chunks.push(chunk); }
  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/).filter(line => line.trim());
  if (lines.length > 1000) throw new Error("Input exceeds 1000 requests.");
  return lines.map(line => JSON.parse(line));
}
try {
  const settings = options(process.argv.slice(2));
  const token = process.env.PLAINCAD_LIVE_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Connect and copy an agent capability in the application, then supply it privately in PLAINCAD_LIVE_TOKEN.");
  for (const command of await input(settings.script)) {
    const response = await fetch(`${settings.url}/api/live/execute`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(command), redirect: "error", signal: AbortSignal.timeout(70000) });
    const result = await response.json().catch(() => { throw new Error(`Live server returned a non-JSON response (HTTP ${response.status}). Check the local application origin.`); });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!response.ok || !result.ok) { process.exitCode = 1; break; }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Live command failed."}\n`); process.exitCode = 1;
}
