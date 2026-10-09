import { test } from "@playwright/test";
import { liveSessionAcceptance } from "./liveSessionAcceptance";

test("external live requests edit the already-open project, preserve selection and share native Undo", async ({ page, request, baseURL }) => {
  test.setTimeout(150000);
  await liveSessionAcceptance({ page, request, baseURL });
});
