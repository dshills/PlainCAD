import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AI_PROVIDERS } from "../src/ai/plan";
import { aiAcceptanceCorpus } from "../src/tests/fixtures/aiAcceptanceCorpus";
import {
  aiSnapshot,
  assertAiAcceptanceGeometry,
  assertAiAcceptanceViewer,
  assertAiAcceptanceSpan,
  stlSignedVolume,
} from "./aiAcceptanceHelpers";

for (const example of aiAcceptanceCorpus)
  test(`AI corpus: ${example.id}`, async ({ page }, info) => {
    await page.route("**/api/ai/status", (route) =>
      route.fulfill({
        json: {
          providers: AI_PROVIDERS.map((id) => ({
            id,
            label: id,
            available: id === "anthropic",
            model: `test-${id}`,
          })),
        },
      }),
    );
    const prompts: unknown[] = [];
    await page.route("**/api/ai/generate", (route) => {
      prompts.push(route.request().postDataJSON().prompt);
      return route.fulfill({ json: { plan: example.plan } });
    });
    await page.goto("/");
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open AI drawer", exact: true })
      .click();
    const drawer = page.getByRole("region", { name: "AI modeling assistant" }),
      before = await aiSnapshot(page);
    await drawer
      .getByLabel("What would you like to make?")
      .fill(example.prompt);
    await drawer.getByRole("button", { name: "Generate preview" }).click();
    const apply = drawer.getByRole("button", { name: "Apply AI component" });
    await expect(apply).toBeEnabled();
    expect((await aiSnapshot(page)).document).toEqual(before.document);
    await apply.click();
    await assertAiAcceptanceGeometry(page, example);
    await assertAiAcceptanceViewer(page, example.bodies);
    const original = await aiSnapshot(page),
      meshes = original.result!.meshes;
    expect(original.past).toBe(before.past + 1);
    await assertAiAcceptanceSpan(page, example);
    expect(prompts).toEqual([example.prompt]);
    if (example.id !== "mounting-plate") return;
    const extrusion = original.document.features.find(
      (f) => f.type === "extrude",
    );
    if (extrusion?.type !== "extrude")
      throw new Error("Mounting fixture requires extrusion");
    const refs = Object.values(extrusion.distance.parameterRefs ?? {}),
      parameter = Object.values(original.document.parameters).find((p) =>
        refs.includes(p.id),
      );
    if (!parameter)
      throw new Error("Mounting fixture requires a bound thickness");
    const input = page.getByLabel(`Parameter ${parameter.name} expression`, {
      exact: true,
    });
    await input.fill("6mm");
    await input.press("Enter");
    await assertAiAcceptanceGeometry(
      page,
      example,
      (example.volume / (example.span.max - example.span.min)) * 6,
    );
    expect((await aiSnapshot(page)).result!.meshes[0].bodyId).toBe(
      meshes[0].bodyId,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await assertAiAcceptanceGeometry(page, example);
    const saved = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const path = info.outputPath("corpus-plate.pcaddoc");
    await (await saved).saveAs(path);
    const old = await aiSnapshot(page);
    await page.locator('input[type="file"]').setInputFiles(path);
    await expect
      .poll(async () => (await aiSnapshot(page)).session)
      .toBeGreaterThan(old.session);
    await assertAiAcceptanceGeometry(page, example);
    await assertAiAcceptanceViewer(page, example.bodies);
    const exported = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stlPath = info.outputPath("corpus-plate.stl");
    await (await exported).saveAs(stlPath);
    const volume = stlSignedVolume(await readFile(stlPath));
    expect(volume).toBeGreaterThan(0);
    expect(Math.abs(volume / example.volume - 1)).toBeLessThan(0.01);
    expect(prompts).toEqual([example.prompt]);
  });
