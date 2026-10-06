import { focusedWorkspaceStorageState } from "./workspaceStorage";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  aiSnapshot,
  stlSignedVolume,
  assertAiAcceptanceViewer,
} from "./aiAcceptanceHelpers";
import { applyExtrusion } from "./extrudeWorkflow";
// Keep minimal-workspace compatibility coverage separate from the new default workbench suite.
test.use({
  storageState: focusedWorkspaceStorageState("http://127.0.0.1:5279"),
});
async function volume(page: Page, expected: number) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.success).toBe(true);
    expect(state.result?.meshes).toHaveLength(1);
    const mesh = state.result!.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(
      Math.abs(mesh.geometryAssertions!.volume / expected - 1),
    ).toBeLessThan(1e-7);
  }).toPass({ timeout: 30000 });
}
async function clickLocal(page: Page, x: number, y: number) {
  const svg = page.getByRole("group", {
    name: "Sketch drawing canvas",
    exact: true,
  });
  await svg.scrollIntoViewIfNeeded();
  const bounds = await svg.boundingBox();
  if (!bounds) throw new Error("Drawing canvas unavailable");
  const view = (await svg.getAttribute("viewBox"))!.split(/\s+/).map(Number);
  // Match the pointer handler's border-box coordinates, avoiding padding offsets.
  await page.mouse.click(
    Math.round(bounds.x + ((x - view[0]) / view[2]) * bounds.width),
    Math.round(bounds.y + ((-y - view[1]) / view[3]) * bounds.height),
  );
}
test("focused sketch deletion cleans references, rejects typing, diagnoses lost native profiles and restores geometry through undo/save/open", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page
    .getByRole("button", { name: "Sketch on Top (XY) plane", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw tool: rectangle", exact: true })
    .click();
  await clickLocal(page, 0, 0);
  await page.getByLabel("Draft width", { exact: true }).fill("20mm");
  await page.getByLabel("Draft height", { exact: true }).fill("12mm");
  await page.getByLabel("Draft height", { exact: true }).press("Enter");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page
    .getByRole("button", { name: "Draw tool: circle", exact: true })
    .click();
  await page
    .getByRole("toolbar", { name: "Drawing tools" })
    .getByLabel("Construction", { exact: true })
    .check();
  // Keep the construction-circle anchor clear of the rectangle's size labels.
  await clickLocal(page, 55, 35);
  await page.getByLabel("Draft diameter", { exact: true }).fill("6mm");
  await page.getByLabel("Draft diameter", { exact: true }).press("Enter");
  const full = await aiSnapshot(page);
  const sketch = Object.values(full.document.sketches)[0];
  const circle = Object.values(sketch.entities).find(
    (e) => e.type === "circle",
  )!;
  const centerId = circle.type === "circle" ? circle.centerPointId : "";
  await page
    .getByRole("button", { name: "Draw tool: select", exact: true })
    .click();
  await clickLocal(page, 58, 35);
  await expect(
    page.getByLabel("Selected sketch item", { exact: true }),
  ).toHaveValue(circle.id);
  await expect(page.getByText(/Removes 2 geometry item/)).toBeVisible();
  await page.keyboard.press("Backspace");
  const withoutCircle = await aiSnapshot(page);
  expect(
    withoutCircle.document.sketches[sketch.id].entities[circle.id],
  ).toBeUndefined();
  expect(
    withoutCircle.document.sketches[sketch.id].entities[centerId],
  ).toBeUndefined();
  expect(withoutCircle.document.sketches[sketch.id].dimensions).toHaveLength(2);
  expect(withoutCircle.past).toBe(full.past + 1);
  await expect(page.locator(`[data-point-id="${centerId}"]`)).toHaveCount(0);
  await expect(page.locator(".canvas-point")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
  await applyExtrusion(page);
  await volume(page, 1200);
  const solid = await aiSnapshot(page);
  await page.getByRole("button", { name: /^History \(/ }).click();
  await page
    .getByRole("list", { name: "Sketch and feature history" })
    .getByRole("button")
    .filter({ has: page.getByText(sketch.name, { exact: true }) })
    .click();
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  const line = Object.values(sketch.entities).find((e) => e.type === "line")!;
  await page
    .getByRole("button", { name: "Draw tool: select", exact: true })
    .click();
  await clickLocal(page, 10, 0);
  await expect(
    page.getByLabel("Selected sketch item", { exact: true }),
  ).toHaveValue(line.id);
  await page
    .getByRole("button", { name: "Edit selected size", exact: true })
    .click();
  const input = page.getByLabel("Sketch size expression", { exact: true });
  await input.fill("20mm");
  await input.press("Backspace");
  expect((await aiSnapshot(page)).document).toEqual(solid.document);
  await page
    .getByRole("button", { name: "Cancel size edit", exact: true })
    .click();
  await page
    .getByLabel("Selected sketch item", { exact: true })
    .selectOption(line.id);
  await page
    .getByRole("button", { name: "Delete selected sketch item", exact: true })
    .click();
  await expect(page.locator(".rebuild-pill")).toHaveText("failed");
  const deleted = await aiSnapshot(page);
  expect(
    deleted.document.sketches[sketch.id].entities[line.id],
  ).toBeUndefined();
  expect(deleted.document.sketches[sketch.id].dimensions).toHaveLength(1);
  expect(deleted.document.sketches[sketch.id].constraints).toHaveLength(3);
  expect(deleted.document.features).toEqual(solid.document.features);
  expect(deleted.past).toBe(solid.past + 1);
  // Both endpoints still belong to the neighboring rectangle edges.
  await expect(page.locator(".canvas-point")).toHaveCount(4);
  expect(
    deleted.result?.errors.some(
      (e) => e.source === "feature" && /profile.*not found/i.test(e.message),
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const broken = info.outputPath("deleted-profile.pcaddoc");
  await (await save).saveAs(broken);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await volume(page, 1200);
  expect((await aiSnapshot(page)).document.sketches[sketch.id]).toEqual(
    solid.document.sketches[sketch.id],
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("failed");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await volume(page, 1200);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("restored-profile.stl");
  await (await download).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(1200, 2);
  await page.locator('input[type="file"]').setInputFiles(broken);
  await expect(page.locator(".rebuild-pill")).toHaveText("failed");
  expect((await aiSnapshot(page)).document.sketches[sketch.id]).toEqual(
    deleted.document.sketches[sketch.id],
  );
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeDisabled();
  const historyButton = page.getByRole("button", { name: /^History \(/ });
  if ((await historyButton.getAttribute("aria-expanded")) !== "true")
    await historyButton.click();
  await page
    .getByRole("list", { name: "Sketch and feature history" })
    .getByRole("button")
    .filter({ has: page.getByText(sketch.name, { exact: true }) })
    .click();
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw tool: select", exact: true })
    .click();
  const remaining = Object.values(
    deleted.document.sketches[sketch.id].entities,
  ).filter((e) => e.type === "line");
  // Rectangle creation inserts perimeter edges in cyclic order. The first edge
  // was removed above, so these form a three-edge chain ordered from one end.
  for (const [index, edge] of remaining.entries()) {
    await page
      .getByLabel("Selected sketch item", { exact: true })
      .selectOption(edge.id);
    await page
      .getByRole("button", { name: "Delete selected sketch item", exact: true })
      .click();
    await expect(page.locator(".canvas-point")).toHaveCount([3, 2, 0][index]);
  }
  expect(
    (await aiSnapshot(page)).document.sketches[sketch.id].entities,
  ).toEqual({});
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".canvas-point")).toHaveCount(2);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".canvas-point")).toHaveCount(0);
});
test("focused mouse sketch, native extrude/cut, parameter edit, save/open and STL work without the full workspace", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await expect(page.getByLabel("Workspace layout")).toHaveValue("focused");
  await expect(
    page.getByRole("heading", { name: "Dependencies" }),
  ).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Parametric Timeline" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page
    .getByRole("button", { name: "Sketch on Top (XY) plane", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw tool: rectangle", exact: true })
    .click();
  await clickLocal(page, -10, -5);
  await clickLocal(page, 10, 5);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
  await applyExtrusion(page);
  await volume(page, 1000);
  const initial = await aiSnapshot(page);
  const base = initial.result!.meshes[0].bodyId;
  const bodyName = initial.result!.bodies.find((b) => b.id === base)!.name;
  await page
    .getByRole("button", { name: "Create sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sketch on Top (XY) plane", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw tool: circle", exact: true })
    .click();
  await clickLocal(page, 0, 0);
  await clickLocal(page, 2, 0);
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Extrude", exact: true });
  await dialog
    .getByLabel("Extrude operation", { exact: true })
    .selectOption("cut");
  await dialog
    .getByLabel("Extrude termination", { exact: true })
    .selectOption("throughAll");
  await dialog.getByRole("checkbox", { name: bodyName, exact: true }).check();
  await applyExtrusion(page);
  await volume(page, (200 - 4 * Math.PI) * 5);
  await page.getByLabel("Task panel").selectOption("parameters");
  await page
    .getByRole("button", { name: "Add Parameter", exact: true })
    .click();
  await page.getByLabel("Task panel").selectOption("auto");
  await page.getByRole("button", { name: /^History \(/ }).click();
  const doc = (await aiSnapshot(page)).document;
  const history = page.getByRole("list", {
    name: "Sketch and feature history",
  });
  await history
    .getByRole("button")
    .filter({ has: page.getByText(doc.features[0].name, { exact: true }) })
    .click();
  await page.getByLabel("Distance", { exact: true }).fill("param_1");
  await page.getByLabel("Distance", { exact: true }).press("Enter");
  await volume(page, (200 - 4 * Math.PI) * 10);
  await page.getByLabel("Task panel").selectOption("parameters");
  await page
    .getByLabel("Parameter param_1 expression", { exact: true })
    .fill("6mm");
  await page
    .getByLabel("Parameter param_1 expression", { exact: true })
    .press("Enter");
  await volume(page, (200 - 4 * Math.PI) * 6);
  const finalMesh = (await aiSnapshot(page)).result!.meshes[0];
  expect(finalMesh.bodyId).toBe(base);
  // Native BRep bounds include a small modeling tolerance. Verify orientation in mm.
  for (const [actual, expected] of [
    [finalMesh.bounds.min, [-10, -5, 0]],
    [finalMesh.bounds.max, [10, 5, 6]],
  ] as const) {
    actual.forEach((value, axis) =>
      expect(Math.abs(value - expected[axis])).toBeLessThan(1e-6),
    );
  }
  await assertAiAcceptanceViewer(page, 1);
  const save = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("focused.pcaddoc");
  await (await save).saveAs(path);
  const json = JSON.parse(await readFile(path, "utf8"));
  function assertDurableKeys(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      expect([
        "workspace",
        "activePanel",
        "pins",
        "kernelHandle",
        "sheet",
        "partsOpen",
        "historyOpen",
      ]).not.toContain(key);
      assertDurableKeys(child);
    }
  }
  assertDurableKeys(json);
  const before = await aiSnapshot(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await aiSnapshot(page)).session)
    .toBeGreaterThan(before.session);
  await volume(page, (200 - 4 * Math.PI) * 6);
  const exportFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stl = info.outputPath("focused.stl");
  await (await exportFile).saveAs(stl);
  expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(
    (200 - 4 * Math.PI) * 6,
    0,
  );
  await page.screenshot({ path: info.outputPath("focused-model.jpg") });
});
test("AI settings, full access, pins and layout persistence preserve the current document", async ({
  page,
}) => {
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      json: {
        providers: ["anthropic", "openai", "google"].map((id) => ({
          id,
          label: id,
          model: `test-${id}`,
          available: false,
        })),
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const before = await aiSnapshot(page);
  await page.getByRole("button", { name: "Describe a part with AI" }).click();
  const drawer = page.getByRole("region", { name: "AI modeling assistant" });
  await expect(drawer.getByLabel("AI provider", { exact: true })).toBeHidden();
  await expect(
    drawer.getByText(/key not configured; open AI settings/),
  ).toBeVisible();
  await drawer.getByText("AI settings", { exact: true }).click();
  await expect(drawer.getByLabel("AI provider", { exact: true })).toBeVisible();
  await drawer
    .getByRole("button", { name: "Close AI drawer", exact: true })
    .click();
  await page.getByLabel("Task panel").selectOption("parameters");
  await page.getByRole("button", { name: "Pin Parameters panel" }).click();
  await page.getByLabel("Task panel").selectOption("views");
  await expect(page.getByRole("heading", { name: "Parameters" })).toBeVisible();
  await page.getByLabel("Workspace layout").selectOption("full");
  await expect(
    page.getByRole("heading", { name: "Dependencies" }),
  ).toBeVisible();
  await page.getByLabel("Workspace layout").selectOption("focused");
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await page.reload();
  await expect(page.getByLabel("Workspace layout")).toHaveValue("focused");
  await expect(
    page.getByRole("button", { name: "Pin Parameters panel" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "All tools", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Filter commands" }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Filter commands" })
    .fill("Create XZ");
  await expect(
    page
      .getByRole("dialog", { name: "Command Palette" })
      .getByRole("button", { name: /Create XZ Sketch/ }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "All tools", exact: true }),
  ).toBeFocused();
});
test("compact focused layout keeps the start canvas and one details sheet usable across themes", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Start a part" }),
  ).toBeVisible();
  for (const theme of ["light", "dark", "saturn"]) {
    await page.getByText("Settings", { exact: true }).click();
    await page.getByLabel("UI theme", { exact: true }).selectOption(theme);
    await page.getByText("Settings", { exact: true }).click();
    await page.getByRole("button", { name: "Parts", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Parts browser" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pin Parts panel" }).click();
    await page.getByLabel("Task panel").selectOption("views");
    await expect(
      page.getByRole("complementary", { name: "Parts browser" }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Parts", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Parts", exact: true }).click();
    await page.getByRole("button", { name: "Pin Parts panel" }).click();
    await page.getByRole("button", { name: "Close Parts" }).click();
    await expect(
      page.getByRole("button", { name: "Parts", exact: true }),
    ).toBeFocused();
    await page.getByLabel("Task panel").selectOption("views");
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(760);
    await page.getByLabel("Task panel").selectOption("auto");
    await page.screenshot({ path: info.outputPath(`focused-${theme}.jpg`) });
  }
});

for (const plane of ["XY", "XZ", "YZ"] as const) {
  test(`focused precise sketch sizes on ${plane} drive native geometry, inline edits, undo and saved STL`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await page
      .getByRole("button", { name: "Draw a shape", exact: true })
      .click();
    const name = { XY: "Top", XZ: "Front", YZ: "Side" }[plane];
    await page
      .getByRole("button", {
        name: `Sketch on ${name} (${plane}) plane`,
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Canvas tool", { exact: true })).toBeHidden();
    await page
      .getByRole("button", { name: "Draw tool: rectangle", exact: true })
      .click();
    await clickLocal(page, 0, 0);
    await page.getByLabel("Draft width", { exact: true }).fill("2cm");
    await page.getByLabel("Draft height", { exact: true }).fill("12");
    await page.getByLabel("Draft height", { exact: true }).press("Enter");
    await expect(
      page.getByRole("form", { name: "Draft shape size" }),
    ).toBeHidden();
    const drawn = await aiSnapshot(page);
    const sketchId = Object.keys(drawn.document.sketches)[0];
    const sketch = drawn.document.sketches[sketchId];
    expect(sketch.dimensions).toHaveLength(2);
    expect(sketch.constraints).toHaveLength(4);
    await page
      .getByRole("button", { name: "Finish Sketch", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Extrude selected sketch", exact: true })
      .click();
    await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
    await applyExtrusion(page);
    await volume(page, 1200);
    const bounds = (await aiSnapshot(page)).result!.meshes[0].bounds;
    const expected = {
      XY: [
        [0, 0, 0],
        [20, 12, 5],
      ],
      XZ: [
        [0, -5, 0],
        [20, 0, 12],
      ],
      YZ: [
        [0, 0, 0],
        [5, 20, 12],
      ],
    }[plane];
    [bounds.min, bounds.max].forEach((b, i) =>
      b.forEach((v, axis) => expect(v).toBeCloseTo(expected[i][axis], 5)),
    );
    // Reopen the sketch through its history entry, then change the existing width label.
    await page.getByRole("button", { name: /^History \(/ }).click();
    await page
      .getByRole("list", { name: "Sketch and feature history" })
      .getByRole("button")
      .filter({ has: page.getByText(sketch.name, { exact: true }) })
      .click();
    await page
      .getByRole("button", { name: "Edit sketch canvas", exact: true })
      .click();
    const label = page.locator(
      `g[data-dimension-id="${sketch.dimensions[0].id}"]`,
    );
    await label.focus();
    await label.press("Enter");
    await expect(
      page.getByLabel("Sketch size expression", { exact: true }),
    ).toBeFocused();
    await page.getByLabel("Sketch size expression", { exact: true }).fill("30");
    await page
      .getByLabel("Sketch size expression", { exact: true })
      .press("Enter");
    await expect(
      page.getByRole("group", { name: "Sketch drawing canvas", exact: true }),
    ).toBeFocused();
    await volume(page, 1800);
    const edited = await aiSnapshot(page);
    expect(edited.document.sketches[sketchId].dimensions[0].id).toBe(
      sketch.dimensions[0].id,
    );
    await page
      .getByRole("button", { name: "Finish Sketch", exact: true })
      .click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await volume(page, 1200);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await volume(page, 1800);
    await assertAiAcceptanceViewer(page, 1);
    const save = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const file = info.outputPath(`precise-${plane}.pcaddoc`);
    await (await save).saveAs(file);
    await page.locator('input[type="file"]').setInputFiles(file);
    await volume(page, 1800);
    expect((await aiSnapshot(page)).document.sketches[sketchId]).toEqual(
      edited.document.sketches[sketchId],
    );
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const stl = info.outputPath(`precise-${plane}.stl`);
    await (await download).saveAs(stl);
    expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(1800, 2);
  });
}

test("focused mouse drags, cancellation and circle size edits preserve analytic geometry and expose dimension failures", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page
    .getByRole("button", { name: "Sketch on Top (XY) plane", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Draw tool: rectangle", exact: true })
    .click();
  const svg = page.getByRole("group", {
    name: "Sketch drawing canvas",
    exact: true,
  });
  async function screenPoint(x: number, y: number) {
    const b = (await svg.boundingBox())!,
      v = (await svg.getAttribute("viewBox"))!.split(/\s+/).map(Number);
    return {
      x: b.x + ((x - v[0]) / v[2]) * b.width,
      y: b.y + ((-y - v[1]) / v[3]) * b.height,
    };
  }
  const a = await screenPoint(0, 0),
    b = await screenPoint(20, 12);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  // An unrelated pointer release must not steal the active mouse capture.
  await svg.dispatchEvent("pointerup", {
    pointerId: 999,
    clientX: a.x,
    clientY: a.y,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        Object.values(
          Object.values((await aiSnapshot(page)).document.sketches)[0].entities,
        ).filter((e) => e.type === "line").length,
    )
    .toBe(4);
  const before = await aiSnapshot(page);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 100, b.y);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await page
    .getByRole("button", { name: "Draw tool: circle", exact: true })
    .click();
  await clickLocal(page, 10, 6);
  await page.getByLabel("Draft diameter", { exact: true }).fill("4mm");
  await page.getByLabel("Draft diameter", { exact: true }).press("Enter");
  await expect(
    page.getByRole("form", { name: "Draft shape size" }),
  ).toBeHidden();
  const sketch = Object.values((await aiSnapshot(page)).document.sketches)[0];
  const circleDimension = sketch.dimensions[0];
  const label = page.locator(`g[data-dimension-id="${circleDimension.id}"]`);
  await label.focus();
  await label.press("Enter");
  await page
    .getByLabel("Sketch size expression", { exact: true })
    .fill("missing");
  await page
    .getByLabel("Sketch size expression", { exact: true })
    .press("Enter");
  await expect(page.locator(".rebuild-pill")).toHaveText("failed");
  await expect(label).toHaveAccessibleName(/unavailable/);
  await expect(page.getByLabel("Canvas tool", { exact: true })).toBeHidden();
  expect(
    await page.getByRole("alert").filter({ hasText: "missing" }).count(),
  ).toBeGreaterThan(0);
  await label.focus();
  await label.press("Enter");
  await page.getByLabel("Sketch size expression", { exact: true }).fill("6mm");
  await page
    .getByLabel("Sketch size expression", { exact: true })
    .press("Enter");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  // Circle drag follows the same primitive path; construction must stay out of the solid profile.
  await page
    .getByRole("button", { name: "Draw tool: circle", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Construction", exact: true })
    .check();
  const center = await screenPoint(50, 30),
    radius = await screenPoint(54, 30);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(radius.x, radius.y, { steps: 6 });
  await page.mouse.up();
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(
      state.result?.solvedSketches?.[sketch.id].circles.find(
        (c) => c.construction,
      )?.radius,
    ).toBeCloseTo(4, 7);
  }).toPass();
  const beforeBlur = await aiSnapshot(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(radius.x + 50, radius.y);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  expect((await aiSnapshot(page)).document).toEqual(beforeBlur.document);
  expect((await aiSnapshot(page)).past).toBe(beforeBlur.past);
  await page.screenshot({ path: info.outputPath("direct-sketch.jpg") });
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await page.getByLabel("Extrude distance", { exact: true }).fill("5mm");
  await applyExtrusion(page);
  await volume(page, (240 - 9 * Math.PI) * 5);
});

test("compact sketch size drafts and selected dimensions remain usable across themes", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Draw a shape", exact: true }).click();
  await page
    .getByRole("button", { name: "Sketch on Top (XY) plane", exact: true })
    .click();
  for (const theme of ["light", "dark", "saturn"]) {
    await page.getByText("Settings", { exact: true }).click();
    await page.getByLabel("UI theme", { exact: true }).selectOption(theme);
    await page.getByText("Settings", { exact: true }).click();
    await page
      .getByRole("button", { name: "Draw tool: rectangle", exact: true })
      .click();
    await clickLocal(page, 50, 50);
    const form = page.getByRole("form", { name: "Draft shape size" });
    await page.getByLabel("Draft width", { exact: true }).fill("20mm");
    await page.getByLabel("Draft height", { exact: true }).fill("12mm");
    await page
      .getByRole("button", { name: "Accept shape", exact: true })
      .scrollIntoViewIfNeeded();
    const bounds = (await form.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(760);
    await page.screenshot({
      path: info.outputPath(`sketch-draft-${theme}.jpg`),
    });
    await page
      .getByRole("button", { name: "Cancel shape", exact: true })
      .click();
  }
  expect(
    Object.values(
      Object.values((await aiSnapshot(page)).document.sketches)[0].entities,
    ),
  ).toHaveLength(0);
});
