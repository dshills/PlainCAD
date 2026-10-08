import { Blob as NodeBlob } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storyThumbnails } from "../ui/timeline/timelineStoryThumbnail";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";

afterEach(() => vi.unstubAllGlobals());

describe("history thumbnail camera and raster ownership", () => {
  it("depth-tests near and far native faces from +X/-Y/+Z, with a common frame and geometric culling", async () => {
    const canvases: Uint8ClampedArray[] = [];
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) { expect(width).toBe(208); expect(height).toBe(168); }
      getContext() { return { fillStyle: "", font: "", textAlign: "", createImageData(width: number, height: number) { return { data: new Uint8ClampedArray(width * height * 4) }; }, putImageData(image: { data: Uint8ClampedArray }) { canvases.push(image.data); }, fillText() {} }; }
      async convertToBlob() { return new NodeBlob(["native triangles"], { type: "image/png" }); }
    });
    const mesh = (bodyId: string, offset: number): RenderMesh => ({ id: bodyId, bodyId, positions: [offset, -offset, offset, 1 + offset, 1 - offset, offset, offset, 1 - offset, 1 + offset], normals: [1, -1, 1, 1, -1, 1, 1, -1, 1], indices: [0, 1, 2], bounds: { min: [0, 0, 0], max: [2, 2, 2] } });
    const far = mesh("far", 0), near = mesh("near", 2);
    // A smooth first-vertex normal may point away even though its geometric triangle is visible.
    near.normals = [0, 0, -1, 1, -1, 1, 1, -1, 1];
    const images = await storyThumbnails([far], [near, far], new Set(["near"]));
    expect(images.beforeImage).toMatch(/^data:image\/png;base64,/);
    const center = (106 * 208 + 104) * 4;
    expect(Array.from(canvases[0].slice(center, center + 4))).toEqual([142, 150, 157, 255]);
    // The farther gray triangle is submitted last, but cannot overwrite the nearer cyan triangle.
    expect(Array.from(canvases[1].slice(center, center + 4))).toEqual([53, 156, 173, 255]);
    const occupied = (pixels: Uint8ClampedArray) => Array.from({ length: 208 * 168 }, (_, index) => pixels[index * 4] !== 23).filter(Boolean).length;
    expect(occupied(canvases[1])).toBe(occupied(canvases[0]));
  });
  it("reports a clear browser capability error rather than rendering on the main thread", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    await expect(storyThumbnails([], [], new Set())).rejects.toThrow(/OffscreenCanvas support/);
  });
});
