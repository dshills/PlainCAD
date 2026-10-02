import type { RecoveryRecord } from "../src/persistence/autosave";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
async function state(
  page: Page,
): Promise<{ document: CadDocument; status: string; result?: RebuildResult }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const s = (await import(path)).useCadStore.getState();
    return {
      document: s.history.present,
      status: s.rebuild.status,
      result: s.rebuild.result,
    };
  });
}
async function ready(page: Page) {
  await expect(async () => {
    const s = await state(page);
    expect(s.status).toBe("succeeded");
    expect(s.result?.documentId).toBe(s.document.id);
    expect(s.result?.errors).toEqual([]);
  }).toPass({ timeout: 20000 });
}
async function stored(page: Page): Promise<RecoveryRecord[]> {
  return page.evaluate(async () => {
    const path = "/src/persistence/autosave.ts";
    return (await import(path)).listRecoveryRecords();
  });
}
async function assembly(page: Page, offset = 15) {
  return page.evaluate(async (offset) => {
    const storePath = "/src/state/useCadStore.ts",
      docPath = "/src/cad/document/CadDocument.ts",
      sketchPath = "/src/cad/sketch/SketchModel.ts",
      solvePath = "/src/cad/sketch/SketchSolver.ts",
      profilePath = "/src/cad/sketch/profileDetection.ts";
    const { useCadStore } = await import(storePath),
      ops = await import(docPath),
      sketches = await import(sketchPath),
      { solveSketch } = await import(solvePath),
      { detectProfiles } = await import(profilePath);
    let document = ops.createEmptyDocument("Fabrication Assembly");
    for (const x of [0, offset]) {
      let sketch = sketches.addCornerRectangle(
        sketches.createXySketch(),
        "20mm",
        "10mm",
      );
      sketch = {
        ...sketch,
        entities: Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]: [string, any]) => [
            id,
            e.type === "point"
              ? {
                  ...e,
                  x: { ...e.x, expression: `(${e.x.expression}) + ${x}mm` },
                }
              : e,
          ]),
        ),
      };
      const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
      document = ops.upsertSketch(document, sketch);
      document = ops.upsertFeature(
        document,
        ops.createExtrudeFeature({
          name: document.features.length ? "part" : "Part",
          sketchId: sketch.id,
          profileId: profile.id,
          operation: "newBody",
          direction: "positive",
          distance: { expression: "10mm", unit: "mm" },
        }),
      );
    }
    useCadStore.getState().setDocument(document);
    return document.id;
  }, offset);
}
function unpack(bytes: Buffer) {
  const files: Array<{ name: string; data: Buffer }> = [];
  let i = 0;
  while (bytes.readUInt32LE(i) === 0x04034b50) {
    expect(bytes.readUInt16LE(i + 6)).toBe(0x0800);
    expect(bytes.readUInt16LE(i + 8)).toBe(0);
    const length = bytes.readUInt32LE(i + 18),
      nameSize = bytes.readUInt16LE(i + 26),
      extra = bytes.readUInt16LE(i + 28),
      start = i + 30 + nameSize + extra;
    files.push({
      name: bytes.subarray(i + 30, i + 30 + nameSize).toString(),
      data: bytes.subarray(start, start + length),
    });
    i = start + length;
  }
  expect(bytes.readUInt32LE(i)).toBe(0x02014b50);
  return files;
}
function stl(bytes: Buffer) {
  const count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + 50 * count);
  let volume = 0,
    minX = Infinity,
    maxX = -Infinity;
  for (let i = 0; i < count; i++) {
    const at = 84 + 50 * i,
      p = Array.from({ length: 9 }, (_, j) =>
        bytes.readFloatLE(at + 12 + 4 * j),
      );
    minX = Math.min(minX, p[0], p[3], p[6]);
    maxX = Math.max(maxX, p[0], p[3], p[6]);
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return { volume, minX, maxX };
}

