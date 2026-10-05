import { test, expect } from "@playwright/test";
test("sketch mode stays in the workspace and preserves the 3D camera and renderer", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page
    .getByRole("button", { name: "Create XZ sketch", exact: true })
    .click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const viewer = page.locator(".viewer-canvas canvas");
  await viewer.evaluate((element) =>
    element.setAttribute("data-retained-renderer", "original"),
  );
  const before = await page.evaluate(async () => {
    const path = "/src/viewer/cameraController.ts";
    return (await import(path)).captureCamera();
  });
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  const sketch = page.getByRole("region", {
    name: "Sketch canvas",
    exact: true,
  });
  await expect(sketch).toBeVisible();
  expect(
    await sketch.evaluate((element) => Boolean(element.closest("main"))),
  ).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(viewer).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Browser", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Canvas tool", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish Sketch", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Canvas tool", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(sketch).toBeVisible();
  await page.getByLabel("Canvas coordinate X", { exact: true }).fill("4");
  await page.getByLabel("Canvas coordinate Y", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "Place coordinate", exact: true })
    .click();
  await page.getByLabel("Sketch drawing canvas", { exact: true }).focus();
  await page.keyboard.press("f");
  await expect(
    sketch.getByRole("status").filter({ hasText: /draft point|Ready to draw/ }),
  ).toContainText("1 draft point");
  await page.keyboard.press("Escape");
  await expect(sketch).toBeVisible();
  await expect(
    sketch.getByRole("status").filter({ hasText: /draft point|Ready to draw/ }),
  ).toHaveText("Ready to draw.");
  await page.getByLabel("Sketch drawing canvas", { exact: true }).focus();
  await page.keyboard.press("f");
  await page.screenshot({ path: info.outputPath("sketch-workspace.png") });
  await page.keyboard.press("Escape");
  await expect(sketch).toHaveCount(0);
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute("data-retained-renderer", "original");
  expect(
    await page.evaluate(async () => {
      const path = "/src/viewer/cameraController.ts";
      return (await import(path)).captureCamera();
    }),
  ).toEqual(before);
});
