import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { CommandRequest, CommandResponse } from "../src/commands/registry";
type Snapshot = {
  session: number;
  document: {
    id: string;
    parameters: Record<string, {
      id: string;
      expression: string;
    }>;
  };
  history: {
    undo: number;
  };
  rebuild: {
    native: boolean;
    bodies: {
      assertions: {
        valid: boolean;
        volume: number;
        solidCount: number;
      };
      bounds: {
        min: number[];
        max: number[];
      };
    }[];
  };
};
async function call(page: Page, request: Omit<CommandRequest, "session"> & {
  session?: number;
}): Promise<CommandResponse> {
  return await page.evaluate(async (text) => {
    const value = JSON.parse(text), discovery = await window.plaincadCommands.list();
    if (!discovery.ok)
      throw new Error(discovery.error.message);
    return await window.plaincadCommands.execute({ ...value, session: value.session ?? (discovery.value as {
        session: number;
      }).session }) as unknown;
  }, JSON.stringify(request)) as CommandResponse;
}
function value(response: CommandResponse): Snapshot {
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return (response as {
    value: unknown;
  }).value as Snapshot;
}
async function ui(page: Page, label: string, property: string, args: object = {}) {
  return page.evaluate(async ({ label, property, args }) => {
    const discovered = await window.plaincadCommands.list();
    if (!discovered.ok)
      throw new Error(discovered.error.message);
    const { session, commands } = discovered.value as unknown as {
      session: number;
      commands: {
        id: string;
        bindings: {
          available: boolean;
          label: string;
          target: string;
          state?: {
            property: string;
          };
        }[];
      }[];
    };
    const matches = commands.flatMap(command => command.bindings.filter(binding => binding.label === label && binding.state?.property === property && binding.available).map(binding => ({ command: command.id, target: binding.target })));
    if (matches.length !== 1)
      throw new Error(`${label}/${property}: ${matches.length} targets`);
    return window.plaincadCommands.execute({ ...matches[0], session, arguments: args });
  }, { label, property, args });
}
function stlVolume(bytes: Buffer) {
  const count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + count * 50);
  let volume = 0;
  for (let index = 0; index < count; index++) {
    const p = Array.from({ length: 9 }, (_, j) => bytes.readFloatLE(96 + 50 * index + 4 * j));
    volume += (p[0] * (p[4] * p[8] - p[5] * p[7]) - p[1] * (p[3] * p[8] - p[5] * p[6]) + p[2] * (p[3] * p[7] - p[4] * p[6])) / 6;
  }
  return volume;
}
export function commandAcceptanceTests() {
  test("UI and JSON commands share parameter history, native geometry and stale-session guards", async ({ page }) => {
    await page.goto("/");
    const text = await readFile("src/persistence/fixtures/schema-v13.pcaddoc", "utf8");
    expect((await call(page, { command: "document.import", arguments: { text } })).ok).toBe(true);
    let native = value(await call(page, { command: "runtime.awaitNative" }));
    expect(native.rebuild.native).toBe(true);
    expect(native.rebuild.bodies[0].assertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(native.rebuild.bodies[0].assertions.volume).toBeCloseTo(1000 - 5 * Math.PI, 6);
    expect((await ui(page, "Parameter thickness expression", "onFocus")).ok).toBe(true);
    expect((await ui(page, "Parameter thickness expression", "onChange", { value: "8mm" })).ok).toBe(true);
    expect((await ui(page, "Parameter thickness expression", "onBlur")).ok).toBe(true);
    native = value(await call(page, { command: "runtime.awaitNative" }));
    expect(native.document.parameters.thickness.expression).toBe("8mm");
    expect(native.history.undo).toBe(1);
    expect(native.rebuild.bodies[0].assertions.volume).toBeCloseTo(1600 - 8 * Math.PI, 6);
    expect((await call(page, { command: "history.undo" })).ok).toBe(true);
    await call(page, { command: "runtime.awaitNative" });
    expect((await call(page, { command: "parameter.update", arguments: { parameterId: "thickness-parameter", patch: { expression: "8mm" } } })).ok).toBe(true);
    native = value(await call(page, { command: "runtime.awaitNative" }));
    expect(native.history.undo).toBe(1);
    expect(native.rebuild.bodies[0].assertions.volume).toBeCloseTo(1600 - 8 * Math.PI, 6);
    await call(page, { command: "document.import", arguments: { text } });
    expect(await call(page, { command: "parameter.update", session: native.session, arguments: { parameterId: "thickness-parameter", patch: { expression: "9mm" } } })).toMatchObject({ error: { code: "stale_session" } });
    expect(await call(page, { command: "document.import", arguments: { text: "{bad json" } })).toMatchObject({ error: { code: "command_failed" } });
    expect(value(await call(page, { command: "runtime.snapshot" })).document.parameters.thickness.expression).toBe("5");
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await call(page, { command: "file.openProject", arguments: { file: { name: "bad.pcaddoc", text: "{bad json" } } })).toMatchObject({ error: { code: "command_failed" } });
    await call(page, { command: "parameter.update", arguments: { parameterId: "thickness-parameter", patch: { expression: "5" } } });
    expect(value(await call(page, { command: "runtime.snapshot" })).document.parameters.thickness.expression).toBe("5");
  });
  test("CLI uses the production command transport for modeling, undo, save/open and STL/drawing downloads", async ({ baseURL }, info) => {
    test.setTimeout(200000);
    const script = info.outputPath("commands.json"), output = info.outputPath("cli-downloads");
    await writeFile(script, JSON.stringify([
      { command: "runtime.awaitNative" },
      { command: "parameter.update", arguments: { parameterId: "thickness-parameter", patch: { expression: "8mm" } } },
      { command: "runtime.awaitNative" }, { command: "history.undo" }, { command: "runtime.awaitNative" },
      { command: "file.saveProject", awaitArtifact: true }, { command: "file.exportStl", awaitArtifact: true },
      { command: "drawing.open" },
      { command: "runtime.waitForCommand", arguments: { label: "Download drawing SVG", property: "onClick" } },
      { label: "Download drawing SVG", property: "onClick", awaitArtifact: true },
      { label: "Download parts list CSV", property: "onClick", awaitArtifact: true },
      { label: "Close shop drawing", property: "onClick" }, { command: "document.serialize" },
    ]));
    const result = await promisify(execFile)(process.execPath, ["scripts/plaincad-cli.mjs", "--url", baseURL!, "--project", "src/persistence/fixtures/schema-v13.pcaddoc", "--script", script, "--output", output], { cwd: resolve("."), timeout: 100000, maxBuffer: 8 * 1024 * 1024 });
    const responses = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    expect(responses.every(response => response.ok), result.stderr).toBe(true);
    const native = responses.filter(response => response.command === "runtime.awaitNative").map(response => response.value as Snapshot);
    expect(native).toHaveLength(3);
    expect(native.map(snapshot => snapshot.rebuild.native)).toEqual([true, true, true]);
    expect(native[1].rebuild.bodies[0].assertions.volume).toBeCloseTo(1600 - 8 * Math.PI, 6);
    expect(native[2].rebuild.bodies[0].assertions.volume).toBeCloseTo(1000 - 5 * Math.PI, 6);
    const files: string[] = responses.at(-1).artifacts;
    expect(files).toHaveLength(4);
    const saved = files.find(path => path.endsWith(".pcaddoc"))!, stl = files.find(path => path.endsWith(".stl"))!, svg = files.find(path => path.endsWith(".svg"))!, csv = files.find(path => path.endsWith(".csv"))!;
    expect(stlVolume(await readFile(stl))).toBeCloseTo(1000 - 5 * Math.PI, 1);
    expect(await readFile(svg, "utf8")).toContain("Ø2.000 mm");
    expect(await readFile(csv, "utf8")).toContain('"body:base"');
    expect(JSON.parse(await readFile(saved, "utf8")).parameters.thickness.expression).toBe("5");
    await writeFile(script, JSON.stringify([{ command: "runtime.awaitNative" }]));
    const reopened = await promisify(execFile)(process.execPath, ["scripts/plaincad-cli.mjs", "--url", baseURL!, "--project", saved, "--script", script, "--output", output], { timeout: 70000 });
    expect(JSON.parse(reopened.stdout.trim().split("\n").at(-1)!).value.rebuild.bodies[0].assertions.volume).toBeCloseTo(1000 - 5 * Math.PI, 6);
  });
  test("CLI native pointer commands draw a non-template sketch and apply a real extrude preview", async ({ baseURL }, info) => {
    test.setTimeout(90000);
    const script = info.outputPath("draw-commands.json");
    await writeFile(script, JSON.stringify([
      { command: "file.newProject" }, { command: "sketch.createXY" }, { command: "sketch.drawRectangle" },
      { command: "runtime.waitForCommand", arguments: { label: "Sketch drawing canvas", property: "onPointerDown" } },
      { label: "Sketch drawing canvas", property: "onPointerDown", arguments: { x: 0.2, y: 0.2 } },
      { label: "Sketch drawing canvas", property: "onPointerMove", arguments: { x: 0.3, y: 0.3 } },
      { label: "Sketch drawing canvas", property: "onPointerCancel", arguments: { x: 0.3, y: 0.3 } },
      { command: "runtime.snapshot" },
      { label: "Sketch drawing canvas", property: "onPointerDown", arguments: { x: 0.35, y: 0.35 } },
      { label: "Sketch drawing canvas", property: "onPointerMove", arguments: { x: 0.65, y: 0.65 } },
      { label: "Sketch drawing canvas", property: "onPointerUp", arguments: { x: 0.65, y: 0.65 } },
      // Workbench Finish opens the first-solid native preview automatically.
      { command: "sketch.finish" }, { command: "runtime.waitForCommand", arguments: { label: "Apply extrusion", property: "onClick" } },
      { label: "Apply extrusion", property: "onClick" }, { command: "runtime.awaitNative" },
    ]));
    const result = await promisify(execFile)(process.execPath, ["scripts/plaincad-cli.mjs", "--url", baseURL!, "--script", script, "--output", info.outputPath("draw-downloads")], { timeout: 80000, maxBuffer: 8 * 1024 * 1024 }).catch(error => { throw new Error(`${error.message}\nCommand responses: ${String(error.stdout).slice(-5000)}`); });
    const native = JSON.parse(result.stdout.trim().split("\n").at(-1)!).value;
    const cancelled = result.stdout.trim().split("\n").map(line => JSON.parse(line)).find(response => response.command === "runtime.snapshot").value;
    expect(Object.values(cancelled.document.sketches)[0]).toMatchObject({ entities: {} });
    expect(native.rebuild.native).toBe(true);
    expect(native.document.features).toHaveLength(1);
    expect(Object.values(native.document.sketches)[0]).toMatchObject({ plane: { type: "origin", plane: "XY" } });
    const body = native.rebuild.bodies[0], bounds = body.bounds;
    expect(body.assertions).toMatchObject({ valid: true, solidCount: 1 });
    expect(bounds.min[2]).toBeCloseTo(0);
    expect(bounds.max[2]).toBeCloseTo(10);
    expect(body.assertions.volume).toBeCloseTo((bounds.max[0] - bounds.min[0]) * (bounds.max[1] - bounds.min[1]) * 10, 3);
  });
}
