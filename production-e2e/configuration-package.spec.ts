import { test } from "@playwright/test";
import { configurationPackageAcceptance } from "../e2e/configurationPackageAcceptance";

test("built fabrication package proves the same native variant under CSP", async ({ page }, info) => {
  await configurationPackageAcceptance(page, info);
});
