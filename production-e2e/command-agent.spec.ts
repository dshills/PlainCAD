import { test } from "@playwright/test";
import { commandAgentAcceptance } from "../e2e/commandAgentAcceptance";

test("built command agent previews native geometry and applies with AI Undo and Redo", async ({ page }) => {
  test.setTimeout(180000);
  await commandAgentAcceptance(page);
});
