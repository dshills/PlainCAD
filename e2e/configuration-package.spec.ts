import { test } from "@playwright/test";
import { configurationPackageAcceptance } from "./configurationPackageAcceptance";

test("packages a compared native configuration without applying it", async ({ page }, info) => {
  await configurationPackageAcceptance(page, info);
});
