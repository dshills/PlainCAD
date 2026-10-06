import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { selectCommandEnablement } from "../ui/commands/commandRegistry";
import { exportPng } from "../persistence/exportPng";
import { canvasPng, capturePng, pngSize, registerPngCapture, sketchPng } from "../persistence/pngCapture";
import { useFileJobs } from "../persistence/fileJobs";
import { downloadArrayBuffer } from "../persistence/exportProject";
vi.mock("../persistence/exportProject", async (original) => ({ ...(await original<object>()), downloadArrayBuffer: vi.fn() }));

const initial = useCadStore.getState();
const canvasInitial = useSketchCanvas.getState();
let unregister: (() => void) | undefined;
afterEach(() => {
  unregister?.();
  unregister = undefined;
  useFileJobs.getState().cancel();
  useSketchCanvas.setState(canvasInitial, true);
  useCadStore.setState(initial, true);
  vi.clearAllMocks();
});
function fixture() {
  const document = createBoxTemplate();
  useCadStore.setState({
    history: { past: [], present: document, future: [] }, documentSession: 77, fileBusy: false,
    selection: { selectedIds: [{ kind: "body", id: "box", documentId: document.id }] },
    rebuild: { status: "succeeded", kernelReady: true, result: {
      documentId: document.id, success: true, errors: [], warnings: [], durationMs: 1,
      bodies: [{ id: "box", name: "Box part" }],
      meshes: [{ id: "mesh", bodyId: "box", positions: [], normals: [], indices: [], bounds: { min: [0, 0, 0], max: [80, 50, 20] } }],
    } }, fileError: undefined,
  });
  return document;
}
const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
function blob() { return { arrayBuffer: async () => bytes } as Blob; }

describe("PNG downloads", () => {
  it("uses the selected body's identity/name without changing the document or selection", async () => {
    const document = fixture(), selection = useCadStore.getState().selection;
    const capture = vi.fn(async () => blob());
    unregister = registerPngCapture("viewer", capture);
    await exportPng("body");
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ document, session: 77, bodyId: "box" }));
    expect(downloadArrayBuffer).toHaveBeenCalledWith(bytes, "Box_part.png", "image/png");
    expect(useCadStore.getState().history.present).toBe(document);
    expect(useCadStore.getState().selection).toBe(selection);
    expect(useFileJobs.getState().busy).toBe(false);
  });
  it.each(["edit", "replace", "result", "cancel"])("rejects a %s while pixels are encoding", async (change) => {
    const document = fixture();
    let finish!: (image: Blob) => void;
    unregister = registerPngCapture("viewer", () => new Promise((resolve) => { finish = resolve; }));
    const job = exportPng("project");
    expect(useFileJobs.getState().busy).toBe(true);
    const state = useCadStore.getState();
    if (change === "edit") useCadStore.setState({ history: { ...state.history, present: { ...document, name: "Edited" } } });
    if (change === "replace") useCadStore.setState({ documentSession: 78 });
    if (change === "result") useCadStore.setState({ rebuild: { ...state.rebuild, result: { ...state.rebuild.result! } } });
    if (change === "cancel") useFileJobs.getState().cancel();
    finish(blob());
    await job;
    expect(downloadArrayBuffer).not.toHaveBeenCalled();
    if (change !== "cancel") expect(useCadStore.getState().fileError).toMatch(/changed during PNG export/);
    expect(useFileJobs.getState().busy).toBe(false);
  });
  it("reports capture/encoding errors and releases file-job ownership", async () => {
    fixture();
    unregister = registerPngCapture("viewer", async () => { throw new Error("PNG encoding failed"); });
    await exportPng("project");
    expect(useCadStore.getState().fileError).toBe("PNG encoding failed");
    expect(useFileJobs.getState().busy).toBe(false);
    expect(downloadArrayBuffer).not.toHaveBeenCalled();
  });
  it("allows a solved open sketch independently of solid geometry and rejects a replaced sketch session", async () => {
    const document = fixture(), sketch = Object.values(document.sketches)[0];
    useCadStore.setState({ rebuild: { status: "failed", kernelReady: false }, selection: { selectedIds: [] } });
    useSketchCanvas.setState({ active: { documentId: document.id, session: 77, sketchId: sketch.id } });
    const capture = vi.fn(async () => blob());
    unregister = registerPngCapture("sketch", capture);
    expect(selectCommandEnablement(useCadStore.getState()).exportSketchPng).toBe(true);
    await exportPng("sketch");
    expect(downloadArrayBuffer).toHaveBeenCalledWith(bytes, "Box_Base.png", "image/png");
    vi.mocked(downloadArrayBuffer).mockClear();
    useSketchCanvas.setState({ active: { documentId: document.id, session: 76, sketchId: sketch.id } });
    await exportPng("sketch");
    expect(useCadStore.getState().fileError).toMatch(/Open a sketch/);
    expect(downloadArrayBuffer).not.toHaveBeenCalled();
  });
  it("requires current successful solid geometry, a selected body, and no file job", () => {
    fixture();
    expect(selectCommandEnablement(useCadStore.getState())).toMatchObject({ exportProjectPng: true, exportBodyPng: true, exportSketchPng: false });
    useCadStore.setState({ selection: { selectedIds: [] } });
    expect(selectCommandEnablement(useCadStore.getState()).exportBodyPng).toBe(false);
    useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, status: "rebuilding" } });
    expect(selectCommandEnablement(useCadStore.getState()).exportProjectPng).toBe(false);
    useCadStore.setState({ fileBusy: true });
    expect(selectCommandEnablement(useCadStore.getState()).exportProjectPng).toBe(false);
  });
  it("caps image allocation with preserved aspect ratio and diagnoses unavailable views/encoders", async () => {
    expect(pngSize(10000, 5000)).toEqual({ width: 4096, height: 2048 });
    expect(() => pngSize(0, 10)).toThrow(/visible area/);
    expect(() => pngSize(Infinity, 10)).toThrow(/visible area/);
    const drawing = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    drawing.getBoundingClientRect = () => ({ width: 100, height: 80 }) as DOMRect;
    expect(() => sketchPng(drawing)).toThrow(/coordinate frame/);
    expect(() => capturePng("viewer", { document: fixture(), session: 77 })).toThrow(/unavailable/);
    const canvas = { toBlob: (done: BlobCallback) => done(null) } as HTMLCanvasElement;
    await expect(canvasPng(canvas)).rejects.toThrow(/encode the PNG/);
  });
});
