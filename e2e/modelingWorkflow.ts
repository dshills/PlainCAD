import { expect, type Page } from "@playwright/test";
export async function applyModeling(
  page: Page,
  name: "Revolve" | "Fillet" | "Chamfer",
) {
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog.getByRole("status")).toContainText(
    "Native preview ready",
  );
  await dialog
    .getByRole("button", { name: `Apply ${name.toLowerCase()}`, exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
