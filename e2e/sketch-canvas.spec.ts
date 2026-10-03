import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; status: string; result?: RebuildResult }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path),
      s = useCadStore.getState();
    return {
      document: s.history.present,
      status: s.rebuild.status,
      result: s.rebuild.result,
    };
  });
}
async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.success).toBe(true);
    if (volume !== undefined) {
      expect(state.result!.meshes).toHaveLength(1);
      const mesh = state.result!.meshes[0];
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 5);
    }
  }).toPass({ timeout: 20_000 });
}
async function clickLocal(page: Page, x: number, y: number) {
  const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
  await svg.scrollIntoViewIfNeeded();
  const bounds = await svg.boundingBox(),
    view = (await svg.getAttribute("viewBox"))!.split(" ").map(Number);
  if (!bounds) throw new Error("Sketch canvas unavailable");
  await svg.click({
    position: {
      x: ((x - view[0]) / view[2]) * bounds.width,
      y: ((-y - view[1]) / view[3]) * bounds.height,
    },
  });
}
async function openCanvas(page: Page) {
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Sketch canvas", exact: true }),
  ).toBeVisible();
}
async function separatedAnnotations(page: Page) {
  const boxes = await page
    .locator(".canvas-dimensions text, .canvas-constraints text")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const b = node.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      }),
    );
  expect(boxes.length).toBeGreaterThan(0);
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      expect(
        a.left < b.right &&
          b.left < a.right &&
          a.top < b.bottom &&
          b.top < a.bottom,
      ).toBe(false);
  const leaders = page.locator(".canvas-driving-dimension line");
  for (let i = 0; i < (await leaders.count()); i++)
    expect(
      await leaders
        .nth(i)
        .evaluate((node) => getComputedStyle(node).pointerEvents),
    ).toBe("none");
}
async function done(page: Page) {
  await page
    .getByRole("button", { name: "Done editing sketch", exact: true })
    .click();
}
function stlVolume(bytes: Buffer) {
  let sum = 0;
  for (let i = 0; i < bytes.readUInt32LE(80); i++) {
    const offset = 84 + 50 * i + 12,
      p = Array.from({ length: 9 }, (_, j) =>
        bytes.readFloatLE(offset + 4 * j),
      );
    sum +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return sum;
}
test("constraint markers inspect, repair and remove intent while native geometry persists", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await openCanvas(page);
  await page
    .getByLabel("Canvas tool", { exact: true })
    .selectOption("rectangle");
  await clickLocal(page, 0, 0);
  await clickLocal(page, 20, 10);
  await done(page);
  await ready(page);
  const drawn = await snapshot(page),
    sketch = Object.values(drawn.document.sketches)[0],
    lines = Object.values(sketch.entities).filter((e) => e.type === "line");
  await page
    .getByLabel("Constraint type", { exact: true })
    .selectOption("horizontal");
  await page
    .getByLabel("Constraint entities", { exact: true })
    .selectOption(lines[0].id);
  await page
    .getByRole("button", { name: "Add constraint", exact: true })
    .click();
  await ready(page);
  const id = (await snapshot(page)).document.sketches[sketch.id].constraints[0]
    .id;
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await ready(page, 2000);
  await page.getByRole("button", { name: /^Sketch 1 XY plane/ }).click();
  await openCanvas(page);
  const marker = page.locator(`[data-constraint-id="${id}"]`);
  await expect(marker).toHaveAttribute("data-constraint-state", "satisfied");
  const beforeInspect = (await snapshot(page)).document;
  await marker.focus();
  await marker.press("Enter");
  await expect(
    page.getByRole("button", {
      name: "Apply constraint references",
      exact: true,
    }),
  ).toBeVisible();
  expect((await snapshot(page)).document).toEqual(beforeInspect);
  await page
    .getByLabel("Canvas constraint entity 1", { exact: true })
    .selectOption(lines[2].id);
  await page
    .getByRole("button", { name: "Apply constraint references", exact: true })
    .click();
  await ready(page, 2000);
  expect(
    (await snapshot(page)).document.sketches[sketch.id].constraints[0],
  ).toMatchObject({ id, type: "horizontal", entityIds: [lines[2].id] });
  await page
    .getByRole("button", { name: "Undo canvas edit", exact: true })
    .click();
  await ready(page, 2000);
  expect(
    (await snapshot(page)).document.sketches[sketch.id].constraints[0]
      .entityIds,
  ).toEqual([lines[0].id]);
  await page
    .getByRole("button", { name: "Redo canvas edit", exact: true })
    .click();
  await ready(page, 2000);
  await page.evaluate(
    async ({ sketchId, id }) => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const sketch = d.sketches[sketchId];
        return {
          ...d,
          sketches: {
            ...d.sketches,
            [sketch.id]: {
              ...sketch,
              constraints: sketch.constraints.map((c) =>
                c.id === id ? { ...c, entityIds: ["missing-line"] } : c,
              ),
            },
          },
        };
      });
    },
    { sketchId: sketch.id, id },
  );
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(marker).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Inspect canvas constraint C1 H — lost",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("option", {
      name: "Lost reference — reselect",
      exact: true,
    }),
  ).toHaveCount(1);
  await page
    .getByLabel("Canvas constraint entity 1", { exact: true })
    .selectOption(lines[2].id);
  await page
    .getByRole("button", { name: "Apply constraint references", exact: true })
    .click();
  await ready(page, 2000);
  const added = await page.evaluate(
    async ({ sketchId, points, lineId }) => {
      const path = "/src/state/useCadStore.ts",
        modelPath = "/src/cad/sketch/SketchModel.ts",
        { useCadStore } = await import(path),
        { addConstraint } = await import(modelPath);
      let ids: string[] = [];
      useCadStore.getState().updateDocument((d: CadDocument) => {
        let sketch = d.sketches[sketchId];
        sketch = addConstraint(sketch, "fixed", { pointIds: points });
        sketch = addConstraint(sketch, "vertical", { entityIds: [lineId] });
        ids = sketch.constraints.slice(-2).map((c: { id: string }) => c.id);
        return { ...d, sketches: { ...d.sketches, [sketch.id]: sketch } };
      });
      return ids;
    },
    {
      sketchId: sketch.id,
      points: [lines[0].startPointId, lines[0].endPointId],
      lineId: lines[0].id,
    },
  );
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(
    page.locator(`[data-constraint-id="${added[1]}"]`),
  ).toHaveAttribute("data-constraint-state", "conflicting");
  await page
    .getByRole("button", {
      name: "Inspect canvas constraint C3 V — conflicting",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Delete canvas constraint", exact: true })
    .click();
  await ready(page, 2000);
  await page
    .getByRole("button", { name: "Undo canvas edit", exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await page
    .getByRole("button", { name: "Redo canvas edit", exact: true })
    .click();
  await ready(page, 2000);
  await page.getByRole("button", { name: "Fit sketch", exact: true }).click();
  await page
    .getByLabel("Sketch drawing canvas", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("constraint-canvas.png") });
  await done(page);
  const edited = await snapshot(page),
    saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = info.outputPath("constraints.pcaddoc");
  await (await saving).saveAs(project);
  await page.reload();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(project);
  await ready(page, 2000);
  expect((await snapshot(page)).document.sketches).toEqual(
    edited.document.sketches,
  );
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("constraints.stl");
  await (await exporting).saveAs(stl);
  expect(stlVolume(await readFile(stl))).toBeCloseTo(2000, 3);
  expect(errors).toEqual([]);
});
for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: fragmented line regions retain references through edits, native save/open and STL`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: "Add Parameter", exact: true })
      .click();
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .fill("partitionX");
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Parameter partitionX expression", { exact: true })
      .fill("10mm");
    await page
      .getByLabel("Parameter partitionX expression", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("rectangle");
    await clickLocal(page, 0, 0);
    await clickLocal(page, 40, 30);
    await page.getByLabel("Canvas tool", { exact: true }).selectOption("line");
    await clickLocal(page, 10, 0);
    await clickLocal(page, 10, 30);
    await page
      .getByRole("button", { name: "Cancel drawing", exact: true })
      .click();
    await clickLocal(page, 0, 12);
    await clickLocal(page, 40, 12);
    await done(page);
    // Bind the authored divider endpoint expressions, keeping all IDs intact.
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const sketch = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]) => [
            id,
            e.type === "point" && Number.parseFloat(e.x.expression) === 10
              ? { ...e, x: { expression: "partitionX", unit: "mm" } }
              : e,
          ]),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [sketch.id]: { ...sketch, entities } },
        };
      });
    });
    await ready(page);
    const drawn = await snapshot(page),
      sketch = Object.values(drawn.document.sketches)[0],
      profiles = drawn.result!.profiles![sketch.id];
    expect(profiles).toHaveLength(4);
    const selected = profiles.find(
      (p) =>
        p.bounds.minX === 0 && p.bounds.maxX === 10 && p.bounds.maxY === 12,
    )!;
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await ready(page);
    await page
      .locator(".feature-chip")
      .filter({ hasText: "Extrude 1" })
      .click();
    await page
      .getByRole("combobox", { name: "Profile", exact: true })
      .selectOption(selected.id);
    await ready(page, 1200);
    await page
      .getByLabel("Parameter partitionX expression", { exact: true })
      .fill("20mm");
    await page
      .getByLabel("Parameter partitionX expression", { exact: true })
      .press("Enter");
    await ready(page, 2400);
    const edited = await snapshot(page);
    expect(edited.document.features[0]).toMatchObject({
      profileId: selected.id,
    });
    expect(edited.result!.profiles![sketch.id].map((p) => p.id)).toEqual(
      profiles.map((p) => p.id),
    );
    const mesh = edited.result!.meshes[0];
    expect(mesh.bounds.max[plane === "YZ" ? 1 : 0]).toBeCloseTo(20, 5);
    expect(mesh.bounds.max[plane === "XY" ? 1 : 2]).toBeCloseTo(12, 5);
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const project = info.outputPath("fragmented.pcaddoc");
    await (await saving).saveAs(project);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(project);
    await ready(page, 2400);
    expect((await snapshot(page)).document.sketches).toEqual(
      edited.document.sketches,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("fragmented.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl))).toBeCloseTo(2400, 3);
    // Removing a divider alters topology and must require explicit profile repair.
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const sketch = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(sketch.entities).filter(([, e]) => {
            if (e.type !== "line") return true;
            const p = sketch.entities[e.startPointId];
            return (
              p.type !== "point" || Number.parseFloat(p.y.expression) !== 12
            );
          }),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [sketch.id]: { ...sketch, entities } },
        };
      });
    });
    await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
    expect(
      (await snapshot(page)).result!.errors.map((e) => e.message).join(" "),
    ).toMatch(/profile.*(lost|not found)/i);
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeDisabled();
    await page
      .locator(".feature-chip")
      .filter({ hasText: "Extrude 1" })
      .click();
    const repair = (await snapshot(page)).result!.profiles![sketch.id].find(
      (p) => p.bounds.minX === 0,
    )!;
    await page
      .getByRole("combobox", { name: "Profile", exact: true })
      .selectOption(repair.id);
    await ready(page, 6000);
    expect(errors).toEqual([]);
  });
}
for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: pointer-drawn non-template profile, native extrusion/cut, edit, save/open and STL`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await expect(
      page.getByRole("button", { name: "Edit sketch canvas", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await clickLocal(page, 0, 0);
    await clickLocal(page, 40, 0);
    await clickLocal(page, 0, 30);
    await clickLocal(page, 0, 0);
    await done(page);
    const drawn = await snapshot(page),
      sketch = Object.values(drawn.document.sketches)[0];
    expect(
      Object.values(sketch.entities).filter((e) => e.type === "point"),
    ).toHaveLength(3);
    await ready(page);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await ready(page, 6000);
    const base = (await snapshot(page)).result!.meshes[0];
    const expected =
      plane === "XY"
        ? [
            [0, 0, 0],
            [40, 30, 10],
          ]
        : plane === "XZ"
          ? [
              [0, -10, 0],
              [40, 0, 30],
            ]
          : [
              [0, 0, 0],
              [10, 40, 30],
            ];
    for (const [i, end] of ["min", "max"].entries())
      base.bounds[end as "min" | "max"].forEach((v, axis) =>
        expect(v).toBeCloseTo(expected[i][axis], 5),
      );
    await expect(async () => {
      const diagnostics: ViewerSnapshot | undefined = await page.evaluate(
        async () => {
          const path = "/src/viewer/viewerDiagnostics.ts";
          return (await import(path)).inspectViewer();
        },
      );
      const expectedPoints = [
        [0, 0],
        [40, 0],
        [0, 30],
      ].map(([x, y]) =>
        plane === "XY" ? [x, y, 0] : plane === "XZ" ? [x, 0, y] : [0, x, y],
      );
      for (const point of expectedPoints)
        expect(
          diagnostics!.sketchPoints.some((p) =>
            p.position.every((v, axis) => Math.abs(v - point[axis]) < 1e-5),
          ),
        ).toBe(true);
    }).toPass();
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("circle");
    await clickLocal(page, 10, 10);
    await clickLocal(page, 13, 10);
    await done(page);
    await ready(page);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await ready(page);
    await page
      .getByRole("combobox", { name: "Target body", exact: true })
      .selectOption(base.bodyId);
    await page
      .getByRole("combobox", { name: "Operation", exact: true })
      .selectOption("cut");
    await page
      .getByRole("combobox", { name: "Termination", exact: true })
      .selectOption("throughAll");
    await ready(page, (600 - Math.PI * 9) * 10);
    // Edit the original feature through its inspector, preserving the drawn profile IDs.
    await page
      .locator(".feature-chip")
      .filter({ hasText: "Extrude 1" })
      .click();
    await page.getByLabel("Distance", { exact: true }).fill("14mm");
    await page.getByLabel("Distance", { exact: true }).press("Enter");
    const volume = (600 - Math.PI * 9) * 14;
    await ready(page, volume);
    const savedState = await snapshot(page),
      saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const path = info.outputPath("canvas.pcaddoc");
    await (await saving).saveAs(path);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(path);
    await ready(page, volume);
    expect((await snapshot(page)).document.sketches).toEqual(
      savedState.document.sketches,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("canvas.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl)) / volume).toBeCloseTo(1, 3);
    expect(errors).toEqual([]);
  });
}
test("draft cancellation, primitive undo/redo, analytic arcs and construction geometry", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await openCanvas(page);
  await clickLocal(page, 0, 0);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Sketch canvas" }),
  ).toBeVisible();
  expect(
    Object.values((await snapshot(page)).document.sketches)[0].entities,
  ).toEqual({});
  await page
    .getByLabel("Canvas tool", { exact: true })
    .selectOption("rectangle");
  await clickLocal(page, 40, 20);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page
    .getByRole("button", { name: "Pan canvas right", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel drawing", exact: true }),
  ).toBeEnabled();
  await clickLocal(page, 60, 30);
  await page
    .getByRole("button", { name: "Undo canvas edit", exact: true })
    .click();
  expect(
    Object.values((await snapshot(page)).document.sketches)[0].entities,
  ).toEqual({});
  await page
    .getByRole("button", { name: "Redo canvas edit", exact: true })
    .click();
  expect(
    Object.values(
      Object.values((await snapshot(page)).document.sketches)[0].entities,
    ),
  ).toHaveLength(8);
  await page
    .getByRole("button", { name: "Undo canvas edit", exact: true })
    .click();
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("arc");
  await clickLocal(page, 0, 0);
  await clickLocal(page, 10, 0);
  await clickLocal(page, -10, 0);
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("line");
  await clickLocal(page, -10, 0);
  await clickLocal(page, 10, 0);
  await page
    .getByRole("button", { name: "Cancel drawing", exact: true })
    .click();
  await page
    .getByLabel("Canvas tool", { exact: true })
    .selectOption("rectangle");
  await page
    .getByLabel("Canvas construction geometry", { exact: true })
    .check();
  await clickLocal(page, 40, 20);
  await clickLocal(page, 60, 30);
  await done(page);
  await ready(page);
  await page
    .getByLabel("Sketch plane type", { exact: true })
    .selectOption("offset");
  await page.getByLabel("Sketch plane offset", { exact: true }).fill("7mm");
  await page
    .getByRole("button", { name: "Apply sketch plane", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await ready(page, Math.PI * 100 * 5);
  const mesh = (await snapshot(page)).result!.meshes[0];
  expect(mesh.bounds.min[2]).toBeCloseTo(7, 5);
  expect(mesh.bounds.max[2]).toBeCloseTo(17, 5);
  await expect(
    page.getByRole("button", { name: "Edit sketch canvas", exact: true }),
  ).toBeDisabled();
});

test("drawing dimensions drive native geometry, diagnose conflicts, persist and export", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Add Parameter", exact: true })
    .click();
  await page.getByLabel("Parameter param_1 name", { exact: true }).fill("bore");
  await page
    .getByLabel("Parameter param_1 name", { exact: true })
    .press("Enter");
  await page
    .getByLabel("Parameter bore expression", { exact: true })
    .fill("14mm");
  await page
    .getByLabel("Parameter bore expression", { exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await openCanvas(page);
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("circle");
  await clickLocal(page, 0, 0);
  await clickLocal(page, 5, 0);
  await ready(page);
  const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
  await expect(svg.locator("text")).toContainText(["R 5.0000 mm"]);
  await page
    .getByLabel("Canvas dimension type", { exact: true })
    .selectOption("diameter");
  await page
    .getByLabel("Canvas dimension reference 1", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByLabel("Canvas dimension expression", { exact: true })
    .fill("bore");
  await page
    .getByRole("button", { name: "Apply driving dimension", exact: true })
    .click();
  await ready(page);
  await expect(svg.locator("[data-dimension-id] text")).toHaveText(
    "D1 Ø 14.0000 mm",
  );
  const initial = await snapshot(page),
    sketch = Object.values(initial.document.sketches)[0],
    dimensionId = sketch.dimensions[0].id;
  expect(
    initial.result!.solvedSketches![sketch.id].circles[0].radius,
  ).toBeCloseTo(7, 6);
  // A second incompatible diameter fails solving; labels and native export must not imply success.
  await page
    .getByLabel("Canvas dimension selection", { exact: true })
    .selectOption("");
  await page
    .getByLabel("Canvas dimension expression", { exact: true })
    .fill("20mm");
  await page
    .getByRole("button", { name: "Apply driving dimension", exact: true })
    .click();
  await expect.poll(async () => (await snapshot(page)).status).toBe("failed");
  await expect(svg.locator("[data-dimension-id] text")).toContainText([
    "unavailable",
    "unavailable",
  ]);
  await expect(
    page.getByRole("button", { name: "Place coordinate", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Delete canvas dimension", exact: true })
    .click();
  await ready(page);
  await expect(svg.locator("[data-dimension-id] text")).toHaveText(
    "D1 Ø 14.0000 mm",
  );
  await svg.locator(`[data-dimension-id="${dimensionId}"]`).click();
  await expect(
    page.getByLabel("Canvas dimension expression", { exact: true }),
  ).toHaveValue("bore");
  await page.getByRole("button", { name: "Fit sketch", exact: true }).click();
  await page.screenshot({ path: info.outputPath("drawing-dimensions.png") });
  await done(page);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await ready(page, Math.PI * 49 * 10);
  await page
    .getByLabel("Parameter bore expression", { exact: true })
    .fill("20mm");
  await page
    .getByLabel("Parameter bore expression", { exact: true })
    .press("Enter");
  await ready(page, Math.PI * 100 * 10);
  await page.locator(".sketch-chip").first().click();
  await openCanvas(page);
  await expect(svg.locator("[data-dimension-id] text")).toHaveText(
    "D1 Ø 20.0000 mm",
  );
  await page.getByLabel("Show drawing dimensions", { exact: true }).uncheck();
  await expect(svg.locator("[data-dimension-id]")).toHaveCount(0);
  await page.getByLabel("Show drawing dimensions", { exact: true }).check();
  await done(page);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("dimensions.pcaddoc");
  await (await saving).saveAs(path);
  await page.reload();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await ready(page, Math.PI * 100 * 10);
  expect(
    Object.values((await snapshot(page)).document.sketches)[0].dimensions[0].id,
  ).toBe(dimensionId);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("dimensions.stl");
  await (await exporting).saveAs(stl);
  expect(stlVolume(await readFile(stl)) / (Math.PI * 100 * 10)).toBeCloseTo(
    1,
    2,
  );
  expect(errors).toEqual([]);
});

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: guarded point drag previews, cancels, preserves IDs and changes native geometry`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await clickLocal(page, 0, 0);
    await clickLocal(page, 40, 0);
    await clickLocal(page, 0, 30);
    await clickLocal(page, 0, 0);
    await done(page);
    await ready(page);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await ready(page, 6000);
    const original = await snapshot(page),
      sketch = Object.values(original.document.sketches)[0],
      entityIds = Object.keys(sketch.entities).sort();
    await page.locator(".sketch-chip").first().click();
    await openCanvas(page);
    await page.getByLabel("Canvas tool", { exact: true }).selectOption("move");
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
    async function clientPoint(x: number, y: number) {
      await svg.scrollIntoViewIfNeeded();
      const bounds = await svg.boundingBox(),
        view = (await svg.getAttribute("viewBox"))!.split(" ").map(Number);
      if (!bounds) throw new Error("Canvas unavailable");
      return {
        x: bounds.x + ((x - view[0]) / view[2]) * bounds.width,
        y: bounds.y + ((-y - view[1]) / view[3]) * bounds.height,
      };
    }
    async function startDrag(a: [number, number], b: [number, number]) {
      const start = await clientPoint(...a),
        end = await clientPoint(...b);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 5 });
    }
    await clickLocal(page, 0, 30);
    expect((await snapshot(page)).document).toEqual(original.document);
    await startDrag([0, 30], [0, 40]);
    expect((await snapshot(page)).document.sketches).toEqual(
      original.document.sketches,
    );
    await expect(svg.locator('[aria-label="Point move preview"]')).toHaveCount(
      1,
    );
    await page.mouse.up();
    await ready(page, 8000);
    await page
      .getByRole("button", { name: "Undo canvas edit", exact: true })
      .click();
    await ready(page, 6000);
    await page
      .getByRole("button", { name: "Redo canvas edit", exact: true })
      .click();
    await ready(page, 8000);
    const afterMove = (await snapshot(page)).document;
    await startDrag([0, 40], [10, 40]);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect((await snapshot(page)).document).toEqual(afterMove);
    await expect(
      page.getByRole("dialog", { name: "Sketch canvas", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Canvas coordinate X", { exact: true }).fill("0");
    await page.getByLabel("Canvas coordinate Y", { exact: true }).fill("45");
    await page
      .getByRole("button", { name: "Move point to coordinate", exact: true })
      .click();
    await ready(page, 9000);
    if (plane === "XY") {
      const current = (await snapshot(page)).document;
      await startDrag([0, 45], [0, 50]);
      await page.evaluate(async () => {
        const path = "/src/state/useCadStore.ts",
          { useCadStore } = await import(path);
        useCadStore.getState().updateDocument((d: CadDocument) => ({
          ...d,
          name: "Edited during drag",
        }));
      });
      await page.mouse.up();
      await ready(page, 9000);
      expect((await snapshot(page)).document.sketches).toEqual(
        current.sketches,
      );
    }
    await done(page);
    const moved = await snapshot(page);
    expect(
      Object.keys(moved.document.sketches[sketch.id].entities).sort(),
    ).toEqual(entityIds);
    const mesh = moved.result!.meshes[0];
    expect(mesh.bounds.max[plane === "XY" ? 1 : 2]).toBeCloseTo(45, 5);
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const path = info.outputPath("moved.pcaddoc");
    await (await saving).saveAs(path);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(path);
    await ready(page, 9000);
    expect((await snapshot(page)).document.sketches).toEqual(
      moved.document.sketches,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("moved.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl))).toBeCloseTo(9000, 3);
    expect(errors).toEqual([]);
  });
}

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: connected group translation preserves constrained native geometry and durability`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: "Add Parameter", exact: true })
      .click();
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .fill("span");
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Parameter span expression", { exact: true })
      .fill("20mm");
    await page
      .getByLabel("Parameter span expression", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("rectangle");
    await clickLocal(page, 0, 0);
    await clickLocal(page, 20, 10);
    await ready(page);
    const drawn = Object.values((await snapshot(page)).document.sketches)[0];
    const bottom = Object.values(drawn.entities).find(
      (e) => e.type === "line",
    )!;
    await page
      .getByLabel("Canvas dimension type", { exact: true })
      .selectOption("length");
    await page
      .getByLabel("Canvas dimension reference 1", { exact: true })
      .selectOption(bottom.id);
    await page
      .getByLabel("Canvas dimension expression", { exact: true })
      .fill("span");
    await page
      .getByRole("button", { name: "Apply driving dimension", exact: true })
      .click();
    await done(page);
    await ready(page);
    await page
      .getByLabel("Constraint type", { exact: true })
      .selectOption("horizontal");
    await page
      .getByLabel("Constraint entities", { exact: true })
      .selectOption(bottom.id);
    await page
      .getByRole("button", { name: "Add constraint", exact: true })
      .click();
    await ready(page);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await ready(page, 2000);
    const original = await snapshot(page);
    await page.locator(".sketch-chip").first().click();
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("translate");
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
    await svg.scrollIntoViewIfNeeded();
    await separatedAnnotations(page);
    if (plane === "XY")
      await page.screenshot({ path: info.outputPath("annotation-layout.png") });
    async function startDrag(a: [number, number], b: [number, number]) {
      await svg.scrollIntoViewIfNeeded();
      const bounds = (await svg.boundingBox())!;
      const view = (await svg.getAttribute("viewBox"))!.split(" ").map(Number);
      const client = ([x, y]: [number, number]) => ({
        x: bounds.x + ((x - view[0]) / view[2]) * bounds.width,
        y: bounds.y + ((-y - view[1]) / view[3]) * bounds.height,
      });
      const start = client(a),
        end = client(b);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 5 });
    }
    await startDrag([0, 0], [5, 8]);
    await expect(
      svg.getByLabel("Group translation preview", { exact: true }),
    ).toBeVisible();
    expect((await snapshot(page)).document).toEqual(original.document);
    await page.mouse.up();
    await ready(page, 2000);
    const moved = await snapshot(page);
    const sketch = moved.document.sketches[drawn.id];
    await separatedAnnotations(page);
    expect(sketch.constraints).toEqual(
      original.document.sketches[drawn.id].constraints,
    );
    expect(sketch.dimensions).toEqual(
      original.document.sketches[drawn.id].dimensions,
    );
    expect(Object.keys(sketch.entities).sort()).toEqual(
      Object.keys(drawn.entities).sort(),
    );
    const expectedBounds =
      plane === "XY"
        ? [
            [5, 8, 0],
            [25, 18, 10],
          ]
        : plane === "XZ"
          ? [
              [5, -10, 8],
              [25, 0, 18],
            ]
          : [
              [0, 5, 8],
              [10, 25, 18],
            ];
    for (const [index, side] of ["min", "max"].entries())
      moved.result!.meshes[0].bounds[side as "min" | "max"].forEach(
        (value, axis) =>
          expect(value).toBeCloseTo(expectedBounds[index][axis], 5),
      );
    await page
      .getByRole("button", { name: "Undo canvas edit", exact: true })
      .click();
    await ready(page, 2000);
    expect((await snapshot(page)).document.sketches).toEqual(
      original.document.sketches,
    );
    await page
      .getByRole("button", { name: "Redo canvas edit", exact: true })
      .click();
    await ready(page, 2000);
    await startDrag([5, 8], [10, 12]);
    await expect(
      svg.getByLabel("Group translation preview", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect((await snapshot(page)).document).toEqual(moved.document);
    if (plane === "XY") {
      await startDrag([5, 8], [10, 12]);
      await page.evaluate(async () => {
        const path = "/src/state/useCadStore.ts",
          { useCadStore } = await import(path);
        useCadStore.getState().updateDocument((d: CadDocument) => ({
          ...d,
          name: "Edited during group drag",
        }));
      });
      await page.mouse.up();
      await ready(page, 2000);
      expect((await snapshot(page)).document.sketches).toEqual(
        moved.document.sketches,
      );
    }
    await page.getByLabel("Canvas coordinate X", { exact: true }).fill("10");
    await page.getByLabel("Canvas coordinate Y", { exact: true }).fill("12");
    await page
      .getByRole("button", {
        name: "Translate group to coordinate",
        exact: true,
      })
      .click();
    await ready(page, 2000);
    await done(page);
    await page
      .getByLabel("Parameter span expression", { exact: true })
      .fill("25mm");
    await page
      .getByLabel("Parameter span expression", { exact: true })
      .press("Enter");
    // Only the bottom edge is dimensioned: the resulting trapezoid is 225 mm².
    await ready(page);
    const final = await snapshot(page);
    const segments = final.result!.profiles![drawn.id][0].outerLoop.segments!;
    const area =
      Math.abs(
        segments.reduce(
          (sum, segment) =>
            sum +
            segment.start.x * segment.end.y -
            segment.end.x * segment.start.y,
          0,
        ),
      ) / 2;
    const editedVolume = area * 10;
    expect(editedVolume).toBeCloseTo(2250, 1);
    await ready(page, editedVolume);
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const path = info.outputPath("translated.pcaddoc");
    await (await saving).saveAs(path);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(path);
    await ready(page, editedVolume);
    expect((await snapshot(page)).document.sketches).toEqual(
      final.document.sketches,
    );
    expect((await snapshot(page)).result!.meshes[0].bounds).toEqual(
      final.result!.meshes[0].bounds,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("translated.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl))).toBeCloseTo(editedVolume, 2);
    expect(errors).toEqual([]);
  });
}

test("analytic arc group translates without changing native radius or volume", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await openCanvas(page);
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("arc");
  await clickLocal(page, 0, 0);
  await clickLocal(page, 10, 0);
  await clickLocal(page, -10, 0);
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("line");
  await clickLocal(page, -10, 0);
  await clickLocal(page, 10, 0);
  await page
    .getByRole("button", { name: "Cancel drawing", exact: true })
    .click();
  await ready(page);
  await page
    .getByLabel("Canvas dimension type", { exact: true })
    .selectOption("radius");
  await page
    .getByLabel("Canvas dimension reference 1", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByLabel("Canvas dimension expression", { exact: true })
    .fill("10mm");
  await page
    .getByRole("button", { name: "Apply driving dimension", exact: true })
    .click();
  await done(page);
  await ready(page);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await ready(page, 500 * Math.PI);
  const original = await snapshot(page),
    sketch = Object.values(original.document.sketches)[0];
  const arc = Object.values(sketch.entities).find((e) => e.type === "arc")!;
  if (arc.type !== "arc") throw new Error("Expected an arc");
  await page.locator(".sketch-chip").first().click();
  await openCanvas(page);
  await page
    .getByLabel("Canvas tool", { exact: true })
    .selectOption("translate");
  await page
    .getByLabel("Canvas point to move", { exact: true })
    .selectOption(arc.centerPointId);
  await page.getByLabel("Canvas coordinate X", { exact: true }).fill("5");
  await page.getByLabel("Canvas coordinate Y", { exact: true }).fill("8");
  await page
    .getByRole("button", { name: "Translate group to coordinate", exact: true })
    .click();
  await ready(page, 500 * Math.PI);
  const translated = await snapshot(page);
  expect(translated.document.sketches[sketch.id].dimensions).toEqual(
    sketch.dimensions,
  );
  expect(translated.result!.meshes[0].bounds.min[0]).toBeCloseTo(-5, 5);
  expect(translated.result!.meshes[0].bounds.max[0]).toBeCloseTo(15, 5);
  expect(translated.result!.meshes[0].bounds.min[1]).toBeCloseTo(8, 5);
  expect(translated.result!.meshes[0].bounds.max[1]).toBeCloseTo(18, 5);
  await done(page);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("translated-arc.stl");
  await (await exporting).saveAs(stl);
  expect(stlVolume(await readFile(stl)) / (500 * Math.PI)).toBeCloseTo(1, 2);
});
