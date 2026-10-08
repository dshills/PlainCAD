import { expect, test } from "@playwright/test";
import { workbenchTaskFixture } from "../e2e/workbenchTaskFixtures";

test("built timeline story renders native worker thumbnails under CSP with exact before and after volumes", async ({ page }) => {
  const errors: string[] = [], violations: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  await page.exposeFunction("captureStoryCsp", (directive: string) => violations.push(directive));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => { void (window as unknown as { captureStoryCsp(directive: string): Promise<void> }).captureStoryCsp(event.effectiveDirective); }));
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("worker-src 'self'");
  expect(requests.some(path => /timelineStoryWorker-.*\.js$/.test(path))).toBe(false);
  const fixture = workbenchTaskFixture("Hole");
  await page.locator('input[type="file"]').setInputFiles({ name: "story.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const history = page.getByRole("button", { name: "History", exact: true }); if (await history.isVisible()) await history.click();
  await page.locator(".feature-chip").filter({ hasText: "Drill" }).focus();
  const story = page.getByLabel("Build story: Drill", { exact: true });
  await expect(story).toHaveAttribute("data-native", "true", { timeout: 40000 });
  expect(Number(await story.getAttribute("data-before-volume"))).toBeCloseTo(24 * 16 * 8, 2);
  expect(Number(await story.getAttribute("data-after-volume"))).toBeCloseTo((24 * 16 - Math.PI) * 8, 2);
  await expect(story).toContainText("Remove material for a hole");
  await expect(story).toContainText("1 changed part in cyan");
  const images = await story.getByRole("img").evaluateAll(nodes => nodes.map(node => ({ source: (node as HTMLImageElement).src, width: (node as HTMLImageElement).naturalWidth })));
  expect(images).toHaveLength(2);
  expect(images.every(image => image.width === 208)).toBe(true); expect(images[0].source).not.toBe(images[1].source);
  expect(requests.some(path => /timelineStoryWorker-.*\.js$/.test(path))).toBe(true);
  expect(errors).toEqual([]); expect(violations).toEqual([]);
});
