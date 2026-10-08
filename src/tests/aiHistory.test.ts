import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { buildSketchRefinement } from "../ai/sketchRefinement";
import { useCadStore } from "../state/useCadStore";
import { aiHistoryIntent, handleAiHistoryPrompt } from "../ui/commands/aiHistoryPrompt";
import { canRedoAiChange, canUndoAiChange, recordAiHistoryChange, useAiHistory } from "../ui/commands/aiHistoryState";
import { runCommand } from "../ui/commands/commandRegistry";
import { useAiDrawer } from "../ui/commands/aiCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { applySketchRefinement, captureSketchRefinementFrame, previewSketchRefinement, useSketchRefinement } from "../ui/commands/sketchRefinementCommand";

vi.mock("../cad/worker/extrudePreviewClient", () => ({ previewModeling: vi.fn((document) => rebuildDocument(document)) }));

beforeEach(() => {
  useCadStore.setState({ ...useCadStore.getInitialState(), rebuildNow: vi.fn() }, true);
  useAiHistory.setState({ transaction: undefined });
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  useSketchRefinement.setState({ frame: undefined });
  useAiDrawer.setState({ open: false, namedPart: undefined });
  useCadStore.getState().setDocument(createEmptyDocument());
});

function applyNamedChange(name: string) {
  const state = useCadStore.getState(), before = state.history.present;
  state.updateDocument((document) => ({ ...document, name }));
  recordAiHistoryChange(before, state.documentSession, name);
  return useAiHistory.getState().transaction!;
}

it("uses ordinary one-step history for local AI undo/redo and never treats modeling text as a history instruction", () => {
  const transaction = applyNamedChange("AI part");
  expect(useCadStore.getState().history.past).toEqual([transaction.before]);
  expect(handleAiHistoryPrompt("Please undo that!")).toMatchObject({ changed: true, message: "Undid AI change: AI part." });
  expect(useCadStore.getState().history.present).toBe(transaction.before);
  expect(useCadStore.getState().history.future).toEqual([transaction.after]);
  expect(canRedoAiChange(useCadStore.getState())).toBe(true);
  expect(handleAiHistoryPrompt("redo the last AI change")).toMatchObject({ changed: true });
  expect(useCadStore.getState().history.present).toBe(transaction.after);
  expect(useCadStore.getState().history.past).toEqual([transaction.before]);
  for (const text of ["undo the hole and round the corners", "redo the sketch with a circle", "Please undo that and make a box", "undo all", "don't undo that"])
    expect(handleAiHistoryPrompt(text)).toBeUndefined();
  expect(aiHistoryIntent("undo")).toBe("undo");
});

it("refuses to undo a later manual edit and leaves normal project undo available", () => {
  const transaction = applyNamedChange("AI part");
  useCadStore.getState().updateDocument((document) => ({ ...document, name: "Manual name" }));
  const manuallyEdited = useCadStore.getState().history.present;
  expect(canUndoAiChange(useCadStore.getState())).toBe(false);
  expect(handleAiHistoryPrompt("undo that")).toMatchObject({ changed: false });
  runCommand("ai.undoChange", { aiHistory: transaction });
  expect(useCadStore.getState().history.present).toBe(manuallyEdited);
  runCommand("history.undo");
  expect(useCadStore.getState().history.present).toBe(transaction.after);
  expect(handleAiHistoryPrompt("undo that")).toMatchObject({ changed: true });
  expect(useCadStore.getState().history.present).toBe(transaction.before);
});

it("blocks captured old action tokens, redo after a branch edit, file operations and same-ID project replacement", () => {
  const old = applyNamedChange("First AI part");
  const current = applyNamedChange("Second AI part");
  runCommand("ai.undoChange", { aiHistory: old });
  expect(useCadStore.getState().history.present).toBe(current.after);
  useCadStore.setState({ fileBusy: true });
  expect(handleAiHistoryPrompt("undo that")).toMatchObject({ changed: false });
  useCadStore.setState({ fileBusy: false });
  expect(handleAiHistoryPrompt("undo that")).toMatchObject({ changed: true });
  expect(canRedoAiChange(useCadStore.getState())).toBe(true);
  useCadStore.getState().updateDocument((document) => ({ ...document, name: "Manual branch" }));
  expect(handleAiHistoryPrompt("redo that")).toMatchObject({ changed: false });
  expect(useCadStore.getState().history.future).toHaveLength(0);
  useCadStore.getState().setDocument(current.after);
  expect(useAiHistory.getState().transaction).toBeUndefined();
  expect(canUndoAiChange(useCadStore.getState(), current)).toBe(false);
  expect(handleAiHistoryPrompt("undo that")).toMatchObject({ changed: false });
});

it("does not record rejected or unchanged store edits as AI transactions", () => {
  const state = useCadStore.getState(), before = state.history.present;
  state.updateDocument(() => { throw new Error("Proposal rejected"); });
  recordAiHistoryChange(before, state.documentSession, "Rejected");
  expect(useAiHistory.getState().transaction).toBeUndefined();
  expect(useCadStore.getState().history.present).toBe(before);
  expect(useCadStore.getState().history.past).toHaveLength(0);
  expect(useCadStore.getState().fileError).toBe("Proposal rejected");
});

it("allows closing the canvas assistant during a competing task without enabling it during a file operation", () => {
  const sketch = addCornerRectangle(createXySketch("Rectangle"), "24mm", "16mm");
  useCadStore.getState().setDocument(upsertSketch(createEmptyDocument(), sketch));
  const state = useCadStore.getState();
  useSketchCanvas.setState({ active: { sketchId: sketch.id, documentId: state.history.present.id, session: state.documentSession } });
  useAiDrawer.setState({ open: true });
  useSketchRefinement.setState({ frame: captureSketchRefinementFrame() });
  runCommand("ai.toggle");
  expect(useAiDrawer.getState().open).toBe(false);
  runCommand("ai.toggle");
  expect(useAiDrawer.getState().open).toBe(false);
  useSketchRefinement.setState({ frame: undefined });
  useCadStore.setState({ fileBusy: true });
  runCommand("ai.toggle");
  expect(useAiDrawer.getState().open).toBe(false);
});

it("records a dimension/refinement batch once and restores observable solved dimensions through shared history", async () => {
  const sketch = addCornerRectangle(createXySketch("Rectangle"), "24mm", "16mm");
  useCadStore.getState().setDocument(upsertSketch(createEmptyDocument(), sketch));
  const state = useCadStore.getState();
  useSketchCanvas.setState({ active: { sketchId: sketch.id, documentId: state.history.present.id, session: state.documentSession } });
  const frame = captureSketchRefinementFrame();
  useSketchRefinement.setState({ frame });
  const plan = buildSketchRefinement(frame.document, sketch.id, [], "make this rectangle 60 x 40 mm");
  const { result } = await previewSketchRefinement(plan, new AbortController().signal);
  applySketchRefinement(frame, plan, result);
  const bounds = () => detectProfiles(solveSketch(useCadStore.getState().history.present.sketches[sketch.id], {})).profiles[0].bounds;
  expect(bounds().maxX - bounds().minX).toBeCloseTo(60, 5);
  expect(useCadStore.getState().history.past).toHaveLength(1);
  expect(handleAiHistoryPrompt("undo that")).toMatchObject({ changed: true });
  expect(bounds().maxX - bounds().minX).toBeCloseTo(24, 5);
  expect(handleAiHistoryPrompt("redo that")).toMatchObject({ changed: true });
  expect(bounds().maxX - bounds().minX).toBeCloseTo(60, 5);
  expect(useCadStore.getState().history.past).toHaveLength(1);
});
