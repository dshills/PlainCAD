#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { readFile, mkdir, stat } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { createInterface } from "node:readline";
const args = process.argv.slice(2), options = { url: "http://127.0.0.1:5278", output: "test-results/cli", headed: false };
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (flag === "--help") {
    console.log("PlainCAD command CLI\n  --url http://127.0.0.1:5278  Running dev or production app\n  --project model.pcaddoc      Open a project through document.import\n  --script commands.json      Array of command requests; otherwise JSON lines on stdin\n  --output directory          Save native downloads (default test-results/cli)\n  --headed                    Show Chromium\nRequests: {command,arguments,session?} or {label,property,arguments} for a discovered UI action.\nRead commands.list and runtime.snapshot; include a session to reject stale work.\nThe CLI supplies the current session when omitted. No arbitrary JavaScript is evaluated.");
    process.exit(0);
  }
  if (flag === "--headed") {
    options.headed = true;
    continue;
  }
  if (!["--url", "--project", "--script", "--output"].includes(flag) || !args[index + 1])
    throw new Error(`Unknown or incomplete option: ${flag}`);
  options[flag.slice(2)] = args[++index];
}
const url = new URL(options.url);
if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password)
  throw new Error("CLI requires a loopback HTTP(S) app URL without credentials.");
async function boundedFile(path, maximum) { if ((await stat(path)).size > maximum)
  throw new Error(`Input file exceeds ${maximum} bytes.`); return readFile(path, "utf8"); }
const output = resolve(options.output);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: !options.headed }), page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const artifacts = [], pendingDownloads = new Set(), downloadErrors = [];
let deliveredDownloads = 0;
let reportedArtifacts = 0;
let inputBusy = false;
page.on("download", download => {
  const fileName = basename(download.suggestedFilename()).replace(/[^\p{L}\p{N}._ -]/gu, "_"), path = resolve(output, `${++deliveredDownloads}-${fileName}`);
  const task = download.saveAs(path).then(() => { artifacts.push(path); }).catch(error => { downloadErrors.push(String(error)); }).finally(() => pendingDownloads.delete(task));
  pendingDownloads.add(task);
});
try {
  await page.exposeFunction("plaincadCommandInput", async (request) => {
    if (inputBusy)
      throw new Error("Native input is already in progress. Execute gestures sequentially.");
    const { type, clientX, clientY, button, deltaX, deltaY, modifiers } = request;
    if (!Array.isArray(modifiers) || modifiers.some(modifier => !["Control", "Meta", "Shift", "Alt"].includes(modifier)) || !Number.isInteger(button) || button < 0 || button > 2 || ![clientX, clientY, deltaX, deltaY].every(Number.isFinite))
      throw new Error("Invalid native input request.");
    inputBusy = true;
    const pressed = [];
    try {
      for (const modifier of modifiers) {
        await page.keyboard.down(modifier);
        pressed.push(modifier);
      }
      await page.mouse.move(clientX, clientY);
      if (["pointerdown", "mousedown"].includes(type))
        await page.mouse.down({ button: ["left", "middle", "right"][button] ?? "left" });
      else if (["pointerup", "mouseup"].includes(type))
        await page.mouse.up({ button: ["left", "middle", "right"][button] });
      else if (type === "wheel")
        await page.mouse.wheel(deltaX, deltaY);
      else if (!["pointermove", "mousemove", "pointerleave", "mouseleave"].includes(type))
        throw new Error(`Input driver cannot synthesize ${type}; use the registered drop action with JSON drag data.`);
    }
    finally {
      await Promise.allSettled(pressed.map(modifier => page.keyboard.up(modifier)));
      inputBusy = false;
    }
  });
  await page.goto(url.href);
  await page.waitForFunction(() => Boolean(window.plaincadCommands));
  // Let mount-time recovery/kernel initialization settle before discovering controls.
  await page.waitForFunction(() => Boolean(document.querySelector(".viewer-region")));
  async function execute(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Each CLI request must be a JSON object.");
    if (Object.keys(input).some(key => !["command", "target", "arguments", "session", "label", "property", "awaitArtifact"].includes(key)) || (input.awaitArtifact !== undefined && typeof input.awaitArtifact !== "boolean"))
      throw new Error("Unknown or invalid CLI request fields.");
    const discovered = await page.evaluate(() => window.plaincadCommands.list());
    if (!discovered.ok)
      throw new Error(discovered.error.message);
    const { session, commands } = discovered.value;
    let request;
    if (input.label !== undefined) {
      if (typeof input.label !== "string" || typeof input.property !== "string")
        throw new Error("UI requests need a label and property.");
      const choices = commands.flatMap(command => command.bindings.filter(binding => binding.available && binding.label === input.label && binding.state?.property === input.property).map(binding => ({ command: command.id, target: binding.target })));
      if (choices.length !== 1)
        throw new Error(`Expected one available '${input.label}' ${input.property} action; found ${choices.length}. Discover commands first.`);
      request = { ...choices[0], arguments: input.arguments ?? {}, session: input.session ?? session };
    }
    else {
      const { awaitArtifact, ...fields } = input;
      request = { ...fields, session: input.session ?? session };
    }
    const downloadCount = deliveredDownloads;
    const before = input.awaitArtifact ? await page.evaluate(session => window.plaincadCommands.execute({ command: "runtime.artifacts", session }), session) : undefined;
    if (before && !before.ok)
      throw new Error(before.error.message);
    const response = await page.evaluate(value => window.plaincadCommands.execute(value), request);
    if (response.ok && input.awaitArtifact) {
      const waited = await page.evaluate(({ session, after }) => window.plaincadCommands.execute({ command: "runtime.awaitArtifact", session, arguments: { after } }), { session, after: before.value.sequence });
      if (!waited.ok)
        throw new Error(waited.error.message);
      const expires = Date.now() + 60000;
      while (deliveredDownloads <= downloadCount && Date.now() < expires)
        await new Promise(resolve => setTimeout(resolve, 25));
      if (deliveredDownloads <= downloadCount)
        throw new Error("The app initiated a download but Chromium did not deliver it.");
      await Promise.all(pendingDownloads);
      if (downloadErrors.length)
        throw new Error(`Download failed: ${downloadErrors.join("; ")}`);
    }
    console.log(JSON.stringify({ ...response, artifacts: [...artifacts] }));
    reportedArtifacts = artifacts.length;
    if (!response.ok)
      throw new Error(`${response.error.code}: ${response.error.message}`);
    return response;
  }
  if (options.project)
    await execute({ command: "document.import", arguments: { text: await boundedFile(options.project, 5 * 1024 * 1024) } });
  if (options.script) {
    const requests = JSON.parse(await boundedFile(options.script, 6 * 1024 * 1024));
    if (!Array.isArray(requests) || requests.length > 1000)
      throw new Error("Script must contain at most 1000 command requests.");
    for (const request of requests)
      await execute(request);
  }
  else
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      if (line.trim()) {
        if (Buffer.byteLength(line) > 6 * 1024 * 1024)
          throw new Error("Command line exceeds 6 MiB.");
        await execute(JSON.parse(line));
      }
    }
  await Promise.all(pendingDownloads);
  if (downloadErrors.length)
    throw new Error(`Download failed: ${downloadErrors.join("; ")}`);
  if (artifacts.length > reportedArtifacts)
    console.log(JSON.stringify({ ok: true, command: "runtime.artifacts", value: { savedDownloads: artifacts }, artifacts }));
}
finally {
  await browser.close();
}
