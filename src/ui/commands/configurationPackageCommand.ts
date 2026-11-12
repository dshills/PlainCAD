import type { ExportFile } from "../../fabrication/zip";
import { downloadArrayBuffer } from "../../persistence/exportProject";
import { useCadStore } from "../../state/useCadStore";
import { assertFamilyVariant, isCurrentFamilyVariant, useProductFamily, type FamilyVariant } from "./productFamilyCommand";

export interface FamilyPackage { variant: FamilyVariant; drawingBodyId: string; file: ExportFile }
const issuedPackages = new WeakSet<FamilyPackage>();

export function canPrepareFamilyPackage(variant: FamilyVariant, drawingBodyId: string) {
  return isCurrentFamilyVariant(variant) &&
    typeof Worker !== "undefined" && Boolean(variant.result?.stepExportAvailable &&
      variant.result.meshes.some(mesh => mesh.bodyId === drawingBodyId));
}

export async function prepareFamilyPackage(
  variant: FamilyVariant,
  drawingBodyId: string,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<FamilyPackage> {
  assertFamilyVariant(variant);
  if (signal.aborted) throw new Error("Fabrication package canceled.");
  if (!canPrepareFamilyPackage(variant, drawingBodyId)) throw new Error("Choose a current drawing part and wait for native STEP support.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const check = () => { if (!isCurrentFamilyVariant(variant)) abort(); };
  const unsubscribeCad = useCadStore.subscribe(check), unsubscribeFamily = useProductFamily.subscribe(check);
  signal.addEventListener("abort", abort, { once: true });
  try {
    check();
    const { generateConfigurationPackage } = await import("../../fabrication/configurationPackageClient");
    const file = await generateConfigurationPackage(variant.document, variant.id, variant.result!.meshes, drawingBodyId, variant.frame.owner.session, controller.signal, progress);
    if (controller.signal.aborted) throw new Error("Fabrication package canceled or became stale.");
    assertFamilyVariant(variant);
    const prepared = { variant, drawingBodyId, file };
    issuedPackages.add(prepared);
    return prepared;
  } catch (error) {
    if (signal.aborted) throw new Error("Fabrication package canceled.");
    if (!isCurrentFamilyVariant(variant)) throw new Error("Project changed during fabrication. Compare the configuration again.");
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribeCad(); unsubscribeFamily();
  }
}

export function downloadFamilyPackage(prepared: FamilyPackage, variant: FamilyVariant, drawingBodyId: string) {
  if (!issuedPackages.has(prepared) || prepared.variant !== variant || prepared.drawingBodyId !== drawingBodyId || !canPrepareFamilyPackage(variant, drawingBodyId)) {
    throw new Error("Generate a current fabrication package for this configuration and drawing part before downloading.");
  }
  assertFamilyVariant(variant);
  downloadArrayBuffer(prepared.file.bytes, prepared.file.filename, "application/zip");
  // Consume only after delivery was initiated; a thrown Blob/download error can be retried.
  issuedPackages.delete(prepared);
}
