import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createBoxTemplate } from "../src/templates/templates";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";

test.use({ storageState: { cookies: [], origins: [] } });

async function drop(page: Page, text: string, name: string, count = 1) {
  const data = await page.evaluateHandle(
    ({ text, name, count }) => {
      const transfer = new DataTransfer();
      for (let i = 0; i < count; i++)
        transfer.items.add(
          new File([text], name, { type: "application/json" }),
        );
      return transfer;
    },
    { text, name, count },
  );
  try {
    await page
      .locator(".app-shell")
      .dispatchEvent("dragover", { dataTransfer: data });
    await expect(
      page.getByText(
        "One .pcaddoc or .json file. Open replaces the current project.",
      ),
    ).toBeVisible();
    await page
      .locator(".app-shell")
      .dispatchEvent("drop", { dataTransfer: data });
  } finally {
    await data.dispose();
  }
}
async function nativeVolume(page: Page, expected: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.meshes).toHaveLength(1);
    expect(state.result!.meshes[0]).toMatchObject({
      geometrySource: "opencascade",
      geometryAssertions: { valid: true, solidCount: 1 },
    });
    expect(state.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(
      expected,
      6,
    );
  }).toPass({ timeout: 30000 });
}

test("project drops validate, preserve current work until confirmed, and retain native edits/save/open/STL", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const document = createBoxTemplate();
  await drop(page, JSON.stringify(document), "box.pcaddoc");
  await nativeVolume(page, 80000);
  expect((await aiSnapshot(page)).document.id).toBe(document.id);
  await page
    .getByRole("group", { name: "Project dock tabs" })
    .getByRole("button", { name: "Parameters", exact: true })
    .click();
  const depth = page.getByLabel("Parameter depth expression", { exact: true });
  await depth.fill("8mm");
  await depth.press("Enter");
  await nativeVolume(page, 32000);
  const edited = await aiSnapshot(page);
  for (const [text, name, count] of [
    ["{bad json", "broken.pcaddoc", 1],
    [JSON.stringify(document), "part.stl", 1],
    [JSON.stringify(document), "two.json", 2],
  ] as const) {
    await drop(page, text, name, count);
    await expect(
      page.getByRole("alert").filter({ hasText: "File error" }),
    ).toBeVisible();
    expect((await aiSnapshot(page)).document).toEqual(edited.document);
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  }
  await drop(page, JSON.stringify(document), "box.json");
  const confirm = page.getByRole("dialog", { name: "Open dropped project" });
  await expect(confirm).toBeVisible();
  expect((await aiSnapshot(page)).document).toEqual(edited.document);
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await nativeVolume(page, 32000);
  await drop(page, JSON.stringify(document), "box.json");
  await confirm.getByRole("button", { name: "Keep current project" }).click();
  await expect(confirm).toBeHidden();
  expect((await aiSnapshot(page)).document).toEqual(edited.document);
  await drop(page, JSON.stringify(document), "box.json");
  const saved = page.waitForEvent("download");
  await confirm.getByRole("button", { name: "Save current and open" }).click();
  const path = info.outputPath("preserved-box.pcaddoc");
  await (await saved).saveAs(path);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    id: document.id,
    parameters: { depth: { expression: "8mm" } },
  });
  await expect(confirm).toBeHidden();
  await nativeVolume(page, 80000);
  // Reopen the portable copy preserved by the confirmation action.
  await page.locator('input[type="file"]').setInputFiles(path);
  await nativeVolume(page, 32000);
  await page.locator(".file-menu > summary").click();
  const exportEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("dropped-box.stl");
  await (await exportEvent).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(32000, 2);
});
