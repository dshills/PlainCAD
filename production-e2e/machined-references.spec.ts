import { test } from "@playwright/test";
import { machinedReferencesAcceptance } from "../e2e/machinedReferencesAcceptance";

test("built pocket floor and hole rim use the native worker under CSP", async ({ page }, info) => {
  await machinedReferencesAcceptance(page, info);
});
