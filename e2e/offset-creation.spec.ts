import { test, expect, type Page } from "@playwright/test";
import { applyExtrusion } from "./extrudeWorkflow";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
async function state(
  page: Page,
): Promise<{ document: CadDocument; result: RebuildResult; session: number }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return { document: state.history.present, result: state.rebuild.result, session: state.documentSession };
  });
}
async function coordinate(page: Page, x: number, y: number) {
  await page.getByLabel("Canvas coordinate X", { exact: true }).fill(String(x));
  await page.getByLabel("Canvas coordinate Y", { exact: true }).fill(String(y));
  await page
    .getByRole("button", { name: "Place coordinate", exact: true })
    .click();
}
for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`${plane}: Create Sketch offset validates units and preserves native orientation through parameter edits and save/open`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts";
      (await import(path)).useCadStore
        .getState()
        .updateDocument((document: CadDocument) => ({
          ...document,
          parameters: {
            lift: {
              id: "parameter_lift",
              name: "lift",
              expression: "-4mm",
              unit: "mm",
              value: -4,
            },
          },
        }));
    });
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await page
      .getByRole("button", { name: "Create sketch", exact: true })
      .click();
    const picker = page.getByRole("region", {
      name: "Create Sketch",
      exact: true,
    });
    await picker.getByLabel("Use offset sketch plane", { exact: true }).check();
    await picker
      .getByLabel("Sketch plane offset", { exact: true })
      .fill("3deg");
    const before = (await state(page)).document;
    await picker
      .getByRole("button", { name: `Sketch on ${plane} plane`, exact: true })
      .click();
    await expect(picker.getByRole("alert")).toBeVisible();
    expect((await state(page)).document).toEqual(before);
    await picker
      .getByLabel("Sketch plane offset", { exact: true })
      .fill("lift");
    await picker
      .getByRole("button", { name: `Sketch on ${plane} plane`, exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Sketch canvas", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Canvas tool", { exact: true })
      .selectOption("rectangle");
    await coordinate(page, 0, 0);
    await coordinate(page, 4, 6);
    await page
      .getByRole("button", { name: "Finish Sketch", exact: true })
      .click();
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Extrude", exact: true })
      .getByLabel("Extrude distance", { exact: true })
      .fill("3mm");
    await applyExtrusion(page);
    const axis = plane === "XY" ? 2 : plane === "XZ" ? 1 : 0;
    const sign = plane === "XZ" ? -1 : 1;
    const check = async (offset: number) => {
      await expect
        .poll(
          async () =>
            (await state(page)).result?.meshes[0]?.geometryAssertions?.volume,
        )
        .toBeCloseTo(72, 7);
      const mesh = (await state(page)).result.meshes[0];
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(
        Math.min(mesh.bounds.min[axis] * sign, mesh.bounds.max[axis] * sign),
      ).toBeCloseTo(offset, 6);
      expect(
        Math.max(mesh.bounds.min[axis] * sign, mesh.bounds.max[axis] * sign),
      ).toBeCloseTo(offset + 3, 6);
    };
    await check(-4);
    await page
      .getByLabel("Parameter lift expression", { exact: true })
      .fill("5mm");
    await page
      .getByLabel("Parameter lift expression", { exact: true })
      .press("Enter");
    await expect
      .poll(async () => {
        const mesh = (await state(page)).result.meshes[0];
        return Math.min(
          mesh.bounds.min[axis] * sign,
          mesh.bounds.max[axis] * sign,
        );
      })
      .toBeCloseTo(5, 6);
    await check(5);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const path = info.outputPath("offset.pcaddoc");
    await (await download).saveAs(path);
    const session = (await state(page)).session;
    await page.locator('input[type="file"]').setInputFiles(path);
    await expect.poll(async () => (await state(page)).session).toBeGreaterThan(session);
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await check(5);
    const sketch = Object.values((await state(page)).document.sketches)[0];
    expect(sketch.plane).toMatchObject({
      type: "offset",
      base: plane,
      offset: {
        expression: "lift",
        authoredUnit: "mm",
        parameterRefs: { lift: "parameter_lift" },
      },
    });
  });
}

test("Create Sketch offset from a native end cap follows owner distance edits", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Create XY sketch", exact: true }).click();
  await page.getByRole("button", { name: "Add center rectangle", exact: true }).click();
  await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
  await applyExtrusion(page);
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Create sketch", exact: true }).click();
  const picker = page.getByRole("region", { name: "Create Sketch", exact: true });
  await picker.getByLabel("Use offset sketch plane", { exact: true }).check();
  await picker.getByLabel("Sketch plane offset", { exact: true }).fill("2mm");
  await picker.getByRole("button", { name: "Sketch on Extrude 1 — end cap", exact: true }).click();
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("circle");
  await coordinate(page, 0, 0);
  await coordinate(page, 3, 0);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
  await page.getByRole("dialog", { name: "Extrude", exact: true }).getByLabel("Extrude distance", { exact: true }).fill("5mm");
  await applyExtrusion(page);
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  let snapshot = await state(page);
  const childId = `body:${snapshot.document.features[1].id}`;
  let mesh = snapshot.result.meshes.find(mesh => mesh.bodyId === childId)!;
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(45 * Math.PI, 7);
  expect(mesh.bounds.min[2]).toBeCloseTo(12, 6);
  expect(mesh.bounds.max[2]).toBeCloseTo(17, 6);
  await page.locator(".feature-chip").filter({ hasText: "Extrude 1" }).click();
  await page.getByLabel("Distance", { exact: true }).fill("14mm");
  await page.getByLabel("Distance", { exact: true }).press("Enter");
  await expect.poll(async () => (await state(page)).result?.meshes.find(mesh => mesh.bodyId === childId)?.bounds.min[2]).toBeCloseTo(16, 6);
  snapshot = await state(page);
  mesh = snapshot.result.meshes.find(mesh => mesh.bodyId === childId)!;
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(45 * Math.PI, 7);
  expect(mesh.bounds.max[2]).toBeCloseTo(21, 6);
});
