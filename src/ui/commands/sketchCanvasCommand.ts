import {
  withCanvasDimension,
  type CanvasDimensionInput,
} from "../../cad/sketch/canvasDimensions";
import { create } from "zustand";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { upsertSketch } from "../../cad/document/CadDocument";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { resolveDocumentPlanes } from "../../cad/sketch/planes";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import {
  addCanvasGeometry,
  type CanvasPoint,
  type CanvasTool,
} from "../../cad/sketch/canvasGeometry";
import { assertProjectJsonShape } from "../../persistence/importSafety";

export interface CanvasSession {
  documentId: string;
  session: number;
  sketchId: string;
}
export const useSketchCanvas = create<{ active?: CanvasSession }>(() => ({}));
export function selectedCanvasSketch(state: CadStore) {
  const selected = state.selection.selectedIds[0],
    document = state.history.present;
  if (state.fileBusy || selected?.documentId !== document.id) return;
  if (selected.kind === "sketch") return document.sketches[selected.id];
  if (selected.kind === "sketchEntity") {
    const owners = Object.values(document.sketches).filter(
      (s) => s.entities[selected.id],
    );
    return owners.length === 1 ? owners[0] : undefined;
  }
}
export function beginSketchCanvas() {
  const state = useCadStore.getState(),
    sketch = selectedCanvasSketch(state);
  if (sketch)
    useSketchCanvas.setState({
      active: {
        documentId: state.history.present.id,
        session: state.documentSession,
        sketchId: sketch.id,
      },
    });
}
export function canvasContext(
  active: CanvasSession,
  state = useCadStore.getState(),
  allowSolveErrors = false,
) {
  const document = state.history.present,
    sketch = document.sketches[active.sketchId];
  if (
    state.documentSession !== active.session ||
    document.id !== active.documentId ||
    !sketch ||
    state.fileBusy
  )
    throw new Error("Project or sketch changed. Reopen the sketch canvas.");
  const evaluation = evaluateParameters(document.parameters);
  if (evaluation.errors.length)
    throw new Error(
      `Repair parameter errors before drawing: ${evaluation.errors[0].message}`,
    );
  const rebuild = state.rebuild;
  // Document edits synchronously queue a rebuild; the store rejects stale request IDs/epochs.
  // A succeeded/failed snapshot therefore belongs to the current immutable present.
  const current =
    (rebuild.status === "succeeded" || rebuild.status === "failed") &&
    rebuild.result?.documentId === document.id;
  const solvedSketches = current ? rebuild.result?.solvedSketches : undefined;
  const planes = resolveDocumentPlanes(
    document,
    evaluation.values,
    solvedSketches ? new Map(Object.entries(solvedSketches)) : undefined,
  );
  const plane = planes.transforms.get(sketch.id);
  if (!plane)
    throw new Error(
      planes.errors.get(sketch.id) ??
        "Sketch plane is unavailable. Repair it first.",
    );
  const solved =
    solvedSketches?.[sketch.id] ?? solveSketch(sketch, evaluation.values);
  const error = solved.errors.find((e) => e.severity === "error");
  if (error && !allowSolveErrors)
    throw new Error(`Repair the sketch before drawing: ${error.message}`);
  return {
    document,
    sketch,
    solved,
    plane,
    pending: !solvedSketches?.[sketch.id],
  };
}
export function commitCanvasGeometry(
  active: CanvasSession,
  expected: CadStore["history"]["present"],
  tool: CanvasTool,
  points: CanvasPoint[],
  construction: boolean,
  clockwise: boolean,
) {
  const state = useCadStore.getState();
  if (state.history.present !== expected)
    throw new Error("Project changed during drawing. Cancel and draw again.");
  const context = canvasContext(active, state),
    result = addCanvasGeometry(
      context.sketch,
      context.solved,
      tool,
      points,
      construction,
      clockwise,
    );
  if (result.sketch === context.sketch) return result;
  const next = upsertSketch(context.document, result.sketch);
  assertProjectJsonShape(next);
  state.updateDocument((d) => (d === expected ? next : d));
  if (useCadStore.getState().history.present === expected)
    throw new Error(
      useCadStore.getState().fileError ?? "Sketch edit could not be saved.",
    );
  return result;
}

export function commitCanvasDimension(
  active: CanvasSession,
  expected: CadStore["history"]["present"],
  input?: CanvasDimensionInput,
  removeId?: string,
): string | undefined {
  const state = useCadStore.getState();
  if (state.history.present !== expected)
    throw new Error(
      "Project changed. Apply the dimension again for the current sketch.",
    );
  if (input && removeId)
    throw new Error("Choose either dimension editing or deletion.");
  const context = canvasContext(active, state, true);
  let updated;
  if (removeId) {
    if (!context.sketch.dimensions.some((d) => d.id === removeId))
      throw new Error("Dimension reference lost. Select a current dimension.");
    updated = {
      ...context.sketch,
      dimensions: context.sketch.dimensions.filter((d) => d.id !== removeId),
    };
  } else if (input) updated = withCanvasDimension(context.sketch, input);
  else throw new Error("Choose a dimension to create, edit or remove.");
  if (updated !== context.sketch) {
    const next = upsertSketch(context.document, updated);
    assertProjectJsonShape(next);
    state.updateDocument((d) => (d === expected ? next : d));
    if (useCadStore.getState().history.present === expected)
      throw new Error(
        "Dimension edit could not be saved. Check the project diagnostics.",
      );
  }
  return input ? (input.id ?? updated.dimensions.at(-1)?.id) : undefined;
}
