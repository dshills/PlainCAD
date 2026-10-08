import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import { useFileJobs } from "../persistence/fileJobs";
import { useInspectionState } from "../state/inspectionState";
import { useTargetScopeCapture } from "../ui/commands/targetScopeCaptureCommand";
import * as client from "../fabrication/stepExportClient";
import * as downloads from "../persistence/exportProject";
import { cancelStepExport, canOpenStepExport, openStepExport, setStepExportBodies, useStepExport } from "../ui/commands/stepExportCommand";
import { downloadPreparedStep, prepareStepExport } from "../ui/commands/stepExportJob";
import { StepExportPanel } from "../ui/panels/StepExportPanel";
import { selectCommandEnablement } from "../ui/commands/commandRegistry";
import type { NativeStepExport } from "../cad/kernel/nativeStep";
function prepared(): NativeStepExport {
  const proof = { valid: true as const, solidCount: 1, volume: 80000, surfaceArea: 14000, bounds: { min: [-40, -25, 0] as [number, number, number], max: [40, 25, 20] as [number, number, number] } };
  return { units: "mm", bytes: new TextEncoder().encode("ISO-10303-21;\nEND-ISO-10303-21;\n").buffer, before: [proof], after: [proof] };
}
beforeEach(() => {
  cancelStepExport(); useFileJobs.getState().cancel(); useFileJobs.setState({ exportOpen: false });
  useInspectionState.setState({ picking: false }); useTargetScopeCapture.setState({ busy: false });
  useCadStore.getState().setDocument(createBoxTemplate());
  const document = useCadStore.getState().history.present, result = rebuildDocument(document);
  vi.stubGlobal("Worker", class { postMessage() {} terminate() {} });
  useCadStore.setState({ rebuild: { status: "succeeded", kernelReady: true, result: { ...result, stepExportAvailable: true, meshes: result.meshes.map(mesh => ({ ...mesh, geometrySource: "opencascade", geometryAssertions: { valid: true, volume: 80000, surfaceArea: 14000, solidCount: 1 } })) } } });
  vi.spyOn(client, "exportStepDocument").mockResolvedValue(prepared());
  vi.spyOn(downloads, "downloadArrayBuffer").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); cancelStepExport(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useCadStore.setState(useCadStore.getInitialState(), true); });
it("requires actual available native bindings and current native solids, and blocks competing drafts", () => {
  expect(canOpenStepExport()).toBe(true); expect(selectCommandEnablement(useCadStore.getState()).exportStep).toBe(true);
  const state = useCadStore.getState(), result = state.rebuild.result!;
  useCadStore.setState({ rebuild: { ...state.rebuild, result: { ...result, stepExportAvailable: false, stepExportDiagnostic: "Missing STEP reader." } } });
  expect(canOpenStepExport()).toBe(false); openStepExport(); expect(useCadStore.getState().fileError).toMatch(/Missing STEP reader/);
  useCadStore.setState({ rebuild: { ...state.rebuild, result } });
  useInspectionState.setState({ picking: true }); expect(canOpenStepExport()).toBe(false); useInspectionState.setState({ picking: false });
  openStepExport(); expect(selectCommandEnablement(useCadStore.getState()).partLibrary).toBe(false); expect(selectCommandEnablement(useCadStore.getState()).moveComponent).toBe(false);
});
it("presents selected separate solids and enables download only after verified generation without modifying history", async () => {
  const document = useCadStore.getState().history.present;
  act(openStepExport); render(<StepExportPanel/>);
  expect(screen.getByRole("dialog", { name: "Export STEP" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Download STEP file" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Clear STEP bodies" })); expect(screen.getByRole("button", { name: "Generate validated STEP" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Select all STEP bodies" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate validated STEP" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Download STEP file" })).toBeEnabled());
  expect(screen.getByRole("status")).toHaveTextContent(/Exact volume and world bounds match/);
  expect(client.exportStepDocument).toHaveBeenCalledWith(document, [useCadStore.getState().rebuild.result!.meshes[0].bodyId], useCadStore.getState().documentSession, expect.any(AbortSignal), expect.any(Function));
  fireEvent.click(screen.getByRole("button", { name: "Download STEP file" }));
  expect(downloads.downloadArrayBuffer).toHaveBeenCalledWith(expect.objectContaining({ byteLength: expect.any(Number) }), expect.stringMatching(/\.step$/), "model/step");
  expect(useCadStore.getState().history.present).toBe(document); expect(useCadStore.getState().history.past).toHaveLength(0); expect(useStepExport.getState().frame).toBeUndefined();
});
it("cancels and discards late worker replies, releasing file ownership without downloading", async () => {
  let resolve!: (value: NativeStepExport) => void;
  vi.mocked(client.exportStepDocument).mockImplementation(() => new Promise(done => { resolve = done; }));
  openStepExport(); const pending = prepareStepExport();
  await vi.waitFor(() => expect(client.exportStepDocument).toHaveBeenCalled());
  const signal = vi.mocked(client.exportStepDocument).mock.lastCall![3];
  expect(useCadStore.getState().fileBusy).toBe(true); cancelStepExport(); expect(signal.aborted).toBe(true);
  resolve(prepared()); await pending;
  expect(useStepExport.getState().frame).toBeUndefined(); expect(useCadStore.getState().fileBusy).toBe(false); expect(downloads.downloadArrayBuffer).not.toHaveBeenCalled();
});
it("rejects changed project/session/native-result snapshots both during generation and before download", async () => {
  let resolve!: (value: NativeStepExport) => void;
  vi.mocked(client.exportStepDocument).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  openStepExport(); const pending = prepareStepExport(); await vi.waitFor(() => expect(client.exportStepDocument).toHaveBeenCalled());
  const signal = vi.mocked(client.exportStepDocument).mock.lastCall![3];
  useCadStore.getState().updateDocument(document => ({ ...document, name: "Changed" })); expect(signal.aborted).toBe(true); resolve(prepared()); await pending;
  expect(useStepExport.getState().frame?.prepared).toBeUndefined(); expect(useStepExport.getState().frame?.error).toMatch(/Project changed/); expect(useCadStore.getState().fileBusy).toBe(false);
  cancelStepExport(); const state = useCadStore.getState(), result = state.rebuild.result!;
  useCadStore.setState({ rebuild: { ...state.rebuild, status: "succeeded", result: { ...result, documentId: state.history.present.id, success: true, stepExportAvailable: true } } });
  openStepExport(); await prepareStepExport();
  useCadStore.setState({ documentSession: useCadStore.getState().documentSession + 1 }); downloadPreparedStep();
  expect(useStepExport.getState().frame?.prepared).toBeUndefined(); expect(useStepExport.getState().frame?.error).toMatch(/Model changed/); expect(downloads.downloadArrayBuffer).not.toHaveBeenCalled();
});
it("clears prepared data when selected bodies change and shows native export errors", async () => {
  openStepExport(); await prepareStepExport(); setStepExportBodies([]);
  expect(useStepExport.getState().frame?.prepared).toBeUndefined(); downloadPreparedStep(); expect(downloads.downloadArrayBuffer).not.toHaveBeenCalled();
  setStepExportBodies([useCadStore.getState().rebuild.result!.meshes[0].bodyId]);
  vi.mocked(client.exportStepDocument).mockRejectedValue(new Error("STEP round trip changed exact volume.")); await prepareStepExport();
  expect(useStepExport.getState().frame?.error).toMatch(/exact volume/); expect(useStepExport.getState().frame?.prepared).toBeUndefined(); expect(useCadStore.getState().fileBusy).toBe(false);
});
