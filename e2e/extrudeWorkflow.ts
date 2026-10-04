import { expect, type Page } from "@playwright/test";
export async function applyExtrusion(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Extrude", exact: true });
  await expect(dialog.getByRole("status")).toContainText(
    "Native preview ready",
  );
  await dialog
    .getByRole("button", { name: "Apply extrusion", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
