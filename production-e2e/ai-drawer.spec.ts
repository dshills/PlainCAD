import { test, expect } from "@playwright/test";
import { aiPlatePlan } from "../src/tests/fixtures/aiPlan";

test("built AI drawer fetches real gateway status under CSP; fixed AI recipes preview and apply native editable geometry", async ({
  page,
  request,
}) => {
  const status = await request.get("/api/ai/status");
  expect(status.ok()).toBe(true);
  const config = await status.json();
  expect(config.providers).toHaveLength(3);
  for (const provider of config.providers)
    expect(Object.keys(provider).sort()).toEqual([
      "available",
      "id",
      "label",
      "model",
    ]);
  expect(status.headers()["content-security-policy"]).toContain(
    "connect-src 'self'",
  );
  const violations: string[] = [];
  await page.exposeFunction("aiCspViolation", (directive: string) =>
    violations.push(directive),
  );
  await page.addInitScript(() =>
    window.document.addEventListener("securitypolicyviolation", (event) => {
      void (
        window as unknown as {
          aiCspViolation: (directive: string) => Promise<void>;
        }
      ).aiCspViolation(event.violatedDirective);
    }),
  );
  await page.goto("/");
  const browserStatus = await page.evaluate(async () => {
    const response = await fetch("/api/ai/status");
    return { status: response.status, json: await response.json() };
  });
  expect(browserStatus.status).toBe(200);
  expect(browserStatus.json).toEqual(config);
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      json: {
        providers: ["anthropic", "openai", "google"].map((id) => ({
          id,
          label: id,
          model: `test-${id}`,
          available: true,
        })),
      },
    }),
  );
  await page.route("**/api/ai/generate", (route) =>
    route.fulfill({ json: { plan: aiPlatePlan } }),
  );
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Open AI drawer" }).click();
  const drawer = page.getByRole("region", { name: "AI modeling assistant" });
  await drawer
    .getByLabel("What would you like to make?")
    .fill("A mounting plate with a through hole");
  await expect(
    drawer.getByRole("button", { name: "Generate preview" }),
  ).toBeEnabled();
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(
    drawer.getByRole("status", { name: "AI modeling status" }),
  ).toContainText("Native preview ready");
  await expect(drawer).toContainText(
    `${(12000 - 20 * Math.PI).toFixed(3)} mm³`,
  );
  await drawer.getByRole("button", { name: "Apply AI component" }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect(
    page.getByLabel("Parameter ai_1_thickness expression", { exact: true }),
  ).toHaveValue("5mm");
  await expect(page.locator(".feature-chip")).toHaveCount(2);
  // Let queued browser violation events cross the exposed-function boundary.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(violations).toEqual([]);
});