test("IndexedDB autosave, explicit recovery, manual-save marker, corruption and quota failures", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Load parametric box template" })
    .click();
  await ready(page);
  const original = (await state(page)).document;
  await expect
    .poll(
      async () =>
        (await stored(page)).find((r) => r.id === original.id)?.latest?.text,
    )
    .toContain(original.id);
  await page.reload();
  await ready(page);
  const recovery = page.getByRole("dialog", {
    name: "Recover unsaved project",
  });
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Recover Parametric Box", exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).document.id)
    .toBe(original.id);
  await ready(page);
  expect((await state(page)).document.id).toBe(original.id);
  const width = page.getByRole("textbox", {
    name: "Parameter width expression",
  });
  await width.fill("91mm");
  await width.press("Enter");
  await ready(page);
  await expect
    .poll(
      async () =>
        (await stored(page)).find((r) => r.id === original.id)?.latest?.text,
    )
    .toContain("91mm");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("saved.pcaddoc");
  await (await download).saveAs(path);
  expect(await readFile(path, "utf8")).not.toMatch(
    /kernelHandle|geometryAssertions|positions|solvedSketches/,
  );
  await expect
    .poll(async () => {
      const r = (await stored(page)).find((r) => r.id === original.id)!;
      return r.manual?.text === r.latest?.text;
    })
    .toBe(true);
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("dialog", { name: "Recover unsaved project" }),
  ).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(path);
  await ready(page);
  await expect
    .poll(async () => (await state(page)).document.id)
    .toBe(original.id);
  const current = await state(page);
  await page.evaluate(() => {
    (window as any).realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  const expr = page.getByRole("textbox", {
    name: "Parameter width expression",
  });
  await expr.fill("92mm");
  await expr.press("Enter");
  await ready(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Quota exceeded" }),
  ).toBeVisible();
  expect((await state(page)).document.id).toBe(current.document.id);
  expect((await state(page)).document.parameters.width.expression).toBe("92mm");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (window as any).realPut;
  });
  await page.evaluate(async (id) => {
    const path = "/src/persistence/autosave.ts",
      api = await import(path);
    const records = await api.listRecoveryRecords(),
      r = records.find((record: RecoveryRecord) => record.id === id)!;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open(api.AUTOSAVE_DB, 1);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put({
        ...r,
        manual: undefined,
        latest: { ...r.latest, text: "corrupt", savedAt: Date.now() + 1 },
        previous: r.manual,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    // Prevent this outgoing page's pagehide autosave from replacing the deliberate corruption.
    // The next page should regain normal storage so previous-snapshot recovery works.
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  }, original.id);
  await page.reload();
  await ready(page);
  const broken = page.getByRole("dialog", { name: "Recover unsaved project" });
  await expect(broken).toBeVisible();
  await broken
    .getByRole("button", { name: "Recover Parametric Box", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "not valid JSON" }),
  ).toBeVisible();
  await broken
    .getByRole("button", { name: "Recover previous snapshot" })
    .click();
  await expect
    .poll(async () => (await state(page)).document.parameters.width?.expression)
    .toBe("91mm");
  await ready(page);
  expect((await state(page)).document.parameters.width.expression).toBe("91mm");
});

test("separate ZIP alignment, overlapping shells warning, stale validation and real native union", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await assembly(page);
  await ready(page);
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "STL export options" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("STL mode")).toHaveValue("separate");
  let download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Generate STL" }).click();
  let file = info.outputPath("parts.zip");
  await (await download).saveAs(file);
  const parts = unpack(await readFile(file));
  expect(parts.map((p) => p.name)).toEqual(["Part.stl", "part-2.stl"]);
  expect(stl(parts[0].data)).toMatchObject({ minX: 0, maxX: 20 });
  expect(stl(parts[1].data)).toMatchObject({ minX: 15, maxX: 35 });
  expect(stl(parts[1].data).volume).toBeCloseTo(2000);
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  await panel.getByLabel("STL mode").selectOption("shells");
  await panel.getByRole("button", { name: "Generate STL" }).click();
  await expect(panel.getByText(/intersect, touch, or contain/)).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const s = (await import(path)).useCadStore.getState();
    s.updateDocument((d: CadDocument) => ({
      ...d,
      name: "Edited while validating",
    }));
  });
  await ready(page);
  await panel.getByRole("button", { name: "Download with warnings" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Model changed after validation" }),
  ).toBeVisible();
  await panel.getByLabel("STL mode").selectOption("merged");
  download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Generate STL" }).click();
  // A connected union has no overlap warning and downloads automatically.
  file = info.outputPath("union.stl");
  await (await download).saveAs(file);
  const union = stl(await readFile(file));
  expect(union.volume).toBeCloseTo(3500);
  expect(union.minX).toBe(0);
  expect(union.maxX).toBe(35);
  expect((await state(page)).result!.meshes).toHaveLength(2);
});

test("bounded recovery retention and migration of a stored released schema", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const records = await page.evaluate(async () => {
    const recoveryPath = "/src/persistence/autosave.ts",
      docPath = "/src/cad/document/CadDocument.ts";
    const api = await import(recoveryPath),
      { createEmptyDocument } = await import(docPath);
    await api.removeRecovery();
    for (let i = 0; i < 8; i++)
      await api.saveRecovery(createEmptyDocument(`Recovery ${i}`));
    return api.listRecoveryRecords();
  });
  expect(records).toHaveLength(5);
  expect(
    records.some((r: RecoveryRecord) => r.latest!.name === "Recovery 7"),
  ).toBe(true);
  const text = await readFile(
      new URL("../src/persistence/fixtures/schema-v1.pcaddoc", import.meta.url),
      "utf8",
    ),
    fixture = JSON.parse(text);
  await page.evaluate(
    async ({ text, fixture }) => {
      const path = "/src/persistence/autosave.ts",
        api = await import(path);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const q = indexedDB.open(api.AUTOSAVE_DB, 1);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("projects", "readwrite");
        tx.objectStore("projects").put({
          id: fixture.id,
          latest: {
            text,
            name: fixture.name,
            schemaVersion: 1,
            savedAt: Date.now(),
          },
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { text, fixture },
  );
  await page.reload();
  await ready(page);
  await page
    .getByRole("dialog", { name: "Recover unsaved project" })
    .getByRole("button", { name: `Recover ${fixture.name}`, exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).document.id)
    .toBe(fixture.id);
  await ready(page);
  const result = await state(page);
  expect(result.document.schemaVersion).toBe(8);
  expect(result.result!.meshes[0].geometrySource).toBe("opencascade");
  expect(result.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    1000 - Math.PI * 5,
    4,
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "broken.pcaddoc",
    mimeType: "application/json",
    buffer: Buffer.from("{bad json"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "not valid JSON" }),
  ).toBeVisible();
  expect((await state(page)).document.id).toBe(fixture.id);
});
