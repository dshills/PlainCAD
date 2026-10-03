import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
import type { CadDocument } from "../src/cad/document/schema";
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const p = "/src/viewer/viewerDiagnostics.ts";
    return (await import(p)).inspectViewer() as ViewerSnapshot;
  });
}
async function ready(page: Page) {
  await expect(async () => {
    const s = await page.evaluate(async () => {
      const p = "/src/state/useCadStore.ts";
      const s = (await import(p)).useCadStore.getState();
      return {
        status: s.rebuild.status,
        result: s.rebuild.result,
        doc: s.history.present,
      };
    });
    expect(s.status).toBe("succeeded");
    expect(s.result?.documentId).toBe(s.doc.id);
    expect(s.result?.meshes[0].geometrySource).toBe("opencascade");
  }).toPass({ timeout: 20000 });
}
async function direction(page: Page) {
  const s = await snapshot(page),
    v = s.cameraPosition.map((x, i) => x - s.cameraTarget[i]),
    length = Math.hypot(...v);
  return v.map((x) => x / length);
}
async function screen(page: Page, point: [number, number, number]) {
  return page.evaluate(async (point) => {
    const p = "/src/viewer/viewerDiagnostics.ts";
    return (await import(p)).projectViewerPoint(point);
  }, point);
}
async function selection(page: Page) {
  return page.evaluate(async () => {
    const p = "/src/state/useCadStore.ts";
    return (await import(p)).useCadStore.getState().selection.selectedIds[0];
  });
}
test("standard orientation, saved cameras, global clipping/picking and full native STL", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load parametric box template" })
    .click();
  await ready(page);
  const panel = page.getByRole("region", { name: "View controls" });
  await panel.getByRole("button", { name: "Top", exact: true }).click();
  await expect
    .poll(async () => {
      const d = await direction(page);
      return Math.abs(d[0]) + Math.abs(d[1]);
    })
    .toBeLessThan(0.00001);
  expect((await snapshot(page)).cameraUp).toEqual([0, 1, 0]);
  await page.getByRole("button", { name: "Fit view", exact: true }).click();
  expect((await direction(page))[2]).toBeCloseTo(1, 6);
  await panel.getByRole("button", { name: "Front", exact: true }).click();
  expect((await direction(page))[1]).toBeCloseTo(-1, 6);
  expect((await snapshot(page)).cameraUp).toEqual([0, 0, 1]);
  await panel.getByRole("button", { name: "Right", exact: true }).click();
  expect((await direction(page))[0]).toBeCloseTo(1, 6);
  await panel.getByRole("button", { name: "Top", exact: true }).click();
  await panel.getByLabel("New view name").fill("Inspection top");
  await panel.getByRole("button", { name: "Save current view" }).click();
  await ready(page);
  await expect(
    panel.getByRole("button", {
      name: "Restore view Inspection top",
      exact: true,
    }),
  ).toBeVisible();
  await panel.getByLabel("New view name").fill("inspection TOP");
  await panel.getByRole("button", { name: "Save current view" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "already exists" }),
  ).toBeVisible();
  await expect(panel.getByLabel("New view name")).toHaveValue("inspection TOP");
  await panel.getByLabel("New view name").fill("");
  const saved = await snapshot(page);
  await panel.getByRole("button", { name: "Isometric", exact: true }).click();
  await panel
    .getByRole("button", { name: "Restore view Inspection top", exact: true })
    .click();
  const restored = await snapshot(page);
  restored.cameraPosition.forEach((x, i) =>
    expect(x).toBeCloseTo(saved.cameraPosition[i], 5),
  );
  expect(restored.cameraUp).toEqual([0, 1, 0]);
  await panel.getByLabel("Section axis").selectOption("X");
  await expect
    .poll(async () =>
      (await snapshot(page)).meshes.every((m) => m.clippingEnabled),
    )
    .toBe(true);
  expect((await snapshot(page)).sectionPlane).toEqual({
    normal: [1, 0, 0],
    constant: 0,
  });
  const canvas = page.locator("canvas.viewer-canvas"),
    clipped = await screen(page, [-20, 0, 20]),
    visible = await screen(page, [20, 0, 20]);
  await canvas.click({ position: { x: clipped!.x, y: clipped!.y } });
  expect(await selection(page)).toBeUndefined();
  await canvas.click({ position: { x: visible!.x, y: visible!.y } });
  expect((await selection(page))?.kind).toBe("body");
  await panel.getByLabel("Keep positive section side").uncheck();
  await canvas.click({ position: { x: visible!.x, y: visible!.y } });
  expect(await selection(page)).toBeUndefined();
  await canvas.click({ position: { x: clipped!.x, y: clipped!.y } });
  expect((await selection(page))?.kind).toBe("body");
  const offset = panel.getByLabel("Section offset (mm)", { exact: true });
  await offset.fill("-10");
  await offset.press("Enter");
  await expect
    .poll(async () => (await snapshot(page)).sectionPlane?.constant)
    .toBe(-10);
  await offset.fill("bad");
  await offset.press("Enter");
  await expect(panel.getByRole("alert")).toContainText("finite");
  expect((await snapshot(page)).sectionPlane?.constant).toBe(-10);
  await offset.fill("0");
  await offset.press("Enter");
  const width = page.getByRole("textbox", {
    name: "Parameter width expression",
    exact: true,
  });
  await width.fill("100mm");
  await width.press("Enter");
  await ready(page);
  expect((await snapshot(page)).cameraUp).toEqual([0, 1, 0]);
  expect((await snapshot(page)).sectionPlane?.normal).toEqual([-1, 0, 0]);
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const file = info.outputPath("full-model.stl");
  await (await exporting).saveAs(file);
  const bytes = await readFile(file);
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < bytes.readUInt32LE(80); i++)
    for (const j of [0, 12, 24]) {
      const x = bytes.readFloatLE(96 + i * 50 + j);
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
  expect(min).toBe(-50);
  expect(max).toBe(50);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const project = info.outputPath("views.pcaddoc");
  await (await saving).saveAs(project);
  const doc = JSON.parse(await readFile(project, "utf8")) as CadDocument;
  expect(doc.viewState?.namedViews?.[0].name).toBe("Inspection top");
  expect(doc).not.toHaveProperty("sectionPlane");
  await page
    .getByRole("button", { name: "Load mounting plate template" })
    .click();
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles(project);
  await ready(page);
  expect((await snapshot(page)).sectionPlane).toBeUndefined();
  await panel
    .getByRole("button", { name: "Restore view Inspection top", exact: true })
    .click();
  expect((await snapshot(page)).cameraUp).toEqual([0, 1, 0]);
  const queuedStatus = await page.evaluate(async () => {
    const sp = "/src/state/useCadStore.ts",
      cp = "/src/ui/commands/commandRegistry.ts";
    const { useCadStore } = await import(sp),
      { runCommand } = await import(cp);
    const state = useCadStore.getState(),
      doc = state.history.present as CadDocument;
    state.setDocument({ ...doc });
    const status = useCadStore.getState().rebuild.status;
    await runCommand("view.restoreNamed", {
      viewId: doc.viewState!.namedViews![0].id,
      documentSession: useCadStore.getState().documentSession,
    });
    return status;
  });
  expect(queuedStatus).toBe("queued");
  await ready(page);
  const earlyRestore = await snapshot(page);
  earlyRestore.cameraPosition.forEach((x, i) =>
    expect(x).toBeCloseTo(doc.viewState!.namedViews![0].cameraPosition[i], 5),
  );
  expect(earlyRestore.cameraUp).toEqual([0, 1, 0]);
  await panel
    .getByRole("button", { name: "Delete view Inspection top", exact: true })
    .click();
  await ready(page);
  await expect(
    panel.getByRole("button", {
      name: "Restore view Inspection top",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  await expect(
    panel.getByRole("button", {
      name: "Restore view Inspection top",
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
