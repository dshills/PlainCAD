import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { stlSignedVolume } from "../e2e/aiAcceptanceHelpers";
test.use({ storageState: { cookies: [], origins: [] } });
test("built focused workspace starts quietly and edits/exports a native example under CSP", async ({
  page,
}, info) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain(
    "worker-src 'self'",
  );
  await expect(page.getByLabel("Workspace layout")).toHaveValue("focused");
  await expect(
    page.getByRole("heading", { name: "Dependencies" }),
  ).toBeHidden();
  await page.getByText("Start from example", { exact: true }).click();
  await page
    .getByRole("button", { name: "Load mounting plate template", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Task panel").selectOption("parameters");
  const input = page.getByLabel("Parameter plate_width expression", {
    exact: true,
  });
  await input.fill("100mm");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  // Verify the edited native solid through the public readout before exporting;
  // a formerly enabled Export button alone cannot prove the new geometry is current.
  const expected = (100 * 50 - 4 * Math.PI * 1.6 ** 2) * 5;
  await page.getByLabel("Task panel").selectOption("inspector");
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page.locator(".body-row").getByRole("button").first().click();
  const nativeVolume = page
    .getByText("Volume (mm³)", { exact: true })
    .locator("..")
    .locator("dd");
  // InspectorPanel uses toFixed(3); 0.001 mm³ allows the display rounding.
  await expect
    .poll(async () =>
      Math.abs(Number(await nativeVolume.textContent()) - expected),
    )
    .toBeLessThan(0.001);
  await expect(
    page.getByText("Solids", { exact: true }).locator("..").locator("dd"),
  ).toHaveText("1");
  const exportFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const path = info.outputPath("focused-production.stl");
  await (await exportFile).saveAs(path);
  expect(
    Math.abs(stlSignedVolume(await readFile(path)) / expected - 1),
  ).toBeLessThan(0.001);
  await expect(page.getByLabel("Workspace layout")).toHaveValue("focused");
});
