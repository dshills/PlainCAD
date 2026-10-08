import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importProjectText } from "../persistence/projectCodec";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { CadDocument } from "../cad/document/schema";
import type { ShopDrawing } from "../cad/inspection/shopDrawing";
import { generateDrawing } from "../fabrication/drawingClient";
import { useCadStore } from "../state/useCadStore";
import { beginDrawing, cancelDrawing, captureDrawingFrame, currentDrawingFrame, downloadShopDrawing, previewShopDrawing, useShopDrawing } from "../ui/commands/shopDrawingCommand";
vi.mock("../fabrication/drawingClient", () => ({ generateDrawing: vi.fn() }));
const worker = vi.mocked(generateDrawing);
function native(document: CadDocument) { const result = rebuildDocument(document); return { ...result, success: true, errors: [], meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade" as const, geometryAssertions: { valid: true as const, volume: 1000, surfaceArea: 700, solidCount: 1 } })) }; }
function drawing(): ShopDrawing { return { bodyId: "body:base", name: "Base", bounds: { min: [0, 0, 0], max: [20, 10, 5] }, dimensions: [20, 10, 5], sectionHeight: 2.5, sectionAreaMm2: 200, bores: [], bom: [{ number: 1, bodyId: "body:base", name: "Base", quantity: 1, volumeMm3: 1000, solids: 1 }], warnings: [], svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', bomCsv: "Item,Part\r\n1,Base" }; }
function setup() { const document = importProjectText(readFileSync("src/persistence/fixtures/schema-v13.pcaddoc", "utf8")); useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: 140, activeComponentId: document.rootComponentId, fileBusy: false, selection: { selectedIds: [] }, rebuild: { status: "succeeded", kernelReady: true, result: native(document) } }); beginDrawing(); worker.mockResolvedValue(drawing()); return { document, frame: captureDrawingFrame(useShopDrawing.getState().frame!, "body:base") }; }
beforeEach(() => { cancelDrawing(); worker.mockReset(); }); afterEach(() => { cancelDrawing(); useCadStore.setState(useCadStore.getInitialState()); });
it("generates an issued drawing without history changes and rejects forged or replaced-session downloads", async () => {
  const { document, frame } = setup(), preview = await previewShopDrawing(frame, new AbortController().signal, () => {});
  expect(useCadStore.getState().history.present).toBe(document); expect(useCadStore.getState().history.past).toEqual([]);
  expect(() => downloadShopDrawing({ ...preview }, "svg")).toThrow(/current native/);
  useCadStore.setState({ documentSession: 141 }); expect(currentDrawingFrame(frame)).toBe(false); expect(() => downloadShopDrawing(preview, "svg")).toThrow(/current native/);
});
it("discards a late drawing after cancellation or a changed accepted native result", async () => {
  const { frame } = setup(); let resolve!: (drawing: ShopDrawing) => void; worker.mockImplementationOnce(() => new Promise(deliver => { resolve = deliver; }));
  const pending = previewShopDrawing(frame, new AbortController().signal, () => {}); cancelDrawing(); resolve(drawing()); await expect(pending).rejects.toThrow(/stale/);
  const next = setup().frame;
  worker.mockImplementationOnce(() => new Promise(deliver => { resolve = deliver; }));
  const replaced = previewShopDrawing(next, new AbortController().signal, () => {});
  useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, result: { ...next.result } } });
  resolve(drawing()); await expect(replaced).rejects.toThrow(/stale/);
});
it("requires current native source identities and finite section heights", () => {
  const { frame } = setup(); expect(() => captureDrawingFrame(frame.owner, "lost-body")).toThrow(/reselect/); expect(() => captureDrawingFrame(frame.owner, frame.bodyId, NaN)).toThrow(/finite/);
  useCadStore.setState({ rebuild: { ...useCadStore.getState().rebuild, result: { ...frame.result, meshes: frame.result.meshes.map(mesh => ({ ...mesh, geometrySource: "fallback" })) } } }); expect(currentDrawingFrame(frame)).toBe(false);
});
