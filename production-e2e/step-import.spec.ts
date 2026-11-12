import { test } from "@playwright/test";
import { assertStepImportWorkflow } from "../e2e/stepImportAcceptance";

test("built STEP import validates the placed native solid, reopens and exports STL under CSP", async ({ page }, info) => {
  await assertStepImportWorkflow(page, info, true);
});
