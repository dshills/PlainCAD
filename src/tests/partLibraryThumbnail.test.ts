import { afterEach, expect, it, vi } from "vitest";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import { libraryThumbnail } from "../persistence/partLibraryThumbnail";
vi.mock("../persistence/pngCapture", () => ({ canvasPng: vi.fn(async () => {
  // Minimal bounded PNG header for the encoder boundary; native Chromium checks actual pixels.
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  bytes[19] = 192;
  bytes[23] = 192;
  return { size: bytes.length, arrayBuffer: async () => bytes.buffer };
}) }));
afterEach(() => vi.restoreAllMocks());
it("saved part and project covers preserve the native viewer's isometric coordinate orientation", async () => {
  const context = { fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  const mesh = {
    id: "triangle", bodyId: "body", geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1, volume: 1, surfaceArea: 1 },
    positions: [0, 0, 0, 2, 0, 0, 0, 2, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], bounds: { min: [0, 0, 0], max: [2, 2, 0] },
  } as RenderMesh;
  await expect(libraryThumbnail([mesh])).resolves.toMatch(/^data:image\/png;base64,/);
  const origin = context.moveTo.mock.calls[0], [xAxis, yAxis] = context.lineTo.mock.calls;
  expect(xAxis[0]).toBeCloseTo(yAxis[0]);
  expect(xAxis[0]).toBeGreaterThan(origin[0]);
  expect(xAxis[1]).toBeGreaterThan(yAxis[1]);
});
it("draws the nearer native-facing triangle last when their projected footprints overlap", async () => {
  const colors: string[] = [];
  const context = {
    fillStyle: "", fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    fill: () => colors.push(context.fillStyle),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  const mesh: RenderMesh = {
    id: "overlap", bodyId: "body", geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1, volume: 1, surfaceArea: 1 },
    // The first triangle is shifted toward (+X,-Y,+Z), retaining the same screen footprint.
    positions: [1, -1, 1, 3, -1, 1, 1, 1, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
    indices: [0, 1, 2, 3, 5, 4], bounds: { min: [0, -1, 0], max: [3, 2, 1] },
  };
  await libraryThumbnail([mesh]);
  expect(colors).toEqual(["rgb(29, 43, 41)", "rgb(109, 162, 157)"]);
});
