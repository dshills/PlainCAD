import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";

export interface PngCaptureRequest {
  document: CadDocument;
  session: number;
  result?: RebuildResult;
  sketchId?: string;
  bodyId?: string;
}
type Capture = (request: PngCaptureRequest) => Promise<Blob>;
const captures = new Map<"viewer" | "sketch", Capture>();

/** Runtime ownership only: capture handles never enter saved project data. */
export function registerPngCapture(kind: "viewer" | "sketch", capture: Capture) {
  captures.set(kind, capture);
  return () => {
    if (captures.get(kind) === capture) captures.delete(kind);
  };
}

export function capturePng(kind: "viewer" | "sketch", request: PngCaptureRequest) {
  const capture = captures.get(kind);
  if (!capture) throw new Error("Drawing view is unavailable. Open the view and try PNG export again.");
  return capture(request);
}

export function pngSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new Error("Drawing view has no visible area. Open or resize the view before exporting PNG.");
  const scale = Math.min(1, 4096 / Math.max(width, height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size && blob.type === "image/png") resolve(blob);
      else reject(new Error("Browser could not encode the PNG. Try exporting a smaller view."));
    }, "image/png");
  });
}

export function copyCanvasPng(source: HTMLCanvasElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, pngSize(source.width, source.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser image rendering is unavailable. Try another browser.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvasPng(canvas);
}

/** Freeze SVG pixels/styles before any asynchronous work or file-busy UI update. */
export function sketchPng(source: SVGSVGElement): Promise<Blob> {
  const rect = source.getBoundingClientRect();
  const size = pngSize(rect.width * 2, rect.height * 2);
  const viewBox = source.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0)
    throw new Error("Sketch coordinate frame is unavailable. Reopen the drawing before exporting PNG.");
  const clone = source.cloneNode(true) as SVGSVGElement;
  const originals = [source, ...source.querySelectorAll<SVGElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  const properties = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "visibility", "display", "vector-effect", "paint-order", "background-color"];
  originals.forEach((element, index) => {
    const styles = getComputedStyle(element);
    copies[index].removeAttribute("style");
    for (const property of properties) copies[index].style.setProperty(property, styles.getPropertyValue(property));
  });
  // Pointer feedback and invisible picking surfaces are not part of the drawing.
  clone.querySelectorAll(".canvas-preview, [data-snap-kind], [data-selection-box], [data-hit-entity-id]").forEach((node) => node.remove());
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(size.width));
  clone.setAttribute("height", String(size.height));
  const xml = new XMLSerializer().serializeToString(clone);
  const background = getComputedStyle(source).backgroundColor;
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => finish(new Error("Sketch image rendering timed out. Try PNG export again.")), 15000);
    function finish(error?: Error, blob?: Blob) {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else if (blob) resolve(blob);
    }
    image.onerror = () => finish(new Error("Browser could not render the sketch image. Try PNG export again."));
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        Object.assign(canvas, size);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Browser image rendering is unavailable. Try another browser.");
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        void canvasPng(canvas).then((blob) => finish(undefined, blob), (error: Error) => finish(error));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Sketch PNG export failed."));
      }
    };
    // data: is permitted by the production img-src policy; no external SVG assets.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });
}
