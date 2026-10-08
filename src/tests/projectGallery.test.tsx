import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectGalleryPanel } from "../ui/workspace/ProjectGalleryPanel";
import { beginProjectGallery, closeProjectGallery } from "../ui/workspace/projectGalleryState";
import { GALLERY_EXAMPLES } from "../ui/workspace/projectGalleryCatalog";
import { projectComplexity } from "../persistence/projectGallery";
import { galleryPreviewFaces, drawGalleryPreview } from "../viewer/galleryPreview";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
vi.mock("../persistence/autosave", () => ({ listRecoveryRecords: vi.fn(async () => []) }));
vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn() }));
vi.mock("../ui/commands/projectDropCommand", () => ({ prepareProjectDrop: vi.fn() }));
afterEach(() => { closeProjectGallery(); vi.restoreAllMocks(); });
describe("Project gallery", () => {
  it("remains absent until explicitly opened", () => {
    render(<ProjectGalleryPanel/>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows all ten real examples and filters by name or complexity", async () => {
    act(() => beginProjectGallery()); render(<ProjectGalleryPanel/>);
    await waitFor(() => expect(screen.getByText("Save a project to add it here.")).toBeTruthy());
    expect(screen.getAllByRole("img")).toHaveLength(10);
    expect(GALLERY_EXAMPLES.every(example => example.projectUrl && example.thumbnail)).toBe(true);
    fireEvent.change(screen.getByLabelText("Find a project"), { target: { value: "Highly complex" } });
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Open Cable guide mount" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close gallery" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("provides honest complexity categories", () => {
    expect(projectComplexity(2, 4)).toBe("Beginner");
    expect(projectComplexity(6, 16)).toBe("Intermediate");
    expect(projectComplexity(11, 22)).toBe("Advanced");
    expect(projectComplexity(40, 68)).toBe("Highly complex");
  });
  it("declines fabricated, invalid and excessive mesh previews", () => {
    expect(() => galleryPreviewFaces([])).toThrow("valid native");
    expect(() => galleryPreviewFaces([{ geometrySource: "fallback" } as RenderMesh])).toThrow("valid native");
    expect(() => galleryPreviewFaces([{ geometrySource: "opencascade", geometryAssertions: { valid: true }, indices: new Array(30003), positions: [], normals: [] } as unknown as RenderMesh])).toThrow("10,000");
  });
  it("matches native viewer coordinate orientation and validates each mesh's triangle indices", () => {
    const mesh = { geometrySource: "opencascade", geometryAssertions: { valid: true }, positions: [0, 0, 0, 2, 0, 0, 0, 2, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] } as unknown as RenderMesh;
    const geometry = galleryPreviewFaces([mesh]);
    const context = { fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn() };
    drawGalleryPreview({ width: 240, height: 200, getContext: () => context } as unknown as HTMLCanvasElement, geometry, 0);
    const origin = context.moveTo.mock.calls[0], [xAxis, yAxis] = context.lineTo.mock.calls;
    expect(xAxis[0]).toBeCloseTo(yAxis[0]); expect(xAxis[0]).toBeGreaterThan(origin[0]); expect(xAxis[1]).toBeGreaterThan(yAxis[1]);
    expect(() => galleryPreviewFaces([{ ...mesh, indices: [0, 1] }, { ...mesh, indices: [0, 1, 2, 0] }])).toThrow("incomplete");
    expect(() => galleryPreviewFaces([{ ...mesh, indices: [0, 1, 9] }])).toThrow("vertex indices");
  });
  it("renders different orientations from actual native triangle positions", () => {
    const faces = galleryPreviewFaces([{ geometrySource: "opencascade", geometryAssertions: { valid: true }, positions: [0, 0, 0, 3, 0, 0, 0, 1, 2], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] } as unknown as RenderMesh]);
    const context = { fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn() };
    const canvas = { width: 240, height: 200, getContext: () => context } as unknown as HTMLCanvasElement;
    drawGalleryPreview(canvas, faces, 0);
    const first = context.lineTo.mock.calls.map(call => [...call]);
    context.lineTo.mockClear(); drawGalleryPreview(canvas, faces, 0.4);
    expect(context.lineTo.mock.calls).not.toEqual(first);
    expect(context.fill).toHaveBeenCalledTimes(2);
  });
});
