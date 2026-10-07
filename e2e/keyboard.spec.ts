import { applyExtrusion } from "./extrudeWorkflow";
import { test, expect, type Page, type Locator } from "@playwright/test";

async function ready(page: Page) {
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
}
async function camera(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    const s = (await import(path)).inspectViewer();
    return {
      position: s.cameraPosition.map((n: number) => Number(n.toFixed(6))),
      target: s.cameraTarget.map((n: number) => Number(n.toFixed(6))),
      up: s.cameraUp,
    };
  });
}
async function trapped(page: Page, dialog: Locator) {
  for (const key of ["Tab", "Shift+Tab", "Tab", "Tab"]) {
    await page.keyboard.press(key);
    await expect
      .poll(() => dialog.evaluate((d) => d.contains(document.activeElement)))
      .toBe(true);
  }
}
test("keyboard palette traps/restores focus, runs available commands and isolates modal shortcuts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load parametric box template" })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "Create XY sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add center rectangle", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await applyExtrusion(page);
  await ready(page);
  await page.locator(".body-row button").first().click();
  const width = page.getByLabel("Parameter width expression");
  const canvas = page.locator(".viewer-region canvas");
  await canvas.hover();
  const fitted = await camera(page);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(async () => (await camera(page)).position)
    .not.toEqual(fitted.position);
  await width.focus();
  const selected = await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    return (await import(path)).useCadStore.getState().selection;
  });

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", {
    name: "Command Palette",
    exact: true,
  });
  const filter = dialog.getByLabel("Filter commands");
  await expect(filter).toBeFocused();
  await trapped(page, dialog);
  await filter.fill("no-such-command");
  await filter.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("No matching commands.");
  await dialog.getByRole("button", { name: "Close command palette" }).focus();
  const before = await camera(page);
  await page.keyboard.press("f");
  expect(await camera(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(width).toBeFocused();
  expect(
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts";
      return (await import(path)).useCadStore.getState().selection;
    }),
  ).toEqual(selected);

  await page.keyboard.press("Control+k");
  await filter.fill("Top View");
  await filter.press("ArrowDown");
  await expect(dialog.getByRole("button", { name: /Top View/ })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(filter).toBeFocused();
  await filter.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(width).toBeFocused();
  await expect.poll(async () => (await camera(page)).up).toEqual([0, 1, 0]);
  const top = await camera(page);
  expect(top.position[0]).toBeCloseTo(top.target[0], 6);
  expect(top.position[1]).toBeCloseTo(top.target[1], 6);
  expect(top.position[2]).toBeGreaterThan(top.target[2]);

  await page.keyboard.press("Control+k");
  await filter.fill("Fillet");
  await expect(
    dialog.locator('button[data-command="feature.fillet"]'),
  ).toBeDisabled();
  await expect(
    dialog.locator('button[data-command="feature.edit"]'),
  ).toBeDisabled();
  // The broad query also finds the available operation-target picker through
  // its Fillet description. Exercise Enter with only the disabled command.
  await expect(
    dialog.locator('button[data-command="feature.operationTargets"]'),
  ).toBeEnabled();
  await filter.fill("Fillet Extrusion Edges");
  await expect(
    dialog.locator('button[data-command="feature.fillet"]'),
  ).toBeDisabled();
  await expect(
    dialog.locator('button[data-command="feature.operationTargets"]'),
  ).toHaveCount(0);
  await filter.press("Enter");
  await expect(dialog).toBeVisible();
  await filter.fill("Export STL");
  await filter.press("Enter");
  await expect(dialog).toHaveCount(0);
  const exportDialog = page.getByRole("dialog", { name: "STL export options" });
  await expect(exportDialog).toBeVisible();
  await expect
    .poll(() =>
      exportDialog.evaluate((d) => d.contains(document.activeElement)),
    )
    .toBe(true);
  await trapped(page, exportDialog);
  // Radio groups contribute one native tab stop, even when an earlier radio
  // exists in DOM order. Both save and STL goals must wrap focus inside the modal.
  for (const name of ["Save editable project (.pcaddoc)", "Export for printing (.stl)"]) {
    const goal = exportDialog.getByRole("radio", { name, exact: false });
    await goal.check();
    await goal.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(exportDialog.getByRole("button", { name: /^Cancel (save|export)$/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(goal).toBeFocused();
  }
  // Native groups can also start unchecked. Either radio remains at the same
  // group boundary; restore the normal goal through its control after the probe.
  const goals = exportDialog.getByRole("radio");
  await goals.evaluateAll((nodes) => nodes.forEach((node) => {
    (node as HTMLInputElement).checked = false;
  }));
  for (const index of [0, 1]) {
    await goals.nth(index).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(exportDialog.getByRole("button", { name: /^Cancel (save|export)$/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(goals.first()).toBeFocused();
  }
  await exportDialog.getByRole("radio", { name: "Export for printing (.stl)", exact: false }).check();
  await page.keyboard.press("Control+k");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(exportDialog).toHaveCount(0);
  await expect(width).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(filter).toHaveValue("");
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await expect(width).toBeFocused();
  expect(errors).toEqual([]);
});

test("recovery is keyboard modal and Escape retains stored snapshots", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load parametric box template" })
    .click();
  await ready(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Autosaved locally" }),
  ).toBeVisible();
  await page.reload();
  const dialog = page.getByRole("dialog", { name: "Recover unsaved project" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((d) => d.contains(document.activeElement)))
    .toBe(true);
  await trapped(page, dialog);
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Command Palette" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Recovery kept" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    dialog.getByRole("button", { name: "Recover Parametric Box", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Recover Parametric Box", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await ready(page);
  await expect(page.getByLabel("Parameter width expression")).toHaveValue(
    "80mm",
  );
});
