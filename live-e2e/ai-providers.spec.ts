import { test, expect } from "@playwright/test";
import { AI_PROVIDERS, type AiProviderStatus } from "../src/ai/plan";
import { liveAiAcceptanceCases } from "../src/tests/fixtures/aiAcceptanceCorpus";
import {
  aiSnapshot,
  assertAiAcceptanceGeometry,
  assertAiAcceptanceViewer,
  assertAiAcceptanceSpan,
} from "../e2e/aiAcceptanceHelpers";

// Six ordinary gateway requests at most. Opt-in only; no retries or automatic repairs.
for (const provider of AI_PROVIDERS)
  for (const example of liveAiAcceptanceCases)
    test(`Live AI ${provider}: ${example.id}`, async ({
      page,
      request,
    }, info) => {
      test.skip(
        process.env.PLAINCAD_LIVE_AI !== "1",
        "Set PLAINCAD_LIVE_AI=1 to send paid provider requests using existing server environment keys.",
      );
      const response = await request.get("/api/ai/status");
      expect(response.ok()).toBe(true);
      const status: { providers: AiProviderStatus[] } = await response.json(),
        configuration = status.providers.find((p) => p.id === provider);
      test.skip(
        !configuration?.available,
        `${provider} has no configured server key.`,
      );
      if (!configuration) throw new Error("Missing provider configuration");
      info.annotations.push({
        type: "provider-model",
        description: `${provider}/${configuration.model}`,
      });
      await page.goto("/");
      await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
      await page
        .getByRole("button", { name: "New project", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Open AI drawer", exact: true })
        .click();
      const drawer = page.getByRole("region", {
        name: "AI modeling assistant",
      });
      if (!(await drawer.getByLabel("AI provider", { exact: true }).isVisible()))
        await drawer.getByText("AI settings", { exact: true }).click();
      await drawer
        .getByLabel("AI provider", { exact: true })
        .selectOption(provider);
      await expect(drawer.getByLabel("AI model", { exact: true })).toHaveValue(
        configuration.model,
      );
      const before = await aiSnapshot(page);
      await drawer
        .getByLabel("What would you like to make?")
        .fill(example.prompt);
      await drawer.getByRole("button", { name: "Generate preview" }).click();
      const apply = drawer.getByRole("button", { name: "Apply AI component" });
      await expect
        .poll(
          async () => {
            if (await drawer.getByRole("alert").count()) return "error";
            if (await apply.isEnabled()) return "ready";
            const status = await drawer
              .getByRole("status", { name: "AI modeling status" })
              .textContent();
            return status?.includes("More information")
              ? "clarification"
              : "pending";
          },
          { timeout: 125000 },
        )
        .not.toBe("pending");
      expect((await aiSnapshot(page)).document).toEqual(before.document);
      const errors = await drawer.getByRole("alert").allTextContents();
      if (errors.length) await expect(apply).toBeDisabled();
      expect(errors).toEqual([]);
      await expect(apply).toBeEnabled();
      await apply.click();
      await assertAiAcceptanceGeometry(page, example);
      await assertAiAcceptanceSpan(page, example);
      await assertAiAcceptanceViewer(page, example.bodies);
      const applied = await aiSnapshot(page);
      expect(applied.past).toBe(before.past + 1);
      if (example.id === "hollow-sleeve") {
        expect(Object.keys(applied.document.sketches)).toHaveLength(1);
        expect(
          Object.values(applied.result!.profiles ?? {}).some((profiles) =>
            profiles.some((p) => p.innerLoops.length === 1),
          ),
        ).toBe(true);
      } else
        expect(
          Object.values(applied.document.sketches).some(
            (sketch) =>
              sketch.plane.type === "face" ||
              (sketch.plane.type === "offset" &&
                typeof sketch.plane.base !== "string"),
          ),
        ).toBe(true);
    });
