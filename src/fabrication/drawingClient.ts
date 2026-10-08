import DrawingWorker from "./drawingWorker?worker";
import { backgroundJob } from "../persistence/backgroundJob";
import type { CadDocument } from "../cad/document/schema";
import type { ShopDrawing } from "../cad/inspection/shopDrawing";
export interface DrawingRequest { requestId: number; session: number; document: CadDocument; bodyId: string; sectionHeight?: number }
export interface DrawingReply { requestId: number; session: number; documentId: string; drawing: ShopDrawing }
let nextRequest = 0;
export async function generateDrawing(input: Omit<DrawingRequest, "requestId">, signal: AbortSignal, progress: (message: string) => void) {
  if (typeof Worker === "undefined") throw new Error("Shop drawings require a native browser worker.");
  const request: DrawingRequest = { ...input, requestId: ++nextRequest };
  const reply = await backgroundJob<DrawingRequest, DrawingReply>(DrawingWorker, request, signal, progress, 60000);
  const drawing = reply?.drawing;
  if (!reply || reply.requestId !== request.requestId || reply.session !== request.session || reply.documentId !== request.document.id || !drawing || drawing.bodyId !== request.bodyId || typeof drawing.svg !== "string" || !drawing.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') || !drawing.svg.endsWith("</svg>") || new TextEncoder().encode(drawing.svg).byteLength > 8 * 1024 * 1024 || !Array.isArray(drawing.bom) || !drawing.bom.length || drawing.bom.length > 64 || typeof drawing.bomCsv !== "string" || !Number.isFinite(drawing.sectionAreaMm2) || drawing.sectionAreaMm2 <= 0 || !Number.isFinite(drawing.sectionHeight) || (request.sectionHeight !== undefined && request.sectionHeight !== drawing.sectionHeight)) throw new Error("Drawing worker returned stale or malformed sheet data.");
  if (new TextEncoder().encode(drawing.bomCsv).byteLength > 128 * 1024) throw new Error("Drawing parts list exceeds its resource limit.");
  return drawing;
}
