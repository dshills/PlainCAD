import { expect, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { StepGeometryProof } from "../src/cad/kernel/nativeStep";
import { stlSignedVolume } from "./aiAcceptanceHelpers";

interface Snapshot {
  session: number;
  document: CadDocument;
  history: { undo: number; redo: number };
  rebuild: { native: boolean; bodies: { id: string; bounds: StepGeometryProof["bounds"]; assertions: StepGeometryProof }[] };
}
interface PackageProof {
  requestId: number;
  configurationId: string;
  drawingBodyId: string;
  bodyIds: string[];
  proofs: StepGeometryProof[];
  roundTripProofs: StepGeometryProof[];
  tessellationBounds: StepGeometryProof["bounds"][];
}

async function snapshot(page: Page, awaitNative = false) {
  const result = await page.evaluate(async wait => {
    const state = await window.plaincadCommands.execute({ command: "runtime.snapshot" });
    if (!state.ok || !wait) return state;
    return window.plaincadCommands.execute({ command: "runtime.awaitNative", session: (state.value as { session: number }).session });
  }, awaitNative);
  if (!result.ok) throw new Error(result.error.message);
  return result.value as unknown as Snapshot;
}

function unzip(bytes: Buffer) {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(offset + 30, "local header fits").toBeLessThanOrEqual(bytes.length);
    expect(bytes.readUInt16LE(offset + 6) & 8, "stored ZIP has no data descriptor").toBe(0);
    expect(bytes.readUInt16LE(offset + 8), "stored ZIP uses no compression").toBe(0);
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    expect(start + size, "entry fits").toBeLessThanOrEqual(bytes.length);
    const filename = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    expect(files.has(filename)).toBe(false);
    files.set(filename, bytes.subarray(start, start + size));
    offset = start + size;
  }
  expect(offset + 4, "central directory follows stored entries").toBeLessThanOrEqual(bytes.length);
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}

