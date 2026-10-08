import { expect, test } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { workbenchTaskFixture } from "./workbenchTaskFixtures";

test("same-face AI hole and pocket follow-ups preserve native geometry and require fresh consent", async ({ page }) => {
  const requests: Array<{ prompt: string; history: unknown[]; featureContext: unknown }> = [];
  await page.route("**/api/ai/status", route => route.fulfill({ json: { providers: ["anthropic", "openai", "google"].map(id => ({ id, label: id, available: true, model: "test-model" })) } }));
  await page.route("**/api/ai/features", async route => {
    requests.push(route.request().postDataJSON());
    const actions = requests.length < 3
      ? [{ kind: "holes", centers: [{ x: "5mm", y: "5mm" }], diameter: requests.length === 1 ? "-2mm" : "2mm", depth: "throughAll" }]
      : [{ kind: "pocket", profile: { type: "rectangle", x: "10mm", y: "5mm", width: "4mm", height: "4mm" }, depth: "2mm" }];
    await route.fulfill({ json: { proposal: { summary: "Add the requested cut", warnings: [], actions } } });
  });
  await page.goto("/");
  const fixture = workbenchTaskFixture("Extrude");
  await page.locator('input[type="file"]').setInputFiles({ name: "Plate.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(async () => expect((await aiSnapshot(page)).result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(3072, 5)).toPass();
  await page.getByRole("button", { name: "Open AI assistant", exact: true }).click();
  await page.getByRole("button", { name: "Add features to this part", exact: true }).click();
  const panel = page.getByLabel("AI feature additions", { exact: true });
  const prompt = panel.getByLabel("Feature request"), generate = panel.getByRole("button", { name: "Generate AI feature preview" }), consent = panel.getByRole("checkbox");
  await prompt.fill("fix that"); await generate.click();
  await expect(panel.getByRole("status")).toContainText("Which issue should I fix"); expect(requests).toHaveLength(0);
  await panel.getByLabel("Feature target face").selectOption(`extrude:${fixture.features[0].id}:endCap`);
  await prompt.fill("Add one 2mm mounting hole at 5,5"); await consent.check();
  const before = await aiSnapshot(page);
  await generate.click(); await expect(panel.getByRole("alert")).toContainText("positive");
  await prompt.fill("repair this"); await generate.click();
  const apply = panel.getByRole("button", { name: "Apply AI feature plan" });
  await expect(apply).toBeEnabled({ timeout: 60000 });
  expect(requests[0].prompt).toBe("Add one 2mm mounting hole at 5,5");
  expect(requests[1].prompt).toContain("Add one 2mm mounting hole at 5,5");
  expect(requests[1].prompt).toContain("positive");
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect(await panel.locator("canvas").count()).toBe(0);
  await apply.click(); await expect(consent).not.toBeChecked();
  const holeVolume = 3072 - Math.PI * 8;
  await expect(async () => expect((await aiSnapshot(page)).result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(holeVolume, 5)).toPass();
  await expect(panel.getByRole("status")).toContainText("same native face is ready");
  await prompt.fill("Now add a 4x4mm pocket at 10,5, 2mm deep"); await expect(generate).toBeDisabled(); expect(requests).toHaveLength(2);
  await consent.check(); await generate.click(); await expect(apply).toBeEnabled({ timeout: 60000 });
  expect(requests[2].history).toHaveLength(4);
  expect(requests[2].featureContext).toEqual(requests[1].featureContext); // The same cap bounds and stable IDs survive this interior hole.
  const nativePreview = await page.evaluate(async () => {
    const path = "/src/state/aiCanvasPreview.ts", { useAiCanvasPreview } = await import(path), proposal = useAiCanvasPreview.getState().preview;
    return { before: proposal?.beforeResult.meshes[0].geometryAssertions?.volume, after: proposal?.result.meshes[0].geometryAssertions?.volume };
  });
  expect(nativePreview.before).toBeCloseTo(holeVolume, 5);
  expect(nativePreview.after).toBeCloseTo(holeVolume - 32, 5);
  expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  expect((await aiSnapshot(page)).result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(holeVolume, 5);
  await apply.click();
  await expect(async () => expect((await aiSnapshot(page)).result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(holeVolume - 32, 5)).toPass();
  await expect(consent).not.toBeChecked();
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", { useCadStore } = await import(path), state = useCadStore.getState();
    useCadStore.setState({ rebuild: { ...state.rebuild, result: { ...state.rebuild.result, availableFaces: [] } } });
  });
  await expect(panel.getByRole("status")).toContainText("target face is no longer supported");
  await expect(generate).toBeDisabled();
  expect(requests).toHaveLength(3);
});
