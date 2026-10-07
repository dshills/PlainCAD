import { applyExtrusion } from "./extrudeWorkflow";
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
  // The canvas handler measures the border box; locator click offsets start at
  // the padding box and can move a grid-snapped point by a millimeter.
  await page.mouse.click(
    Math.round(bounds.x + ((x - view[0]) / view[2]) * bounds.width),
    Math.round(bounds.y + ((-y - view[1]) / view[3]) * bounds.height),
  );
}
async function openCanvas(page: Page) {
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Sketch canvas", exact: true }),
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
    .getByRole("button", { name: "Finish Sketch", exact: true })
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
test("dimension labels move without modeling edits and cancel stale pointer gestures", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await openCanvas(page);
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("circle");
  await clickLocal(page, 0, 0);
  await clickLocal(page, 5, 0);
  await ready(page);
  await page.getByLabel("Show reference measurements", { exact: true }).check();
  const reference = page.locator(".canvas-reference-dimension").first();
  expect(await reference.getAttribute("role")).toBeNull();
  const referenceBefore = await snapshot(page);
  await page.getByLabel("Position reference labels", { exact: true }).check();
  const refText = reference.locator("text"),
    refStart = await refText.getAttribute("x");
  await refText.scrollIntoViewIfNeeded();
  const refBox = await refText.boundingBox();
  if (!refBox) throw new Error("Reference label unavailable");
  await page.mouse.move(
    refBox.x + refBox.width / 2,
    refBox.y + refBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    refBox.x + refBox.width / 2 + 20,
    refBox.y + refBox.height / 2 - 15,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(await refText.getAttribute("x")).not.toBe(refStart);
  await reference.press("Home");
  expect(await refText.getAttribute("x")).toBe(refStart);
  await page.getByLabel("Position reference labels", { exact: true }).uncheck();
  expect(await reference.getAttribute("role")).toBeNull();
  expect(await snapshot(page)).toEqual(referenceBefore);
  await page
    .getByLabel("Canvas dimension type", { exact: true })
    .selectOption("diameter");
  await page
    .getByLabel("Canvas dimension reference 1", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByLabel("Canvas dimension expression", { exact: true })
    .fill("10mm");
  await page
    .getByRole("button", { name: "Apply driving dimension", exact: true })
    .click();
  await ready(page);
  await done(page);
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await applyExtrusion(page);
  await ready(page, 250 * Math.PI);
  await page.locator(".sketch-chip").first().click();
  await openCanvas(page);
  const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
  const label = svg.locator("[data-dimension-id]"),
    text = label.locator("text");
  const position = async () => ({
    x: Number(await text.getAttribute("x")),
    y: Number(await text.getAttribute("y")),
  });
  const original = await position(),
    before = await snapshot(page);
  const history = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path);
    const state = useCadStore.getState();
    return {
      past: state.history.past.length,
      request: state.rebuild.requestId,
    };
  });
  await text.scrollIntoViewIfNeeded();
  const begin = async () => {
    const box = await text.boundingBox();
    if (!box) throw new Error("Dimension label unavailable");
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await label.evaluate((element) => {
      element.addEventListener(
        "pointerdown",
        (event) =>
          element.setAttribute(
            "data-pointer-id",
            String((event as PointerEvent).pointerId),
          ),
        { once: true },
      );
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 35, y - 20, { steps: 5 });
  };
  await begin();
  expect(await position()).not.toEqual(original);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(
    page.getByRole("region", { name: "Sketch canvas", exact: true }),
  ).toBeVisible();
  expect(await position()).toEqual(original);
  await begin();
  await page.mouse.up();
  const manual = await position();
  expect(manual.x).toBeGreaterThan(original.x);
  expect(manual.y).toBeLessThan(original.y);
  await label.press("ArrowRight");
  await expect(label.locator(".canvas-label-focus")).toBeVisible();
  expect((await position()).x).toBeGreaterThan(manual.x);
  await label.press("Shift+ArrowUp");
  expect((await position()).y).toBeLessThan(manual.y);
  await label.press("Home");
  expect(await position()).toEqual(original);
  await begin();
  await label.dispatchEvent("pointercancel", {
    pointerId: Number(await label.getAttribute("data-pointer-id")),
  });
  await page.mouse.up();
  expect(await position()).toEqual(original);
  expect(await snapshot(page)).toEqual(before);
  // A document replacement during capture must cancel rather than accept the old gesture.
  await begin();
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path);
    useCadStore.getState().updateDocument((document: CadDocument) => ({
      ...document,
      name: "Changed during drag",
    }));
  });
  await page.mouse.up();
  expect(await position()).toEqual(original);
  await ready(page, 250 * Math.PI);
  await begin();
  await page.mouse.up();
  await page.getByLabel("Show drawing dimensions", { exact: true }).uncheck();
  await page.getByLabel("Show drawing dimensions", { exact: true }).check();
  expect(await position()).not.toEqual(original);
  await page
    .getByRole("button", {
      name: "Reset dimension label placement",
      exact: true,
    })
    .click();
  expect(await position()).toEqual(original);
  const after = await snapshot(page);
  expect(after.document.sketches).toEqual(before.document.sketches);
  expect(after.document.features).toEqual(before.document.features);
  expect(after.result!.meshes[0].geometryAssertions).toEqual(
    before.result!.meshes[0].geometryAssertions,
  );
  const afterHistory = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path);
    const state = useCadStore.getState();
    return {
      past: state.history.past.length,
      request: state.rebuild.requestId,
    };
  });
  expect(afterHistory.past).toBe(history.past + 1); // Only the explicit external rename.
  await label.press("ArrowLeft");
  await page.screenshot({ path: info.outputPath("dimension-placement.png") });
  await done(page);
  await openCanvas(page);
  expect(await position()).toEqual(original); // Closing discards view-only placement.
  await done(page);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const saved = info.outputPath("label-placement.pcaddoc");
  await (await saving).saveAs(saved);
  expect(JSON.parse(await readFile(saved, "utf8")).sketches).toEqual(
    before.document.sketches,
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("label-placement.stl");
  await (await downloading).saveAs(stl);
  expect(stlVolume(await readFile(stl)) / (250 * Math.PI)).toBeCloseTo(1, 2);
  expect(errors).toEqual([]);
});
for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: constraint labels position, report crowding and cancel view changes without changing native geometry`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("rectangle");
    await clickLocal(page, 0, 0);
    await clickLocal(page, 20, 10);
    await done(page);
    await ready(page);
    const sketch = Object.values((await snapshot(page)).document.sketches)[0];
    const lines = Object.values(sketch.entities).filter(
      (entity) => entity.type === "line",
    );
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
    const id = (await snapshot(page)).document.sketches[sketch.id]
      .constraints[0].id;
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await applyExtrusion(page);
    await ready(page, 2000);
    const original = await snapshot(page);
    await page.locator(".sketch-chip").first().click();
    await openCanvas(page);
    await page.getByLabel("Show reference measurements", { exact: true }).check();
    const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
    const marker = svg.locator(`[data-constraint-id="${id}"]`),
      text = marker.locator("text");
    const position = async () => ({
      x: Number(await text.getAttribute("x")),
      y: Number(await text.getAttribute("y")),
    });
    const initial = await position();
    // A first drag must not open controls and move the SVG under the pointer.
    await text.scrollIntoViewIfNeeded();
    const initialBox = await text.boundingBox();
    const scale = await svg.evaluate((element) => {
      const matrix = (element as SVGSVGElement).getScreenCTM();
      if (!matrix) throw new Error("Canvas transform unavailable");
      return { x: matrix.a, y: matrix.d };
    });
    if (!initialBox) throw new Error("Canvas label unavailable");
    await page.mouse.move(
      initialBox.x + initialBox.width / 2,
      initialBox.y + initialBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      initialBox.x + initialBox.width / 2 + 20,
      initialBox.y + initialBox.height / 2 - 10,
      { steps: 5 },
    );
    await page.mouse.up();
    expect((await position()).x - initial.x).toBeCloseTo(20 / scale.x, 3);
    expect((await position()).y - initial.y).toBeCloseTo(-10 / scale.y, 3);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByRole("button", {
        name: "Apply constraint references",
        exact: true,
      }),
    ).toHaveCount(0);
    await marker.press("Home");
    expect(await position()).toEqual(initial);
    // Minor click jitter uses the same threshold as dragging and still inspects.
    const clickBox = await text.boundingBox();
    if (!clickBox) throw new Error("Constraint label unavailable");
    await page.mouse.move(
      clickBox.x + clickBox.width / 2,
      clickBox.y + clickBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      clickBox.x + clickBox.width / 2 + 1,
      clickBox.y + clickBox.height / 2 + 1,
    );
    await page.mouse.up();
    await expect(
      page.getByRole("button", {
        name: "Apply constraint references",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Reset constraint label placement",
        exact: true,
      }),
    ).toBeDisabled();
    expect(await position()).toEqual(initial);
    await marker.press("Enter");
    await expect(
      page.getByRole("button", {
        name: "Apply constraint references",
        exact: true,
      }),
    ).toBeVisible();
    await marker.press("ArrowRight");
    await expect(marker.locator(".canvas-label-focus")).toBeVisible();
    expect((await position()).x).toBeGreaterThan(initial.x);
    await marker.press("Shift+ArrowUp");
    expect((await position()).y).toBeLessThan(initial.y);
    await marker.press("Home");
    expect(await position()).toEqual(initial);
    const begin = async () => {
      await text.scrollIntoViewIfNeeded();
      const box = await text.boundingBox();
      if (!box) throw new Error("Constraint label unavailable");
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      return start;
    };
    await begin();
    const referenceBox = await svg
      .locator(".canvas-reference-dimension text")
      .first()
      .boundingBox();
    if (!referenceBox) throw new Error("Reference dimension unavailable");
    await page.mouse.move(
      referenceBox.x + referenceBox.width / 2,
      referenceBox.y + referenceBox.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    expect(await position()).not.toEqual(initial);
    await expect(marker).toHaveAttribute("data-layout-crowded", "true");
    await expect(
      page.getByText("1 constraint labels remain crowded in this view.", {
        exact: false,
      }),
    ).toBeVisible();
    const manual = await position();
    await page.getByLabel("Show constraint markers", { exact: true }).uncheck();
    await page.getByLabel("Show constraint markers", { exact: true }).check();
    expect(await position()).toEqual(manual);
    await page
      .getByRole("button", {
        name: "Reset constraint label placement",
        exact: true,
      })
      .click();
    expect(await position()).toEqual(initial);
    await separatedAnnotations(page);
    const cancelled = await begin();
    await page.mouse.move(cancelled.x + 25, cancelled.y - 15, { steps: 3 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await position()).toEqual(initial);
    await expect(
      page.getByRole("region", { name: "Sketch canvas", exact: true }),
    ).toBeVisible();
    const stale = await begin();
    await page.mouse.move(stale.x + 25, stale.y - 15, { steps: 3 });
    // Change the view while the pointer remains captured; the gesture must roll back.
    await page
      .getByRole("button", { name: "Zoom out", exact: true })
      .evaluate((button) => (button as HTMLButtonElement).click());
    await page.mouse.up();
    await expect(
      page.getByRole("button", {
        name: "Reset constraint label placement",
        exact: true,
      }),
    ).toBeDisabled();
    expect(await snapshot(page)).toEqual(original);
    await marker.press("ArrowLeft");
    await page.screenshot({
      path: info.outputPath("constraint-placement.png"),
    });
    await done(page);
    await openCanvas(page);
    await page.getByLabel("Show reference measurements", { exact: true }).check();
    expect(await position()).toEqual(initial);
    await done(page);
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const saved = info.outputPath("constraint-placement.pcaddoc");
    await (await saving).saveAs(saved);
    expect(JSON.parse(await readFile(saved, "utf8")).sketches).toEqual(
      original.document.sketches,
    );
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(saved);
    await ready(page, 2000);
    const reopened = await snapshot(page);
    expect(reopened.document.sketches).toEqual(original.document.sketches);
    expect(reopened.result!.meshes[0].geometryAssertions).toEqual(
      original.result!.meshes[0].geometryAssertions,
    );
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("constraint-placement.stl");
    await (await downloading).saveAs(stl);
    expect(stlVolume(await readFile(stl))).toBeCloseTo(2000, 3);
    expect(errors).toEqual([]);
  });
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
  await applyExtrusion(page);
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
    await page.getByRole("button", { name: "Rename parameter param_1", exact: true }).click();
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
    await applyExtrusion(page);
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
    await applyExtrusion(page);
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
    await applyExtrusion(page);
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
    page.getByRole("region", { name: "Sketch canvas" }),
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
  await applyExtrusion(page);
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
  await page.getByRole("button", { name: "Rename parameter param_1", exact: true }).click();
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
  await page.getByLabel("Show reference measurements", { exact: true }).check();
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
  await applyExtrusion(page);
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
    await applyExtrusion(page);
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
      page.getByRole("region", { name: "Sketch canvas", exact: true }),
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
    await page.getByRole("button", { name: "Rename parameter param_1", exact: true }).click();
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
    await applyExtrusion(page);
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
  await applyExtrusion(page);
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

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: analytic circle dividers retain exact native sectors through edits and persistence`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: "Add Parameter", exact: true })
      .click();
    await page.getByRole("button", { name: "Rename parameter param_1", exact: true }).click();
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .fill("radius");
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("10mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("circle");
    await clickLocal(page, 0, 0);
    await clickLocal(page, 10, 0);
    await page
      .getByLabel("Canvas dimension type", { exact: true })
      .selectOption("radius");
    await page
      .getByLabel("Canvas dimension reference 1", { exact: true })
      .selectOption({ index: 1 });
    await page
      .getByLabel("Canvas dimension expression", { exact: true })
      .fill("radius");
    await page
      .getByRole("button", { name: "Apply driving dimension", exact: true })
      .click();
    await page.getByLabel("Canvas tool", { exact: true }).selectOption("line");
    await clickLocal(page, -10, 0);
    await clickLocal(page, 10, 0);
    await page
      .getByRole("button", { name: "Cancel drawing", exact: true })
      .click();
    await clickLocal(page, 0, -10);
    await clickLocal(page, 0, 10);
    await done(page);
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const sketch = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]) => [
            id,
            e.type !== "point"
              ? e
              : {
                  ...e,
                  ...Object.fromEntries(
                    (["x", "y"] as const).map((axis) => [
                      axis,
                      Math.abs(Number.parseFloat(e[axis].expression)) === 10
                        ? {
                            ...e[axis],
                            expression: `${Number.parseFloat(e[axis].expression) < 0 ? "-" : ""}radius`,
                          }
                        : e[axis],
                    ]),
                  ),
                },
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
      sketch = Object.values(drawn.document.sketches)[0];
    const profiles = drawn.result!.profiles![sketch.id];
    expect(profiles).toHaveLength(4);
    const selected = profiles.find(
      (p) => Math.abs(p.bounds.minX) < 1e-8 && Math.abs(p.bounds.minY) < 1e-8,
    )!;
    expect(
      selected.outerLoop.segments!.filter((s) => s.type === "arc"),
    ).toHaveLength(1);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await applyExtrusion(page);
    await ready(page);
    await page
      .locator(".feature-chip")
      .filter({ hasText: "Extrude 1" })
      .click();
    await page
      .getByRole("combobox", { name: "Profile", exact: true })
      .selectOption(selected.id);
    await ready(page, 250 * Math.PI);
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("12mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await ready(page, 360 * Math.PI);
    const edited = await snapshot(page);
    expect(edited.result!.profiles![sketch.id].map((p) => p.id)).toEqual(
      profiles.map((p) => p.id),
    );
    expect(
      Object.keys(edited.document.sketches[sketch.id].entities).sort(),
    ).toEqual(Object.keys(sketch.entities).sort());
    const mesh = edited.result!.meshes[0];
    const expected =
      plane === "XY"
        ? [
            [0, 0, 0],
            [12, 12, 10],
          ]
        : plane === "XZ"
          ? [
              [0, -10, 0],
              [12, 0, 12],
            ]
          : [
              [0, 0, 0],
              [10, 12, 12],
            ];
    for (const [index, side] of ["min", "max"].entries())
      mesh.bounds[side as "min" | "max"].forEach((value, axis) =>
        expect(value).toBeCloseTo(expected[index][axis], 5),
      );
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const project = info.outputPath("circle-sectors.pcaddoc");
    await (await saving).saveAs(project);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(project);
    await ready(page, 360 * Math.PI);
    expect((await snapshot(page)).document.sketches).toEqual(
      edited.document.sketches,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("circle-sector.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl)) / (360 * Math.PI)).toBeCloseTo(1, 2);
    // Removing a chord changes region identity; feature repair must be explicit.
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const s = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(s.entities).filter(([, e]) => {
            if (e.type !== "line") return true;
            const start = s.entities[e.startPointId];
            return (
              start.type !== "point" ||
              Number.parseFloat(start.x.expression) !== 0
            );
          }),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [s.id]: { ...s, entities } },
        };
      });
    });
    await expect(async () => {
      const state = await snapshot(page);
      expect(state.status).toBe("failed");
      expect(
        state.result!.errors.some((e) => e.message.includes("profile")),
      ).toBe(true);
    }).toPass();
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  });
}

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: analytic arc dividers retain exact native sectors through edits and persistence`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: "Add Parameter", exact: true })
      .click();
    await page.getByRole("button", { name: "Rename parameter param_1", exact: true }).click();
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .fill("radius");
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("10mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await page.getByLabel("Canvas tool", { exact: true }).selectOption("arc");
    await clickLocal(page, 0, 0);
    await clickLocal(page, 10, 0);
    await clickLocal(page, -10, 0);
    await page
      .getByLabel("Canvas dimension type", { exact: true })
      .selectOption("radius");
    const arcDocument = (await snapshot(page)).document;
    const arcId = Object.values(
      Object.values(arcDocument.sketches)[0].entities,
    ).find((entity) => entity.type === "arc")!.id;
    await page
      .getByLabel("Canvas dimension reference 1", { exact: true })
      .selectOption(arcId);
    await page
      .getByLabel("Canvas dimension expression", { exact: true })
      .fill("radius");
    await page
      .getByRole("button", { name: "Apply driving dimension", exact: true })
      .click();
    await page.getByLabel("Canvas tool", { exact: true }).selectOption("line");
    await clickLocal(page, -10, 0);
    await clickLocal(page, 10, 0);
    await page
      .getByRole("button", { name: "Cancel drawing", exact: true })
      .click();
    await clickLocal(page, 0, 0);
    await clickLocal(page, 0, 10);
    await done(page);
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const sketch = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(sketch.entities).map(([id, e]) => [
            id,
            e.type !== "point"
              ? e
              : {
                  ...e,
                  ...Object.fromEntries(
                    (["x", "y"] as const).map((axis) => [
                      axis,
                      Math.abs(Number.parseFloat(e[axis].expression)) === 10
                        ? {
                            ...e[axis],
                            expression: `${Number.parseFloat(e[axis].expression) < 0 ? "-" : ""}radius`,
                          }
                        : e[axis],
                    ]),
                  ),
                },
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
      sketch = Object.values(drawn.document.sketches)[0];
    const profiles = drawn.result!.profiles![sketch.id];
    expect(profiles).toHaveLength(2);
    const selected = profiles.find(
      (p) => Math.abs(p.bounds.minX) < 1e-8 && Math.abs(p.bounds.minY) < 1e-8,
    )!;
    expect(
      selected.outerLoop.segments!.filter((s) => s.type === "arc"),
    ).toHaveLength(1);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await applyExtrusion(page);
    await ready(page);
    await page
      .locator(".feature-chip")
      .filter({ hasText: "Extrude 1" })
      .click();
    await page
      .getByRole("combobox", { name: "Profile", exact: true })
      .selectOption(selected.id);
    await ready(page, 250 * Math.PI);
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("12mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await ready(page, 360 * Math.PI);
    if (plane === "XZ") {
      await page.evaluate(async () => {
        const path = "/src/state/useCadStore.ts",
          { useCadStore } = await import(path);
        useCadStore.getState().updateDocument((d: CadDocument) => {
          const sketch = Object.values(d.sketches)[0];
          const entities = Object.fromEntries(
            Object.entries(sketch.entities).map(([id, e]) => [
              id,
              e.type === "arc"
                ? {
                    ...e,
                    startPointId: e.endPointId,
                    endPointId: e.startPointId,
                    clockwise: !e.clockwise,
                  }
                : e,
            ]),
          );
          return {
            ...d,
            sketches: { ...d.sketches, [sketch.id]: { ...sketch, entities } },
          };
        });
      });
      await ready(page, 360 * Math.PI);
    }
    const edited = await snapshot(page);
    expect(edited.result!.profiles![sketch.id].map((p) => p.id)).toEqual(
      profiles.map((p) => p.id),
    );
    expect(
      Object.keys(edited.document.sketches[sketch.id].entities).sort(),
    ).toEqual(Object.keys(sketch.entities).sort());
    const mesh = edited.result!.meshes[0];
    const expected =
      plane === "XY"
        ? [
            [0, 0, 0],
            [12, 12, 10],
          ]
        : plane === "XZ"
          ? [
              [0, -10, 0],
              [12, 0, 12],
            ]
          : [
              [0, 0, 0],
              [10, 12, 12],
            ];
    for (const [index, side] of ["min", "max"].entries())
      mesh.bounds[side as "min" | "max"].forEach((value, axis) =>
        expect(value).toBeCloseTo(expected[index][axis], 5),
      );
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const project = info.outputPath("arc-sectors.pcaddoc");
    await (await saving).saveAs(project);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(project);
    await ready(page, 360 * Math.PI);
    expect((await snapshot(page)).document.sketches).toEqual(
      edited.document.sketches,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("arc-sector.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl)) / (360 * Math.PI)).toBeCloseTo(1, 2);
    // Removing a chord changes region identity; feature repair must be explicit.
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const s = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(s.entities).filter(([, e]) => {
            if (e.type !== "line") return true;
            const start = s.entities[e.startPointId];
            return (
              start.type !== "point" ||
              Number.parseFloat(start.x.expression) !== 0
            );
          }),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [s.id]: { ...s, entities } },
        };
      });
    });
    await expect(async () => {
      const state = await snapshot(page);
      expect(state.status).toBe("failed");
      expect(state.result!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `feature:${edited.document.features[0].id}:profile`,
            source: "feature",
            sourceId: edited.document.features[0].id,
          }),
        ]),
      );
    }).toPass({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  });
}

test("major arc fragmentation produces the exact larger native circular region", async ({
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
  await clickLocal(page, 0, -10);
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("line");
  await clickLocal(page, 0, -10);
  await clickLocal(page, 10, 0);
  await page
    .getByRole("button", { name: "Cancel drawing", exact: true })
    .click();
  for (const [x, y] of [
    [10, 0],
    [Math.sqrt(50), Math.sqrt(50)],
  ]) {
    await page
      .getByLabel("Canvas coordinate X", { exact: true })
      .fill(String(x));
    await page
      .getByLabel("Canvas coordinate Y", { exact: true })
      .fill(String(y));
    await page
      .getByRole("button", { name: "Place coordinate", exact: true })
      .click();
  }
  await done(page);
  await ready(page);
  const state = await snapshot(page),
    sketch = Object.values(state.document.sketches)[0];
  const profiles = state.result!.profiles![sketch.id];
  expect(profiles).toHaveLength(2);
  const selected = profiles.find((p) =>
    p.outerLoop.segments!.some(
      (s) => s.type === "arc" && Math.abs(s.sweep) > Math.PI,
    ),
  )!;
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await applyExtrusion(page);
  await ready(page);
  await page.locator(".feature-chip").filter({ hasText: "Extrude 1" }).click();
  await page
    .getByRole("combobox", { name: "Profile", exact: true })
    .selectOption(selected.id);
  const volume = 10 * (75 * Math.PI + 50 - 50 * (Math.PI / 4 - Math.SQRT1_2));
  await ready(page, volume);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("major-arc-fragment.stl");
  await (await exporting).saveAs(stl);
  expect(stlVolume(await readFile(stl)) / volume).toBeCloseTo(1, 2);
});

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: intersecting circles produce analytic native lens regions with stable intent`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: "Add Parameter", exact: true })
      .click();
    await page.getByRole("button", { name: "Rename parameter param_1", exact: true }).click();
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .fill("radius");
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("10mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("circle");
    await clickLocal(page, 0, 0);
    await clickLocal(page, 10, 0);
    await clickLocal(page, 10, 0);
    await clickLocal(page, 20, 0);
    await done(page);
    // Author stable parameter bindings without replacing the pointer-drawn entities.
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const s = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(s.entities).map(([id, e]) => [
            id,
            e.type === "circle"
              ? { ...e, radius: { ...e.radius, expression: "radius" } }
              : e.type === "point" && Number.parseFloat(e.x.expression) === 10
                ? { ...e, x: { ...e.x, expression: "radius" } }
                : e,
          ]),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [s.id]: { ...s, entities } },
        };
      });
    });
    await ready(page);
    const drawn = await snapshot(page),
      sketch = Object.values(drawn.document.sketches)[0];
    const profiles = drawn.result!.profiles![sketch.id];
    expect(profiles).toHaveLength(3);
    const lens = profiles.find(
      (p) =>
        Math.abs(p.bounds.minX) < 1e-8 && Math.abs(p.bounds.maxX - 10) < 1e-8,
    )!;
    expect(lens.outerLoop.segments).toHaveLength(2);
    expect(lens.outerLoop.segments!.every((s) => s.type === "arc")).toBe(true);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await applyExtrusion(page);
    await ready(page);
    await page
      .locator(".feature-chip")
      .filter({ hasText: "Extrude 1" })
      .click();
    await page
      .getByRole("combobox", { name: "Profile", exact: true })
      .selectOption(lens.id);
    const volume = (r: number) =>
      10 * r * r * ((2 * Math.PI) / 3 - Math.sqrt(3) / 2);
    await ready(page, volume(10));
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("12mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await ready(page, volume(12));
    const edited = await snapshot(page);
    expect(edited.result!.profiles![sketch.id].map((p) => p.id)).toEqual(
      profiles.map((p) => p.id),
    );
    expect(Object.keys(edited.document.sketches[sketch.id].entities)).toEqual(
      Object.keys(sketch.entities),
    );
    const h = 6 * Math.sqrt(3),
      mesh = edited.result!.meshes[0];
    const bounds =
      plane === "XY"
        ? [
            [0, -h, 0],
            [12, h, 10],
          ]
        : plane === "XZ"
          ? [
              [0, -10, -h],
              [12, 0, h],
            ]
          : [
              [0, 0, -h],
              [10, 12, h],
            ];
    expect(
      edited.result!.profiles![sketch.id].find((p) => p.id === lens.id)!.bounds,
    ).toEqual(
      expect.objectContaining({
        minX: expect.closeTo(0, 8),
        maxX: expect.closeTo(12, 8),
        minY: expect.closeTo(-h, 8),
        maxY: expect.closeTo(h, 8),
      }),
    );
    // Mesh extrema may lie inside the true curved boundary; orientation remains exact.
    for (const [i, side] of ["min", "max"].entries())
      mesh.bounds[side as "min" | "max"].forEach((v, axis) => {
        expect(Math.abs(v - bounds[i][axis])).toBeLessThan(0.1);
        if (
          (plane === "XY" && axis === 2) ||
          (plane === "XZ" && axis === 1) ||
          (plane === "YZ" && axis === 0)
        )
          expect(v).toBeCloseTo(bounds[i][axis], 5);
      });
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const project = info.outputPath("circle-lens.pcaddoc");
    await (await saving).saveAs(project);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(project);
    await ready(page, volume(12));
    expect((await snapshot(page)).document.sketches).toEqual(
      edited.document.sketches,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("lens.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl)) / volume(12)).toBeCloseTo(1, 2);
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const s = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(s.entities).map(([id, e]) => [
            id,
            e.type === "point" && e.x.expression === "radius"
              ? { ...e, x: { ...e.x, expression: "3*radius" } }
              : e,
          ]),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [s.id]: { ...s, entities } },
        };
      });
    });
    await expect(async () => {
      const state = await snapshot(page);
      expect(state.status).toBe("failed");
      expect(state.result!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `feature:${edited.document.features[0].id}:profile`,
            source: "feature",
            sourceId: edited.document.features[0].id,
          }),
        ]),
      );
    }).toPass({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  });
}

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: circle/arc crossings produce exact native lens regions and explicit repair`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: "Add Parameter", exact: true })
      .click();
    await page.getByRole("button", { name: "Rename parameter param_1", exact: true }).click();
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .fill("radius");
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("10mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
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
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("circle");
    await clickLocal(page, 0, 10);
    await clickLocal(page, 5, 10);
    await done(page);
    // Author stable parameter bindings without replacing the pointer-drawn entities.
    await page.evaluate(async (plane) => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const s = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(s.entities).map(([id, e]) => [
            id,
            e.type === "circle"
              ? { ...e, radius: { ...e.radius, expression: "radius/2" } }
              : e.type === "arc" && plane === "XZ"
                ? {
                    ...e,
                    startPointId: e.endPointId,
                    endPointId: e.startPointId,
                    clockwise: !e.clockwise,
                  }
                : e.type === "point"
                  ? {
                      ...e,
                      ...Object.fromEntries(
                        (["x", "y"] as const).map((axis) => [
                          axis,
                          Math.abs(Number.parseFloat(e[axis].expression)) === 10
                            ? {
                                ...e[axis],
                                expression: `${Number.parseFloat(e[axis].expression) < 0 ? "-" : ""}radius`,
                              }
                            : e[axis],
                        ]),
                      ),
                    }
                  : e,
          ]),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [s.id]: { ...s, entities } },
        };
      });
    }, plane);
    await ready(page);
    const drawn = await snapshot(page),
      sketch = Object.values(drawn.document.sketches)[0];
    const profiles = drawn.result!.profiles![sketch.id];
    expect(profiles).toHaveLength(3);
    const lens = profiles.find(
      (p) =>
        Math.abs(p.bounds.minY - 5) < 1e-8 &&
        Math.abs(p.bounds.maxY - 10) < 1e-8,
    )!;
    expect(lens.outerLoop.segments).toHaveLength(2);
    expect(lens.outerLoop.segments!.every((s) => s.type === "arc")).toBe(true);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await applyExtrusion(page);
    await ready(page);
    await page
      .locator(".feature-chip")
      .filter({ hasText: "Extrude 1" })
      .click();
    await page
      .getByRole("combobox", { name: "Profile", exact: true })
      .selectOption(lens.id);
    const volume = (r: number) =>
      10 *
      r *
      r *
      (Math.acos(7 / 8) + Math.acos(1 / 4) / 4 - Math.sqrt(15) / 8);
    await ready(page, volume(10));
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("12mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await ready(page, volume(12));
    const edited = await snapshot(page);
    expect(edited.result!.profiles![sketch.id].map((p) => p.id)).toEqual(
      profiles.map((p) => p.id),
    );
    expect(Object.keys(edited.document.sketches[sketch.id].entities)).toEqual(
      Object.keys(sketch.entities),
    );
    const h = (12 * Math.sqrt(15)) / 8,
      mesh = edited.result!.meshes[0];
    const bounds =
      plane === "XY"
        ? [
            [-h, 6, 0],
            [h, 12, 10],
          ]
        : plane === "XZ"
          ? [
              [-h, -10, 6],
              [h, 0, 12],
            ]
          : [
              [0, -h, 6],
              [10, h, 12],
            ];
    expect(
      edited.result!.profiles![sketch.id].find((p) => p.id === lens.id)!.bounds,
    ).toEqual(
      expect.objectContaining({
        minX: expect.closeTo(-h, 8),
        maxX: expect.closeTo(h, 8),
        minY: expect.closeTo(6, 8),
        maxY: expect.closeTo(12, 8),
      }),
    );
    // Mesh extrema may lie inside the true curved boundary; orientation remains exact.
    for (const [i, side] of ["min", "max"].entries())
      mesh.bounds[side as "min" | "max"].forEach((v, axis) => {
        expect(Math.abs(v - bounds[i][axis])).toBeLessThan(0.1);
        if (
          (plane === "XY" && axis === 2) ||
          (plane === "XZ" && axis === 1) ||
          (plane === "YZ" && axis === 0)
        )
          expect(v).toBeCloseTo(bounds[i][axis], 5);
      });
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const project = info.outputPath("circle-arc-lens.pcaddoc");
    await (await saving).saveAs(project);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(project);
    await ready(page, volume(12));
    expect((await snapshot(page)).document.sketches).toEqual(
      edited.document.sketches,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("circle-arc-lens.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl)) / volume(12)).toBeCloseTo(1, 2);
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const s = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(s.entities).map(([id, e]) => [
            id,
            e.type === "point" && e.y.expression === "radius"
              ? { ...e, y: { ...e.y, expression: "3*radius" } }
              : e,
          ]),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [s.id]: { ...s, entities } },
        };
      });
    });
    await expect(async () => {
      const state = await snapshot(page);
      expect(state.status).toBe("failed");
      expect(state.result!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `feature:${edited.document.features[0].id}:profile`,
            source: "feature",
            sourceId: edited.document.features[0].id,
          }),
        ]),
      );
    }).toPass({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  });
}

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: arc-only disk crossings retain exact native regions through edits and persistence`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: "Add Parameter", exact: true })
      .click();
    await page.getByRole("button", { name: "Rename parameter param_1", exact: true }).click();
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .fill("radius");
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("10mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await openCanvas(page);
    await page.getByLabel("Canvas tool", { exact: true }).selectOption("arc");
    for (const [center, start, end] of [
      [0, 10, -10],
      [0, -10, 10],
      [10, 20, 0],
      [10, 0, 20],
    ]) {
      await clickLocal(page, center, 0);
      await clickLocal(page, start, 0);
      await clickLocal(page, end, 0);
    }
    await done(page);
    // Author stable parameter bindings without replacing the pointer-drawn entities.
    await page.evaluate(async (plane) => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const s = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(s.entities).map(([id, e]) => [
            id,
            e.type === "arc" && plane === "XZ"
              ? {
                  ...e,
                  startPointId: e.endPointId,
                  endPointId: e.startPointId,
                  clockwise: !e.clockwise,
                }
              : e.type === "point" && Number.parseFloat(e.x.expression) !== 0
                ? {
                    ...e,
                    x: {
                      ...e.x,
                      expression: `${Number.parseFloat(e.x.expression) / 10}*radius`,
                    },
                  }
                : e,
          ]),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [s.id]: { ...s, entities } },
        };
      });
    }, plane);
    await ready(page);
    const drawn = await snapshot(page),
      sketch = Object.values(drawn.document.sketches)[0];
    const profiles = drawn.result!.profiles![sketch.id];
    expect(profiles).toHaveLength(3);
    const lens = profiles.find(
      (p) =>
        Math.abs(p.bounds.minX) < 1e-8 && Math.abs(p.bounds.maxX - 10) < 1e-8,
    )!;
    // Four authored semicircles remain four analytic boundary fragments.
    expect(lens.outerLoop.segments).toHaveLength(4);
    expect(lens.outerLoop.segments!.every((s) => s.type === "arc")).toBe(true);
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await applyExtrusion(page);
    await ready(page);
    await page
      .locator(".feature-chip")
      .filter({ hasText: "Extrude 1" })
      .click();
    await page
      .getByRole("combobox", { name: "Profile", exact: true })
      .selectOption(lens.id);
    const volume = (r: number) =>
      10 * r * r * ((2 * Math.PI) / 3 - Math.sqrt(3) / 2);
    await ready(page, volume(10));
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .fill("12mm");
    await page
      .getByLabel("Parameter radius expression", { exact: true })
      .press("Enter");
    await ready(page, volume(12));
    const edited = await snapshot(page);
    expect(edited.result!.profiles![sketch.id].map((p) => p.id)).toEqual(
      profiles.map((p) => p.id),
    );
    expect(Object.keys(edited.document.sketches[sketch.id].entities)).toEqual(
      Object.keys(sketch.entities),
    );
    const h = 6 * Math.sqrt(3),
      mesh = edited.result!.meshes[0];
    const bounds =
      plane === "XY"
        ? [
            [0, -h, 0],
            [12, h, 10],
          ]
        : plane === "XZ"
          ? [
              [0, -10, -h],
              [12, 0, h],
            ]
          : [
              [0, 0, -h],
              [10, 12, h],
            ];
    expect(
      edited.result!.profiles![sketch.id].find((p) => p.id === lens.id)!.bounds,
    ).toEqual(
      expect.objectContaining({
        minX: expect.closeTo(0, 8),
        maxX: expect.closeTo(12, 8),
        minY: expect.closeTo(-h, 8),
        maxY: expect.closeTo(h, 8),
      }),
    );
    // Mesh extrema may lie inside the true curved boundary; orientation remains exact.
    for (const [i, side] of ["min", "max"].entries())
      mesh.bounds[side as "min" | "max"].forEach((v, axis) => {
        expect(Math.abs(v - bounds[i][axis])).toBeLessThan(0.1);
        if (
          (plane === "XY" && axis === 2) ||
          (plane === "XZ" && axis === 1) ||
          (plane === "YZ" && axis === 0)
        )
          expect(v).toBeCloseTo(bounds[i][axis], 5);
      });
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const project = info.outputPath("arc-only-lens.pcaddoc");
    await (await saving).saveAs(project);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(project);
    await ready(page, volume(12));
    expect((await snapshot(page)).document.sketches).toEqual(
      edited.document.sketches,
    );
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("arc-only-lens.stl");
    await (await exporting).saveAs(stl);
    expect(stlVolume(await readFile(stl)) / volume(12)).toBeCloseTo(1, 2);
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((d: CadDocument) => {
        const s = Object.values(d.sketches)[0];
        const entities = Object.fromEntries(
          Object.entries(s.entities).filter(([, e]) => {
            if (e.type !== "arc") return true;
            const center = s.entities[e.centerPointId];
            return (
              center.type !== "point" ||
              Number.parseFloat(center.x.expression) !== 1
            );
          }),
        );
        return {
          ...d,
          sketches: { ...d.sketches, [s.id]: { ...s, entities } },
        };
      });
    });
    await expect(async () => {
      const state = await snapshot(page);
      expect(state.status).toBe("failed");
      expect(state.result!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `feature:${edited.document.features[0].id}:profile`,
            source: "feature",
            sourceId: edited.document.features[0].id,
          }),
        ]),
      );
    }).toPass({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  });
}
