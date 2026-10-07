import { expect, test, type Page } from "@playwright/test";
import { aiSnapshot } from "./aiAcceptanceHelpers";

async function clickLocal(page: Page, x: number, y: number) {
  const canvas = page.getByLabel("Sketch drawing canvas", { exact: true });
  const bounds = await canvas.boundingBox();
  const view = (await canvas.getAttribute("viewBox"))!.split(" ").map(Number);
  if (!bounds) throw new Error("Sketch canvas unavailable");
  await page.mouse.click(
    Math.round(bounds.x + ((x - view[0]) / view[2]) * bounds.width),
    Math.round(bounds.y + ((-y - view[1]) / view[3]) * bounds.height),
  );
}

test("new sketch diagnostics keep the pointer drawing coordinate frame stationary", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  await page.getByRole("button", { name: "Create XZ sketch", exact: true }).click();
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  await page.getByRole("button", { name: "Edit sketch canvas", exact: true }).click();
  const canvas = page.getByLabel("Sketch drawing canvas", { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("rectangle");
  await expect(page.getByRole("button", { name: /^Model issues/ })).toHaveCount(0);
  const before = await canvas.boundingBox();
  expect(before).not.toBeNull();
  await clickLocal(page, 0, 0);
  await clickLocal(page, 40, 30);
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  await expect(page.getByRole("button", { name: /^Model issues/ })).toHaveCount(0);
  const drawn = await aiSnapshot(page);
  const sketchId = Object.keys(drawn.document.sketches)[0];
  expect(drawn.result!.warnings).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: `sketch:${sketchId}:dof` }),
  ]));
  const after = await canvas.boundingBox();
  expect(after).not.toBeNull();
  for (const coordinate of ["x", "y", "width", "height"] as const) {
    expect(after![coordinate]).toBeCloseTo(before![coordinate], 5);
  }
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("line");
  await clickLocal(page, 0, 12);
  await clickLocal(page, 40, 12);
  await page.getByRole("button", { name: "Finish Sketch", exact: true }).click();
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("succeeded");
  const snapshot = await aiSnapshot(page);
  const sketch = Object.values(snapshot.document.sketches)[0];
  const divider = snapshot.result!.solvedSketches![sketch.id].lines.find(
    (line) => line.start.y === 12 && line.end.y === 12,
  );
  expect(divider).toBeDefined();
  expect([divider!.start.x, divider!.end.x]).toEqual([0, 40]);
  expect(snapshot.result!.profiles![sketch.id]).toHaveLength(2);
});
