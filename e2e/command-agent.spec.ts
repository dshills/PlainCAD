import { test } from "@playwright/test";
import { commandAgentAcceptance } from "./commandAgentAcceptance";

test("built-in command agent clarifies, previews and applies from the main task panel with AI Undo and Redo", async ({ page }) => {
  test.setTimeout(180000);
  await commandAgentAcceptance(page);
});
