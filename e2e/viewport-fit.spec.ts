import { expect, test, type Page } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";

test.use({ storageState: { cookies: [], origins: [] } });

async function expectCompleteBounds(page: Page) {
  await expect(async () => {
    const positions = await page.evaluate(async () => {
      const diagnostics = "/src/viewer/viewerDiagnostics.ts", storePath = "/src/state/useCadStore.ts";
      const { projectViewerPoint } = await import(diagnostics);
      const { useCadStore } = await import(storePath);
      const canvas = document.querySelector<HTMLCanvasElement>(".viewer-canvas canvas")!;
      const { width, height } = canvas.getBoundingClientRect();
      return useCadStore.getState().rebuild.result.meshes.flatMap((mesh: { bounds: { min: number[]; max: number[] } }) => {
        const { min, max } = mesh.bounds;
        return [min[0], max[0]].flatMap((x) => [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z) => {
          const point = projectViewerPoint([x, y, z]);
          return point && { x: point.x / width, y: point.y / height, depth: point.depth };
        })));
      });
    });
    expect(positions.length).toBeGreaterThan(0);
    for (const point of positions) {
      expect(point).toBeDefined();
      expect(point.x).toBeGreaterThan(0.03);
      expect(point.x).toBeLessThan(0.97);
      expect(point.y).toBeGreaterThan(0.03);
      expect(point.y).toBeLessThan(0.97);
      expect(Math.abs(point.depth)).toBeLessThan(1);
    }
  }).toPass();
}

test("fitted native model remains wholly visible through docks and compact resize; explicit camera poses remain unchanged", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles("docs/examples/orbit-drive-housing.pcaddoc");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const original = await aiSnapshot(page);
  expect(original.result!.meshes[0].geometrySource).toBe("opencascade");
  await page.getByRole("button", { name: "Fit model in viewport", exact: true }).click();
  await expectCompleteBounds(page);
  await page.getByRole("button", { name: "Toggle task dock", exact: true }).click();
  await expectCompleteBounds(page);
  await page.getByRole("button", { name: "Close Parts", exact: true }).click();
  await expectCompleteBounds(page);
  await page.setViewportSize({ width: 685, height: 740 });
  await page.getByRole("button", { name: "Fit model in viewport", exact: true }).click();
  await expectCompleteBounds(page);
  const pose = await page.evaluate(async () => {
    const path = "/src/viewer/cameraController.ts", controller = await import(path);
    const pose = controller.captureCamera();
    if (!controller.restoreCamera(pose)) throw new Error("Camera pose was not restored");
    return pose;
  });
  await page.setViewportSize({ width: 1200, height: 740 });
  const resizedPose = await page.evaluate(async () => {
    const path = "/src/viewer/cameraController.ts";
    return (await import(path)).captureCamera();
  });
  for (const key of ["cameraPosition", "cameraTarget", "cameraUp"] as const) {
    for (let axis = 0; axis < 3; axis++) expect(resizedPose[key][axis]).toBeCloseTo(pose[key][axis], 9);
  }
  const after = await aiSnapshot(page);
  expect(after.document).toEqual(original.document);
  expect(after.result).toEqual(original.result);
  expect(after.past).toBe(original.past);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("fitted-model-docks.png"), fullPage: true });
});
