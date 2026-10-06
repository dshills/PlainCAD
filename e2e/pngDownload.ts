import { expect, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

export async function inspectPngDownload(page: Page, download: Download, path: string) {
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  expect(width).toBeGreaterThan(100);
  expect(height).toBeGreaterThan(100);
  expect(Math.max(width, height)).toBeLessThanOrEqual(4096);
  const pixels = await page.evaluate(async (src) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Invalid PNG")); image.src = src; });
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set<string>();
    let foreground = 0, opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255) opaque++;
      if (Math.abs(data[i] - data[0]) + Math.abs(data[i + 1] - data[1]) + Math.abs(data[i + 2] - data[2]) > 30) foreground++;
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return { foreground, opaque, colors: colors.size, width: canvas.width, height: canvas.height };
  }, `data:image/png;base64,${bytes.toString("base64")}`);
  expect(pixels.foreground).toBeGreaterThan(1000);
  expect(pixels.colors).toBeGreaterThan(10);
  expect(pixels.opaque).toBe(width * height);
  return { bytes, pixels };
}
