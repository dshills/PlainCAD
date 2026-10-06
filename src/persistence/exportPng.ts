import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { beginFileJob, fileJobCurrent, finishFileJob } from "./fileJobs";
import { capturePng } from "./pngCapture";
import { downloadArrayBuffer } from "./exportProject";
import { safeFilename } from "./filenames";

export type PngScope = "project" | "body" | "sketch";

export async function exportPng(scope: PngScope) {
  const state = useCadStore.getState();
  if (state.fileBusy) return;
  const document = state.history.present, session = state.documentSession, result = state.rebuild.result;
  const active = useSketchCanvas.getState().active;
  const selection = state.selection.selectedIds[0];
  const bodyId = scope === "body" && selection?.kind === "body" && selection.documentId === document.id ? selection.id : undefined;
  const sketch = scope === "sketch" && active?.session === session && active.documentId === document.id ? document.sketches[active.sketchId] : undefined;
  let controller: AbortController | undefined;
  try {
    if (scope === "sketch") {
      if (!sketch) throw new Error("Open a sketch drawing before exporting its PNG.");
    } else {
      if (state.rebuild.status !== "succeeded" || !state.rebuild.kernelReady || !result?.success || result.documentId !== document.id || !result.meshes.length)
        throw new Error("PNG export requires the current model to rebuild successfully.");
      if (scope === "body" && (!bodyId || !result.meshes.some((mesh) => mesh.bodyId === bodyId)))
        throw new Error("Select a rebuilt body in the project or viewer before exporting its PNG.");
    }
    const image = capturePng(scope === "sketch" ? "sketch" : "viewer", { document, session, result, sketchId: sketch?.id, bodyId });
    // Observe encoding failures even if a file-job subscriber throws during setup.
    void image.catch(() => undefined);
    controller = beginFileJob("Preparing PNG image…");
    state.setFileError(undefined);
    const blob = await image;
    const bytes = await blob.arrayBuffer();
    if (!fileJobCurrent(controller)) return;
    const current = useCadStore.getState();
    if (current.history.present !== document || current.documentSession !== session || (scope !== "sketch" && (current.rebuild.result !== result || current.rebuild.status !== "succeeded")))
      throw new Error("Project changed during PNG export. Export the current view again.");
    const name = sketch?.name ?? (bodyId ? result?.bodies.find((body) => body.id === bodyId)?.name ?? "Part" : document.name);
    downloadArrayBuffer(bytes, safeFilename(name, ".png"), "image/png");
  } catch (error) {
    if (!controller || fileJobCurrent(controller)) state.setFileError(error instanceof Error ? error.message : "PNG export failed.");
  } finally {
    if (controller) finishFileJob(controller);
  }
}
