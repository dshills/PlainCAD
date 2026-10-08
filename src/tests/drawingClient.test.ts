import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { generateDrawing, type DrawingRequest } from "../fabrication/drawingClient";
const fake = vi.hoisted(() => ({ worker: undefined as unknown as { onmessage?: (event: { data: unknown }) => void; request: DrawingRequest; terminate: ReturnType<typeof vi.fn> } }));
vi.mock("../fabrication/drawingWorker?worker", () => ({ default: class {
  request!: DrawingRequest; onmessage?: (event: { data: unknown }) => void; terminate = vi.fn(); constructor() { fake.worker = this; } postMessage(request: DrawingRequest) { this.request = request; }
} }));
beforeEach(() => vi.stubGlobal("Worker", class {})); afterEach(() => vi.unstubAllGlobals());
function reply(overrides: Record<string, unknown> = {}) { const request = fake.worker.request; fake.worker.onmessage?.({ data: { result: { requestId: request.requestId, session: request.session, documentId: request.document.id, drawing: { bodyId: request.bodyId, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', bom: [{}], bomCsv: "Item,Part", sectionAreaMm2: 200, sectionHeight: request.sectionHeight ?? 2.5 }, ...overrides } } }); }
it("rejects mismatched request/session identifiers from a drawing worker", async () => {
  const pending = generateDrawing({ document: createEmptyDocument(), bodyId: "body:box", session: 7 }, new AbortController().signal, () => {}); reply({ session: 8 }); await expect(pending).rejects.toThrow(/stale/); expect(fake.worker.terminate).toHaveBeenCalledTimes(1);
});
it("accepts only the exact requested section and rejects oversized CSV payloads", async () => {
  const pending = generateDrawing({ document: createEmptyDocument(), bodyId: "body:box", session: 7, sectionHeight: 3 }, new AbortController().signal, () => {}); reply(); await expect(pending).resolves.toMatchObject({ sectionHeight: 3 });
  const oversized = generateDrawing({ document: createEmptyDocument(), bodyId: "body:box", session: 7 }, new AbortController().signal, () => {}); const request = fake.worker.request; fake.worker.onmessage?.({ data: { result: { requestId: request.requestId, session: 7, documentId: request.document.id, drawing: { bodyId: request.bodyId, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', bom: [{}], bomCsv: "x".repeat(131073), sectionAreaMm2: 200, sectionHeight: 2.5 } } } }); await expect(oversized).rejects.toThrow(/resource limit/);
});
it("cancels worker ownership and refuses a native-less environment", async () => {
  const controller = new AbortController(), pending = generateDrawing({ document: createEmptyDocument(), bodyId: "body:box", session: 7 }, controller.signal, () => {}); controller.abort(); await expect(pending).rejects.toThrow(/cancelled/); expect(fake.worker.terminate).toHaveBeenCalledTimes(1);
  vi.stubGlobal("Worker", undefined); await expect(generateDrawing({ document: createEmptyDocument(), bodyId: "body:box", session: 7 }, new AbortController().signal, () => {})).rejects.toThrow(/native browser worker/);
});
