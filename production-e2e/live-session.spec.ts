import { test } from "@playwright/test";
import { liveSessionAcceptance } from "../e2e/liveSessionAcceptance";

test("built live relay and CLI edit the current project with native geometry and shared Undo", async ({ page, request, baseURL }) => {
  test.setTimeout(150000);
  await liveSessionAcceptance({ page, request, baseURL });
});
