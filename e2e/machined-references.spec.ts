import { test } from "@playwright/test";
import { machinedReferencesAcceptance } from "./machinedReferencesAcceptance";

test("native pocket floor and hole rim are selectable, measurable and durable", async ({ page }, info) => {
  await machinedReferencesAcceptance(page, info);
});