export async function configurationPackageAcceptance(page: Page, info: TestInfo) {
  const errors: string[] = [], violations: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.exposeFunction("recordPackageCspViolation", (directive: string) => violations.push(directive));
  await page.addInitScript(() => {
    const target = window as unknown as { fabricationProof?: PackageProof; recordPackageCspViolation: (directive: string) => void };
    document.addEventListener("securitypolicyviolation", event => target.recordPackageCspViolation(event.violatedDirective));
    // Read native before/after proofs without changing any worker requests or replies.
    window.Worker = new Proxy(window.Worker, {
      construct(factory, args) {
        const worker: Worker = Reflect.construct(factory, args);
        if (String(args[0]).includes("configurationPackageWorker")) worker.addEventListener("message", event => {
          const { result } = event.data;
          if (result) target.fabricationProof = {
            requestId: result.requestId, configurationId: result.configurationId, drawingBodyId: result.drawingBodyId, bodyIds: result.bodyIds,
            proofs: result.proofs, roundTripProofs: result.roundTripProofs, tessellationBounds: result.tessellationBounds,
          };
        });
        return worker;
      },
    });
  });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles("src/persistence/fixtures/schema-v20.pcaddoc");
  await expect.poll(async () => (await snapshot(page)).document.id).toBe("fixture-v20");
  const source = await snapshot(page, true);
  expect(source.document.parameters.width.expression).toBe("20mm");
  expect(source.rebuild.bodies).toHaveLength(3);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command Palette", exact: true });
  await palette.getByLabel("Filter commands").fill("Product configurations");
  await palette.getByRole("button", { name: /^Product configurations/ }).click();
  const dialog = page.getByRole("dialog", { name: "Product configurations", exact: true });
  await dialog.getByRole("checkbox", { name: "Compare Small", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "Compare Large", exact: true }).check();
  await dialog.getByRole("button", { name: "Compare selected configurations", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Comparison complete");
  await dialog.getByRole("button", { name: "Preview Large", exact: true }).click();
  const drawingBody = "body:second-solid";
  const drawingChoice = dialog.getByRole("combobox", { name: "Drawing part", exact: true });
  await drawingChoice.selectOption(drawingBody);
  const generate = dialog.getByRole("button", { name: "Generate fabrication package", exact: true });
  const download = dialog.getByRole("button", { name: "Download fabrication package", exact: true });
  const downloads: string[] = [];
  page.on("download", artifact => downloads.push(artifact.suggestedFilename()));
  await expect(download).toBeDisabled();
  await generate.click();
  await expect(dialog.getByRole("status")).toHaveText("Fabrication package ready");
  await expect(download).toBeEnabled();
  const firstRequest = await page.evaluate(() => (window as unknown as { fabricationProof: PackageProof }).fabricationProof.requestId);
  expect(downloads).toEqual([]);
  await drawingChoice.selectOption("body:first-solid");
  await drawingChoice.selectOption(drawingBody);
  await expect(download).toBeDisabled();
  const registryExecution = await page.evaluate(async session => {
    const discovered = await window.plaincadCommands.execute({ command: "runtime.waitForCommand", session,
      arguments: { label: "Generate fabrication package", property: "onClick", timeoutMs: 5000 } });
    if (!discovered.ok) throw new Error(discovered.error.message);
    const { matches } = discovered.value as unknown as { matches: { command: string; target: string }[] };
    const [{ command, target }] = matches;
    return window.plaincadCommands.execute({ command, target, session, arguments: {} });
  }, source.session);
  expect(registryExecution.ok, JSON.stringify(registryExecution)).toBe(true);
  await expect(dialog.getByRole("status")).toHaveText("Fabrication package ready");
  const proof = await page.evaluate(() => (window as unknown as { fabricationProof: PackageProof }).fabricationProof);
  expect(proof.requestId).toBeGreaterThan(firstRequest);
  expect(proof.configurationId).toBe("configuration-large");
  expect(proof.drawingBodyId).toBe(drawingBody);
  expect(proof.bodyIds).toHaveLength(3);
  const nativeProof = proof.roundTripProofs[proof.bodyIds.indexOf(drawingBody)];
  expect(proof.tessellationBounds).toHaveLength(proof.bodyIds.length);
  const drawingBounds = proof.tessellationBounds[proof.bodyIds.indexOf(drawingBody)];
  expect(drawingBounds.max[0]).toBeCloseTo(30, 6);
  expect(drawingBounds.min[2]).toBeCloseTo(10, 6);
  expect(nativeProof).toMatchObject({ valid: true, solidCount: 1 });
  expect(nativeProof.volume).toBeCloseTo(1500, 6);
  expect(nativeProof.bounds.min[2]).toBeCloseTo(10, 6);
  expect(nativeProof.bounds.max[0]).toBeCloseTo(30, 6);
  expect(nativeProof.bounds.max[2]).toBeCloseTo(15, 6);

  const downloading = page.waitForEvent("download");
  await download.click();
  const archive = info.outputPath("configuration.zip");
  await (await downloading).saveAs(archive);
  await expect(download).toBeDisabled();
  expect(downloads).toEqual([expect.stringMatching(/Large-fabrication\.zip$/)]);
  expect(await snapshot(page)).toEqual(source);

  const files = unzip(await readFile(archive));
  const packagedProject = files.get("project.pcaddoc")!;
  expect(JSON.parse(packagedProject.toString()).parameters.width.expression).toBe("30mm");
  const step = files.get("model.step")!.toString();
  expect(step).toMatch(/^ISO-10303-21;/);
  expect(step.trimEnd()).toMatch(/END-ISO-10303-21;$/);
  const drawing = files.get("drawing.svg")!.toString();
  expect(drawing).toContain(`data-body-id="${drawingBody}"`);
  expect(drawing).toContain("X 30.000 mm");
  expect(drawing).toContain("A–A at Z 12.500 mm");
  const bom = files.get("parts-list.csv")!.toString();
  expect(bom.split("\r\n")).toHaveLength(4);
  expect(bom).toContain(`1500.000,1,"${drawingBody}"`);
  const manifest = JSON.parse(files.get("manifest.json")!.toString()) as {
    configuration: { id: string; name: string };
    drawing: { bodyId: string; sectionHeightMm: number };
    parts: (StepGeometryProof & { bodyId: string; filename: string })[];
  };
  expect(manifest).toMatchObject({ configuration: { id: "configuration-large", name: "Large" }, drawing: { bodyId: drawingBody, sectionHeightMm: 12.5 } });
  expect(manifest.parts.map(part => part.bodyId)).toEqual(proof.bodyIds);
  expect(files.size).toBe(8);
  for (const [index, part] of manifest.parts.entries()) {
    expect(part.volume).toBeCloseTo(proof.proofs[index].volume, 6);
    expect(part.volume).toBeCloseTo(proof.roundTripProofs[index].volume, 6);
    const stl = files.get(part.filename)!;
    expect(stlSignedVolume(stl)).toBeCloseTo(part.volume, 4);
    if (part.bodyId === drawingBody) {
      let minZ = Infinity, maxZ = -Infinity;
      for (let triangle = 0; triangle < stl.readUInt32LE(80); triangle++) {
        for (let vertex = 0; vertex < 3; vertex++) {
          const z = stl.readFloatLE(104 + 50 * triangle + 12 * vertex);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
      }
      expect(minZ).toBeCloseTo(nativeProof.bounds.min[2], 5);
      expect(maxZ).toBeCloseTo(nativeProof.bounds.max[2], 5);
    }
  }

  await dialog.getByRole("button", { name: "Close configurations", exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "package.pcaddoc", mimeType: "application/json", buffer: packagedProject });
  await expect.poll(async () => (await snapshot(page)).session).toBeGreaterThan(source.session);
  const reopened = await snapshot(page, true);
  expect(reopened.document.parameters.width.expression).toBe("30mm");
  expect(reopened.rebuild.native).toBe(true);
  expect(reopened.rebuild.bodies.find(body => body.id === drawingBody)!.assertions.volume).toBeCloseTo(1500, 6);
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
}
