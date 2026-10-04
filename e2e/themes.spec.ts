import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
import { THEME_STORAGE_KEY, viewerThemeColors } from "../src/ui/themes/themes";

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts";
    const state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      past: state.history.past.length,
      rebuild: state.rebuild,
    };
  });
}
async function viewer(page: Page): Promise<ViewerSnapshot> {
  return page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).inspectViewer()!;
  });
}
async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.rebuild.status).toBe("succeeded");
    if (volume !== undefined) {
      const mesh = state.rebuild.result!.meshes[0];
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 5);
    }
  }).toPass();
}
function stlVolume(bytes: Buffer) {
  const triangles = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + triangles * 50);
  let volume = 0;
  for (let i = 0; i < triangles; i++) {
    const p = Array.from({ length: 9 }, (_, j) =>
      bytes.readFloatLE(96 + i * 50 + j * 4),
    );
    expect(p.every(Number.isFinite)).toBe(true);
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return volume;
}

for (const theme of ["light", "dark", "saturn"] as const) {
  test(`${theme}: local theme preserves native geometry/camera, dialogs, save/open and STL`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await ready(page);
    await page
      .getByRole("button", { name: "Load parametric box template" })
      .click();
    await ready(page, 80000);
    await expect.poll(async () => (await viewer(page)).meshes.length).toBe(1);
    await page.getByRole("button", { name: "Fit view", exact: true }).click();
    // Allow OrbitControls damping to settle before comparing poses.
    await expect(async () => {
      const a = await viewer(page),
        b = await viewer(page);
      a.cameraPosition.forEach((value, axis) =>
        expect(value).toBeCloseTo(b.cameraPosition[axis], 8),
      );
    }).toPass();
    const before = await snapshot(page),
      view = await viewer(page);
    await page.getByLabel("UI theme", { exact: true }).selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect
      .poll(async () => (await viewer(page)).background)
      .toBe(viewerThemeColors[theme].background.slice(1));
    expect(await snapshot(page)).toEqual(before);
    const themedView = await viewer(page);
    themedView.cameraPosition.forEach((value, axis) =>
      expect(value).toBeCloseTo(view.cameraPosition[axis], 8),
    );
    themedView.cameraTarget.forEach((value, axis) =>
      expect(value).toBeCloseTo(view.cameraTarget[axis], 8),
    );
    expect(themedView.meshes).toEqual(view.meshes);
    expect(themedView.resources).toEqual(view.resources);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        THEME_STORAGE_KEY,
      ),
    ).toBe(theme);

    // Check actual rendered foreground/background pairs, rather than token names.
    const contrast = await page.evaluate(() => {
      const luminance = (color: string) => {
        // These controls have explicitly opaque backgrounds. Refuse a format or
        // alpha channel this Chromium-only sRGB contrast check cannot evaluate.
        if (!/^rgb\([\d.\s,]+\)$/.test(color))
          throw new Error(`Expected opaque RGB color, received ${color}`);
        const [r, g, b] = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => {
            const s = n / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return [
        ".left-panel",
        ".rebuild-pill.succeeded",
        ".row input",
        ".theme-control select",
      ].map((selector) => {
        const element = document.querySelector(selector)!;
        const style = getComputedStyle(element),
          a = luminance(style.color),
          b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    });
    contrast.forEach((ratio) => expect(ratio).toBeGreaterThanOrEqual(4.5));
    await page.screenshot({ path: info.outputPath(`${theme}-workspace.png`) });
    await page.getByLabel("UI theme", { exact: true }).focus();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Command Palette" });
    await expect(palette).toBeVisible();
    expect(
      await palette.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toBe(
      await page.locator("html").evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor =
          getComputedStyle(element).getPropertyValue("--surface");
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      }),
    );
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("UI theme", { exact: true })).toBeFocused();
    await page.locator(".sketch-chip").first().click();
    await page
      .getByRole("button", { name: "Edit sketch canvas", exact: true })
      .click();
    await page
      .getByLabel("Sketch drawing canvas", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${theme}-sketch.png`) });
    await page
      .getByRole("button", { name: "Done editing sketch", exact: true })
      .click();

    const width = page.getByLabel("Parameter width expression", {
      exact: true,
    });
    await width.fill("100mm");
    await width.press("Enter");
    await ready(page, 100000);
    const save = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    const saved = await save,
      path = info.outputPath("themed.pcaddoc");
    await saved.saveAs(path);
    expect(JSON.parse(await readFile(path, "utf8"))).not.toHaveProperty(
      "theme",
    );
    await page.reload();
    await expect(page.getByLabel("UI theme", { exact: true })).toHaveValue(
      theme,
    );
    await expect(page.locator(".autosave-status")).not.toHaveText(
      "Checking recovery storage…",
    );
    const recovery = page.getByRole("dialog", {
      name: "Recover unsaved project",
    });
    if (await recovery.isVisible()) await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await page.locator('input[type="file"]').setInputFiles(path);
    await ready(page, 100000);
    const stl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export STL", exact: true }).click();
    const exported = await stl,
      stlPath = info.outputPath("themed.stl");
    await exported.saveAs(stlPath);
    expect(stlVolume(await readFile(stlPath))).toBeCloseTo(100000, 3);
    expect(errors).toEqual([]);
  });
}
