import { expect, type Page } from "@playwright/test";

export async function openNewPartMenu(page: Page) {
  const options = page.getByRole("region", { name: "Start a part" });
  if (!await options.isVisible()) {
    const toggle = page.locator(".new-part-menu > summary");
    await expect(toggle).toBeVisible();
    if (!await options.isVisible()) await toggle.click();
  }
  await expect(options).toBeVisible();
}
