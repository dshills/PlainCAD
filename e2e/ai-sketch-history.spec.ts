import { expect, test } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { workbenchTaskFixture } from "./workbenchTaskFixtures";

test("sketch history requests run locally before provider consent and preserve active native sketch geometry", async ({ page }) => {
  let providerRequests = 0;
  await page.route("**/api/ai/status", route => route.fulfill({ json: { providers: ["anthropic", "openai", "google"].map(id => ({ id, label: id, available: false, model: "unused" })) } }));
  await page.route("**/api/ai/sketch", async route => { providerRequests += 1; await route.abort(); });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "Editable.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(workbenchTaskFixture("Extrude"))) });
  await expect(async () => expect((await aiSnapshot(page)).result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(3072, 5)).toPass();
  await page.getByRole("button", { name: "Section XY plane, 8 entities", exact: true }).click();
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  const before = await aiSnapshot(page);
  await page.getByLabel("Sketch refinement request").fill("undo that");
  await page.getByRole("button", { name: "Preview sketch refinement", exact: true }).click();
  await expect(page.getByLabel("Sketch refinement status")).toContainText("The latest AI change cannot be");
  await page.getByLabel("Sketch refinement method").selectOption("provider");
  await expect(page.getByLabel("Provider sketch refinement status")).toContainText("No AI provider is configured");
  await page.getByLabel("Provider sketch request").fill("redo that");
  await expect(page.getByRole("checkbox", { name: /^Allow sending/ })).not.toBeChecked();
  await page.getByRole("button", { name: "Generate AI sketch preview", exact: true }).click();
  await expect(page.getByLabel("Provider sketch refinement status")).toContainText("The latest AI change cannot be");
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  expect(providerRequests).toBe(0);
});
