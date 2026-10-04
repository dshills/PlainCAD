import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function snapshot(
  page: Page,
): Promise<{ document: CadDocument; status: string; result?: RebuildResult }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      status: state.rebuild.status,
      result: state.rebuild.result,
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
async function canvasPoint(page: Page, x: number, y: number) {
  const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate(
    (element, point) => {
      const svg = element as SVGSVGElement,
        matrix = svg.getScreenCTM();
      if (!matrix) throw new Error("Canvas transform unavailable");
      const local = svg.createSVGPoint();
      local.x = point.x;
      local.y = -point.y;
      const client = local.matrixTransform(matrix);
      return { x: client.x, y: client.y };
    },
    { x, y },
  );
}
async function clickPoint(page: Page, x: number, y: number) {
  const client = await canvasPoint(page, x, y);
  await page.mouse.click(client.x, client.y);
}
async function beginDrag(
  page: Page,
  from: [number, number],
  to: [number, number],
) {
  const start = await canvasPoint(page, ...from),
    end = await canvasPoint(page, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
}
async function openCanvas(page: Page) {
  await page.locator(".sketch-chip").first().click();
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
}
async function done(page: Page) {
  await page
    .getByRole("button", { name: "Done editing sketch", exact: true })
    .click();
}
function signedStlVolume(bytes: Buffer) {
  const count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + count * 50);
  let volume = 0;
  for (let i = 0; i < count; i++) {
    const p = Array.from({ length: 9 }, (_, j) =>
      bytes.readFloatLE(96 + 50 * i + j * 4),
    );
    expect(p.every(Number.isFinite)).toBe(true);
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return volume;
}
for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: orthogonal deformation preserves intent through native edits, cancellation, save/open and STL`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: "Add Parameter", exact: true })
      .click();
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .fill("width");
    await page
      .getByLabel("Parameter param_1 name", { exact: true })
      .press("Enter");
    await page
      .getByLabel("Parameter width expression", { exact: true })
      .fill("20mm");
    await page
      .getByLabel("Parameter width expression", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: `Create ${plane} sketch`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit sketch canvas", exact: true })
      .click();
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("rectangle");
    await clickPoint(page, 0, 0);
    await clickPoint(page, 20, 10);
    await done(page);
    await ready(page);
    const sketch = Object.values((await snapshot(page)).document.sketches)[0];
    const lines = Object.values(sketch.entities).filter(
        (e) => e.type === "line",
      ),
      points = Object.values(sketch.entities).filter((e) => e.type === "point");
    for (const [type, ids] of [
      ["horizontal", [lines[0].id, lines[2].id]],
      ["vertical", [lines[1].id, lines[3].id]],
      ["fixed", [points[0].id]],
    ] as const) {
      await page
        .getByLabel("Constraint type", { exact: true })
        .selectOption(type);
      await page
        .getByLabel(
          type === "fixed" ? "Constraint entities" : "Constraint points",
          { exact: true },
        )
        .selectOption([]);
      await page
        .getByLabel(
          type === "fixed" ? "Constraint points" : "Constraint entities",
          { exact: true },
        )
        .selectOption([...ids]);
      await page
        .getByRole("button", { name: "Add constraint", exact: true })
        .click();
      await ready(page);
    }
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await ready(page, 2000);
    const original = await snapshot(page),
      bodyId = original.result!.bodies[0].id;
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("deform");
    await page
      .getByLabel("Canvas point to move", { exact: true })
      .selectOption(points[2].id);
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await beginDrag(page, [20, 10], [30, 15]);
    const preview = page.getByLabel("Orthogonal deformation preview", {
      exact: true,
    });
    await expect(preview).toBeVisible();
    expect(await snapshot(page)).toEqual(original);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await snapshot(page)).toEqual(original);
    await beginDrag(page, [20, 10], [30, 15]);
    await page.mouse.up();
    await ready(page, 4500);
    const moved = await snapshot(page),
      solved = moved.result!.solvedSketches![sketch.id];
    expect(solved.points[points[0].id]).toMatchObject({ x: 0, y: 0 });
    expect(solved.points[points[1].id]).toMatchObject({ x: 30, y: 0 });
    expect(solved.points[points[2].id]).toMatchObject({ x: 30, y: 15 });
    expect(solved.points[points[3].id]).toMatchObject({ x: 0, y: 15 });
    expect(moved.document.sketches[sketch.id].constraints).toEqual(
      original.document.sketches[sketch.id].constraints,
    );
    expect(moved.result!.bodies[0].id).toBe(bodyId);
    await page
      .getByRole("button", { name: "Undo canvas edit", exact: true })
      .click();
    await ready(page, 2000);
    await page
      .getByRole("button", { name: "Redo canvas edit", exact: true })
      .click();
    await ready(page, 4500);
    await beginDrag(page, [30, 15], [35, 20]);
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().updateDocument((document: CadDocument) => ({
        ...document,
        name: "Changed during deformation",
      }));
    });
    await page.mouse.up();
    await ready(page, 4500);
    expect((await snapshot(page)).document.sketches).toEqual(
      moved.document.sketches,
    );
    await page
      .getByLabel("Canvas dimension type", { exact: true })
      .selectOption("length");
    await page
      .getByLabel("Canvas dimension reference 1", { exact: true })
      .selectOption(lines[0].id);
    await page
      .getByLabel("Canvas dimension expression", { exact: true })
      .fill("width");
    await page
      .getByRole("button", { name: "Apply driving dimension", exact: true })
      .click();
    await ready(page, 3000);
    const dimension = (await snapshot(page)).document.sketches[sketch.id]
      .dimensions[0];
    expect(dimension.expression.parameterRefs?.width).toBe(
      original.document.parameters.width.id,
    );
    await page.getByLabel("Canvas coordinate X", { exact: true }).fill("25");
    await page.getByLabel("Canvas coordinate Y", { exact: true }).fill("20");
    const beforeBlocked = await snapshot(page);
    await page
      .getByRole("button", { name: "Deform sketch to coordinate", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "X movement is blocked",
    );
    expect(await snapshot(page)).toEqual(beforeBlocked);
    await page.getByLabel("Canvas coordinate X", { exact: true }).fill("20");
    await page
      .getByRole("button", { name: "Deform sketch to coordinate", exact: true })
      .click();
    await ready(page, 4000);
    await done(page);
    await page
      .getByLabel("Parameter width expression", { exact: true })
      .fill("25mm");
    await page
      .getByLabel("Parameter width expression", { exact: true })
      .press("Enter");
    await ready(page, 5000);
    await openCanvas(page);
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("deform");
    await page
      .getByLabel("Canvas point to move", { exact: true })
      .selectOption(points[2].id);
    await page.getByLabel("Canvas coordinate X", { exact: true }).fill("25");
    await page.getByLabel("Canvas coordinate Y", { exact: true }).fill("25");
    await page
      .getByRole("button", { name: "Deform sketch to coordinate", exact: true })
      .click();
    await ready(page, 6250);
    await page
      .getByLabel("Sketch drawing canvas", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("orthogonal-deformation.png"),
    });
    await done(page);
    const final = await snapshot(page),
      mesh = final.result!.meshes[0];
    const expectedBounds =
      plane === "XY"
        ? { min: [0, 0, 0], max: [25, 25, 10] }
        : plane === "XZ"
          ? { min: [0, -10, 0], max: [25, 0, 25] }
          : { min: [0, 0, 0], max: [10, 25, 25] };
    for (const axis of [0, 1, 2]) {
      expect(mesh.bounds.min[axis]).toBeCloseTo(expectedBounds.min[axis], 5);
      expect(mesh.bounds.max[axis]).toBeCloseTo(expectedBounds.max[axis], 5);
    }
    expect(final.document.features).toEqual(original.document.features);
    expect(final.document.sketches[sketch.id].constraints).toEqual(
      original.document.sketches[sketch.id].constraints,
    );
    expect(final.document.sketches[sketch.id].dimensions[0]).toEqual(dimension);
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const saved = info.outputPath("deformation.pcaddoc");
    await (await saving).saveAs(saved);
    await page.reload();
    await ready(page);
    await page.locator('input[type="file"]').setInputFiles(saved);
    await ready(page, 6250);
    expect((await snapshot(page)).document.sketches).toEqual(
      final.document.sketches,
    );
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("deformation.stl");
    await (await downloading).saveAs(stl);
    expect(signedStlVolume(await readFile(stl))).toBeCloseTo(6250, 3);
    expect(errors).toEqual([]);
  });
}
