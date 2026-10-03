import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CURRENT_SCHEMA_VERSION,
  type CadDocument,
} from "../src/cad/document/schema";
import { CONTENT_SECURITY_POLICY } from "../deployment/securityHeaders";

const crossSectionArea = 20 * 10 - Math.PI;
async function nativeBody(page: Page, thickness: number) {
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  await page
    .locator(".body-row")
    .getByRole("button", { name: "Base", exact: true })
    .click();
  // This readout exists only for runtime native BRep assertions, never fallback metadata.
  await expect(
    page.getByText("Volume (mm³)", { exact: true }).locator(".."),
  ).toContainText((crossSectionArea * thickness).toFixed(3));
  await expect(
    page.getByText("Solids", { exact: true }).locator("..").locator("dd"),
  ).toHaveText("1");
  await expect(
    page.getByText("Bounds", { exact: true }).locator(".."),
  ).toContainText(
    `0.000, 0.000, 0.000 to 20.000, 10.000, ${thickness.toFixed(3)}`,
  );
}
function stlGeometry(bytes: Buffer) {
  const triangles = bytes.readUInt32LE(80);
  expect(triangles).toBeGreaterThan(0);
  expect(bytes.length).toBe(84 + 50 * triangles);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  for (let i = 0; i < triangles; i++) {
    for (let axis = 0; axis < 3; axis++)
      if (!Number.isFinite(bytes.readFloatLE(84 + 50 * i + 4 * axis)))
        throw new Error(`Non-finite normal in STL triangle ${i}.`);
    const p = Array.from({ length: 9 }, (_, j) =>
      bytes.readFloatLE(96 + 50 * i + 4 * j),
    );
    for (let j = 0; j < 9; j++) {
      if (!Number.isFinite(p[j]))
        throw new Error(`Non-finite vertex in STL triangle ${i}.`);
      min[j % 3] = Math.min(min[j % 3], p[j]);
      max[j % 3] = Math.max(max[j % 3], p[j]);
    }
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return { volume, min, max };
}

for (let version = 1; version <= CURRENT_SCHEMA_VERSION; version++) {
  test(`schema ${version}: production native migration, edit, save/open and STL preserve intent`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto("/");
    expect(response!.headers()["content-security-policy"]).toBe(
      CONTENT_SECURITY_POLICY,
    );
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    const fixture = resolve(
      `src/persistence/fixtures/schema-v${version}.pcaddoc`,
    );
    const original = JSON.parse(await readFile(fixture, "utf8")) as CadDocument;
    expect(original.schemaVersion).toBe(version);
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await nativeBody(page, 5);
    const thickness = page.getByLabel("Parameter thickness expression", {
      exact: true,
    });
    await thickness.fill("8mm");
    await thickness.press("Enter");
    await nativeBody(page, 8);
    const saving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const savedPath = info.outputPath(`migrated-v${version}.pcaddoc`);
    await (await saving).saveAs(savedPath);
    const saved = JSON.parse(await readFile(savedPath, "utf8")) as CadDocument;
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(saved.id).toBe(original.id);
    expect(saved.features.map((feature) => feature.id)).toEqual(
      original.features.map((feature) => feature.id),
    );
    expect(saved.parameters.thickness.id).toBe("thickness-parameter");
    expect(saved.parameters.thickness.expression).toBe("8mm");
    expect(saved.features[1]).toMatchObject({
      targetBodyIds: ["body:base"],
      centerPointIds: ["center"],
    });
    for (const [id, sketch] of Object.entries(original.sketches))
      expect(Object.keys(saved.sketches[id].entities).sort()).toEqual(
        Object.keys(sketch.entities).sort(),
      );
    // Replace with a different native model before opening the saved migrated project.
    await page
      .getByRole("button", { name: "Load parametric box template" })
      .click();
    await expect(
      page.getByLabel("Parameter width expression", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export STL", exact: true }),
    ).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(savedPath);
    await expect(thickness).toHaveValue("8mm");
    await nativeBody(page, 8);
    const exporting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stlPath = info.outputPath(`schema-v${version}.stl`);
    await (await exporting).saveAs(stlPath);
    const mesh = stlGeometry(await readFile(stlPath));
    // Allow 0.1% chord error; a missing through-hole changes volume by over 1.5%.
    expect(Math.abs(mesh.volume / (crossSectionArea * 8) - 1)).toBeLessThan(
      0.001,
    );
    for (const axis of [0, 1, 2]) {
      expect(mesh.min[axis]).toBeCloseTo(0, 5);
      expect(mesh.max[axis]).toBeCloseTo([20, 10, 8][axis], 5);
    }
    const resaving = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const reopenedPath = info.outputPath(`reopened-v${version}.pcaddoc`);
    await (await resaving).saveAs(reopenedPath);
    const reopened = JSON.parse(
      await readFile(reopenedPath, "utf8"),
    ) as CadDocument;
    expect(reopened.parameters).toEqual(saved.parameters);
    expect(reopened.sketches).toEqual(saved.sketches);
    expect(reopened.features).toEqual(saved.features);
    expect(errors).toEqual([]);
  });
}
