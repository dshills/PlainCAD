import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { configurationDocument } from "../../cad/document/productConfigurations";
import { bodyDisplayNames } from "../../cad/document/bodyDisplayNames";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { exportFabrication } from "../../fabrication/exportClient";
import { zipFiles, type ExportFile } from "../../fabrication/zip";
import { safeFilename, uniqueFilenames } from "../../persistence/filenames";
import { downloadArrayBuffer } from "../../persistence/exportProject";
import { useCadStore } from "../../state/useCadStore";
import { assertNativeSolidPreview } from "./modelingDraftCommand";
import { nativeTaskReady } from "./nativeTaskAvailability";
import { useProductFamily, type FamilySession } from "./productFamilyState";
export { useProductFamily } from "./productFamilyState";
export interface FamilyFrame { owner: FamilySession; document: CadDocument; result: RebuildResult }
export interface FamilyVariant { frame: FamilyFrame; id: string; name: string; document: CadDocument; result?: RebuildResult; error?: string }
const issued = new WeakSet<FamilyVariant>();
const issuedArchives = new WeakMap<ExportFile, readonly FamilyVariant[]>();
export function canOpenFamily(state = useCadStore.getState()) { return nativeTaskReady(state) && Object.values(state.history.present.parameters).some(parameter => !parameter.locked); }
export function beginFamily() {
  const state = useCadStore.getState(); if (!canOpenFamily(state)) throw new Error("Finish the current task and create a native model with an editable parameter first.");
  useProductFamily.setState({ frame: { session: state.documentSession, documentId: state.history.present.id } });
}
export function cancelFamily() { useProductFamily.setState({ frame: undefined }); }
export function currentFamily(owner: FamilySession) { const state = useCadStore.getState(); return useProductFamily.getState().frame === owner && state.documentSession === owner.session && state.history.present.id === owner.documentId && !state.fileBusy; }
export function captureFamilyFrame(owner: FamilySession): FamilyFrame {
  const state = useCadStore.getState(); if (!currentFamily(owner) || !nativeTaskReady(state, "family")) throw new Error("Wait for the current native model before comparing configurations.");
  return { owner, document: state.history.present, result: state.rebuild.result! };
}
export function currentFamilyFrame(frame: FamilyFrame) { const state = useCadStore.getState(); return currentFamily(frame.owner) && nativeTaskReady(state, "family") && state.history.present === frame.document && state.rebuild.result === frame.result; }
export async function compareFamily(frame: FamilyFrame, ids: readonly string[], signal: AbortSignal, progress: (message: string) => void): Promise<FamilyVariant[]> {
  if (!currentFamilyFrame(frame) || !ids.length || ids.length > 8 || new Set(ids).size !== ids.length || ids.some(id => !frame.document.configurations?.some(configuration => configuration.id === id))) throw new Error("Choose 1–8 current configurations and wait for the native model.");
  const variants: FamilyVariant[] = []; let triangles = 0, bytes = 0;
  for (const id of ids) {
    if (signal.aborted || !currentFamilyFrame(frame)) throw new Error("Configuration comparison canceled or became stale.");
    const configuration = frame.document.configurations!.find(item => item.id === id)!;
    progress(`Checking ${configuration.name} with native geometry…`);
    let document = frame.document;
    try {
      document = configurationDocument(frame.document, id);
      const result = await previewModeling(document, signal);
      if (signal.aborted || !currentFamilyFrame(frame)) throw new Error("Configuration comparison canceled or became stale.");
      assertNativeSolidPreview(result, document.id);
      const addedTriangles = result.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0), addedBytes = result.meshes.reduce((sum, mesh) => sum + (mesh.positions.length + mesh.normals.length + mesh.indices.length) * 8, 0);
      if (triangles + addedTriangles > 250000 || bytes + addedBytes > 64 * 1024 * 1024) throw new Error("Comparison exceeds its combined geometry resource limit. Select fewer or simpler configurations.");
      triangles += addedTriangles; bytes += addedBytes;
      const variant = { frame, id, name: configuration.name, document, result }; issued.add(variant); variants.push(variant);
    } catch (error) {
      if (signal.aborted || !currentFamilyFrame(frame)) throw new Error("Configuration comparison canceled or became stale.");
      variants.push({ frame, id, name: configuration.name, document, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return variants;
}
function assertVariant(variant: FamilyVariant) {
  if (!issued.has(variant) || !currentFamilyFrame(variant.frame) || !variant.result || variant.error) throw new Error("Compare this current configuration successfully before Apply or export.");
  assertNativeSolidPreview(variant.result, variant.document.id);
}
export function applyFamilyVariant(variant: FamilyVariant) {
  assertVariant(variant);
  useCadStore.getState().updateDocument(current => current === variant.frame.document ? variant.document : current);
  if (useCadStore.getState().history.present === variant.frame.document) throw new Error("Configuration could not be applied. Review project diagnostics.");
  issued.delete(variant); cancelFamily();
}
export async function exportFamily(variants: readonly FamilyVariant[], signal: AbortSignal, progress: (message: string) => void) {
  if (!variants.length || variants.length > 8 || new Set(variants.map(variant => variant.id)).size !== variants.length) throw new Error("Compare 1–8 unique configurations before batch export.");
  variants.forEach(assertVariant);
  if (variants.some(variant => variant.frame !== variants[0].frame)) throw new Error("Configurations must come from the same current comparison.");
  const files: ExportFile[] = [], manifest: unknown[] = []; let bytes = 0;
  const variantNames = uniqueFilenames(variants.map(variant => variant.name)).map(name => name.replace(/\.stl$/i, ""));
  for (const [index, variant] of variants.entries()) {
    const result = variant.result!, labels = bodyDisplayNames(variant.document, result.bodies), names = uniqueFilenames(result.meshes.map(mesh => `v${index + 1}-${variantNames[index]}--${labels[mesh.bodyId] ?? mesh.bodyId}`));
    const parts: unknown[] = [];
    for (const [partIndex, mesh] of result.meshes.entries()) {
      if (signal.aborted) throw new Error("Batch export canceled."); assertVariant(variant);
      progress(`Exporting ${variant.name} · ${labels[mesh.bodyId] ?? mesh.bodyId}…`);
      const output = await exportFabrication({ document: variant.document, meshes: [mesh], bodies: result.bodies.filter(body => body.id === mesh.bodyId), mode: "separate", fullChecks: true }, signal, progress);
      if (signal.aborted) throw new Error("Batch export canceled."); assertVariant(variant);
      bytes += output.file.bytes.byteLength; if (bytes > 64 * 1024 * 1024) throw new Error("Batch exceeds the 64 MiB archive resource limit. Export fewer configurations.");
      files.push({ filename: names[partIndex], bytes: output.file.bytes });
      parts.push({ bodyId: mesh.bodyId, name: labels[mesh.bodyId], filename: names[partIndex], volumeMm3: mesh.geometryAssertions!.volume, boundsMm: mesh.bounds, warnings: output.warnings });
    }
    manifest.push({ configurationId: variant.id, name: variant.name, parameters: variant.document.configurations!.find(configuration => configuration.id === variant.id)!.parameters, parts });
  }
  files.push({ filename: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify({ units: "mm", configurations: manifest }, null, 2)).buffer });
  const archive = zipFiles(files); if (archive.byteLength > 64 * 1024 * 1024) throw new Error("Archive exceeds 64 MiB including metadata.");
  if (signal.aborted) throw new Error("Batch export canceled."); variants.forEach(assertVariant);
  const file = { filename: safeFilename(variants[0].frame.document.name, ".zip", "-configurations"), bytes: archive };
  issuedArchives.set(file, [...variants]); return file;
}
export function downloadFamily(variants: readonly FamilyVariant[], file: ExportFile) {
  const proof = issuedArchives.get(file);
  if (!proof || proof.length !== variants.length || proof.some((variant, index) => variant !== variants[index])) throw new Error("Generate a current batch archive before downloading.");
  variants.forEach(assertVariant); downloadArrayBuffer(file.bytes, file.filename, "application/zip"); issuedArchives.delete(file);
}
