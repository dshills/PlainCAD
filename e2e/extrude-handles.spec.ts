import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import type { CadDocument, OriginPlane } from "../src/cad/document/schema";

async function ready(page: Page) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
}
async function seed(page: Page, plane: OriginPlane = "XY") {
  await page.goto("/");
  await ready(page);
  await page.evaluate(async (plane) => {
    const storePath = "/src/state/useCadStore.ts",
      modelPath = "/src/cad/sketch/SketchModel.ts",
      docPath = "/src/cad/document/CadDocument.ts";
    const { useCadStore } = await import(storePath),
      { createSketchOnPlane, addCenterRectangle } = await import(modelPath),
      { upsertSketch } = await import(docPath);
    const sketch = addCenterRectangle(
      createSketchOnPlane("Handle rectangle", plane),
      "10mm",
      "6mm",
    );
    useCadStore.getState().updateDocument((document: CadDocument) =>
      upsertSketch(
        {
          ...document,
          parameters: {
            depth: {
              id: "handle-depth",
              name: "depth",
              expression: "4mm",
              unit: "mm",
              value: 4,
            },
          },
        },
        sketch,
      ),
    );
    useCadStore.getState().select({
      kind: "sketch",
      id: sketch.id,
      documentId: useCadStore.getState().history.present.id,
    });
  }, plane);
  await ready(page);
}
async function open(page: Page) {
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Extrude", exact: true });
}
async function preview(dialog: Locator, volume?: number) {
  await expect(dialog.getByRole("status")).toContainText(
    "Native preview ready",
    { timeout: 30000 },
  );
  if (volume !== undefined)
    await expect(dialog.getByRole("status")).toContainText(
      `${volume.toFixed(3)} mm³`,
      { timeout: 30000 },
    );
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeEnabled();
}
async function startDrag(page: Page, dialog: Locator) {
  const handle = dialog.getByRole("button", {
    name: "Drag extrusion distance",
  });
  await expect(handle).toBeEnabled();
  const box = (await handle.boundingBox())!,
    line = dialog.getByTestId("extrusion-distance-axis"),
    dx =
      Number(await line.getAttribute("x2")) -
      Number(await line.getAttribute("x1")),
    dy =
      Number(await line.getAttribute("y2")) -
      Number(await line.getAttribute("y1")),
    length = Math.hypot(dx, dy);
  expect(length).toBeGreaterThan(1);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(
      box.x + box.width / 2 + (25 * dx) / length,
      box.y + box.height / 2 + (25 * dy) / length,
      { steps: 5 },
    );
    await expect(
      dialog.getByRole("button", { name: "Apply extrusion" }),
    ).toBeDisabled();
  } catch (error) {
    await page.mouse.up();
    throw error;
  }
}
async function assertNative(page: Page, expected: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.success).toBe(true);
    expect(state.result?.errors).toEqual([]);
    expect(state.result?.meshes).toHaveLength(1);
    const mesh = state.result!.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(
      Math.abs(mesh.geometryAssertions!.volume / expected - 1),
    ).toBeLessThan(1e-7);
  }).toPass({ timeout: 30000 });
  return aiSnapshot(page);
}
for (const [plane, direction, axis] of [
  ["XY", "positive", 2],
  ["XZ", "negative", 1],
  ["YZ", "symmetric", 0],
] as const) {
  test(`${plane} ${direction}: dragged extrusion equals typed native geometry, edit/save/open and STL`, async ({
    page,
  }, info) => {
    await seed(page, plane);
    const before = await aiSnapshot(page);
    let dialog = await open(page);
    await dialog
      .getByLabel("Extrude direction", { exact: true })
      .selectOption(direction);
    await preview(dialog, 600);
    await startDrag(page, dialog);
    await page.mouse.up();
    const expression = await dialog
        .getByLabel("Extrude distance", { exact: true })
        .inputValue(),
      distance = Number.parseFloat(expression);
    expect(distance).toBeGreaterThan(10);
    await preview(dialog, 60 * distance);
    expect(await aiSnapshot(page)).toEqual(before);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await aiSnapshot(page)).toEqual(before);
    dialog = await open(page);
    await dialog
      .getByLabel("Extrude direction", { exact: true })
      .selectOption(direction);
    await dialog
      .getByLabel("Extrude distance", { exact: true })
      .fill(expression);
    await preview(dialog, 60 * distance);
    await dialog.getByRole("button", { name: "Apply extrusion" }).click();
    const typed = await assertNative(page, 60 * distance),
      feature = typed.document.features[0];
    expect(typed.past).toBe(before.past + 1);
    expect(feature).toMatchObject({ direction, distance: { expression } });
    const mesh = typed.result!.meshes[0];
    expect(mesh.bounds.min[axis]).toBeCloseTo(
      direction === "symmetric" ? -distance / 2 : 0,
      6,
    );
    expect(mesh.bounds.max[axis]).toBeCloseTo(
      direction === "symmetric" ? distance / 2 : distance,
      6,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await ready(page);
    expect((await aiSnapshot(page)).document.features).toHaveLength(0);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await assertNative(page, 60 * distance);
    await page.evaluate(async (id) => {
      const path = "/src/state/useCadStore.ts",
        { useCadStore } = await import(path);
      useCadStore.getState().select({
        kind: "feature",
        id,
        documentId: useCadStore.getState().history.present.id,
      });
    }, feature.id);
    await page
      .locator(".timeline-actions")
      .getByRole("button", { name: "Edit Feature", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Edit Extrude", exact: true });
    await preview(dialog, 60 * distance);
    await dialog
      .getByRole("button", { name: "Drag extrusion distance" })
      .press("ArrowUp");
    await preview(dialog, 60 * (distance + 1));
    const editBefore = await aiSnapshot(page);
    await dialog.getByRole("button", { name: "Apply extrusion" }).click();
    const final = await assertNative(page, 60 * (distance + 1));
    expect(final.past).toBe(editBefore.past + 1);
    expect(final.document.features[0].id).toBe(feature.id);
    const save = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const project = info.outputPath("handle.pcaddoc");
    await (await save).saveAs(project);
    const beforeOpen = await aiSnapshot(page);
    await page.locator('input[type="file"]').setInputFiles(project);
    await expect
      .poll(async () => (await aiSnapshot(page)).session)
      .toBeGreaterThan(beforeOpen.session);
    await assertNative(page, 60 * (distance + 1));
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath("handle.stl");
    await (await download).saveAs(stl);
    expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(
      60 * (distance + 1),
      3,
    );
  });
}
test("Escape and pointer loss restore a drag; expression bindings and replaced projects cannot apply stale geometry", async ({
  page,
}) => {
  await seed(page);
  const before = await aiSnapshot(page),
    dialog = await open(page);
  await preview(dialog, 600);
  await startDrag(page, dialog);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel("Extrude distance", { exact: true }),
  ).toHaveValue("10mm");
  await preview(dialog, 600);
  const handle = dialog.getByRole("button", {
    name: "Drag extrusion distance",
  });
  await handle.evaluate((button) =>
    button.addEventListener(
      "pointerdown",
      (event) => {
        button.dataset.activePointerId = String(
          (event as PointerEvent).pointerId,
        );
      },
      { once: true },
    ),
  );
  await startDrag(page, dialog);
  await handle.evaluate((button) =>
    button.releasePointerCapture(Number(button.dataset.activePointerId)),
  );
  await expect(
    dialog.getByLabel("Extrude distance", { exact: true }),
  ).toHaveValue("10mm");
  await page.mouse.up();
  await preview(dialog, 600);
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("depth");
  await preview(dialog, 240);
  await expect(
    dialog.getByRole("button", { name: "Drag extrusion distance" }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(/dragging preserves parameter and formula bindings/),
  ).toBeVisible();
  await dialog.getByLabel("Extrude distance", { exact: true }).fill("depth*2");
  await preview(dialog, 480);
  expect(await aiSnapshot(page)).toEqual(before);
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      { useCadStore } = await import(path);
    useCadStore.getState().setDocument(useCadStore.getState().history.present);
  });
  await expect(dialog.getByRole("status")).toContainText(
    "Project or component changed",
  );
  await expect(
    dialog.getByRole("button", { name: "Apply extrusion" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Drag extrusion distance" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await aiSnapshot(page)).document.features).toHaveLength(0);
});
