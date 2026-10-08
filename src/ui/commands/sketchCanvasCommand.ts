import {
  addSizedCanvasGeometry,
  type CanvasSizeInput,
} from "../../cad/sketch/sizedCanvasGeometry";
import {
  deformedCanvasSketch,
  validateCanvasDeformation,
} from "../../cad/sketch/canvasDeformation";
import { movedCanvasPoint } from "../../cad/sketch/canvasPointMove";
import {
  translatedCanvasGroup,
  validateCanvasTranslation,
} from "../../cad/sketch/canvasTranslation";
import { withCanvasConstraintReferences } from "../../cad/sketch/canvasConstraints";
import { SKETCH_TOLERANCE } from "../../cad/sketch/tolerances";
import {
  withCanvasDimension,
  type CanvasDimensionInput,
} from "../../cad/sketch/canvasDimensions";
import { create } from "zustand";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { upsertSketch } from "../../cad/document/CadDocument";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { resolvePlacedDocumentPlanes } from "../../cad/sketch/planes";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import {
  type CanvasPoint,
  type CanvasTool,
} from "../../cad/sketch/canvasGeometry";
import { assertProjectJsonShape } from "../../persistence/importSafety";
import { deleteSketchEntities } from "../../cad/sketch/entityDeletion";
import { sketchComponentId } from "../../cad/document/components";

export interface CanvasSession {
  documentId: string;
  session: number;
  sketchId: string;
  requestedTool?: CanvasTool;
  toolRevision?: number;
}
export const useSketchCanvas = create<{
  active?: CanvasSession;
  selection?: {
    entityIds: string[];
    document: CadStore["history"]["present"];
  };
}>(() => ({}));

function sketchInActiveComponent(state: CadStore, sketchId: string) {
  const document = state.history.present;
  const componentId = Object.hasOwn(
    document.components,
    state.activeComponentId,
  )
    ? state.activeComponentId
    : document.rootComponentId;
  return sketchComponentId(document, sketchId) === componentId;
}

export function selectedCanvasEntities(state = useCadStore.getState()) {
  const { active, selection } = useSketchCanvas.getState();
  if (
    !active ||
    !selection ||
    state.fileBusy ||
    active.session !== state.documentSession ||
    active.documentId !== state.history.present.id ||
    selection.document !== state.history.present
  )
    return;
  const sketch = state.history.present.sketches[active.sketchId];
  if (!sketchInActiveComponent(state, active.sketchId)) return;
  if (
    sketch &&
    selection.entityIds.length &&
    selection.entityIds.every((id) => Object.hasOwn(sketch.entities, id))
  )
    return { active, sketch, entityIds: [...selection.entityIds] };
}
export function selectedCanvasEntity(state = useCadStore.getState()) {
  const selection = selectedCanvasEntities(state);
  return selection
    ? { ...selection, entityId: selection.entityIds[0] }
    : undefined;
}

export function selectCanvasEntities(
  active: CanvasSession,
  expected: CadStore["history"]["present"],
  ids: readonly string[],
  toggle = false,
) {
  const state = useCadStore.getState();
  if (
    state.history.present !== expected ||
    state.documentSession !== active.session ||
    state.history.present.id !== active.documentId ||
    state.fileBusy ||
    useSketchCanvas.getState().active !== active ||
    !sketchInActiveComponent(state, active.sketchId)
  )
    throw new Error("Project changed. Select current sketch geometry.");
  const sketch = expected.sketches[active.sketchId];
  if (!sketch) throw new Error("Sketch was removed. Choose a current sketch.");
  if (ids.some((id) => !Object.hasOwn(sketch.entities, id)))
    throw new Error("Sketch item was removed. Select a current item.");
  const entityIds = new Set(
    toggle ? selectedCanvasEntities(state)?.entityIds : [],
  );
  for (const id of new Set(ids)) {
    if (toggle && entityIds.has(id)) entityIds.delete(id);
    else entityIds.add(id);
  }
  const selected = [...entityIds];
  useSketchCanvas.setState({
    selection: selected.length
      ? { entityIds: selected, document: expected }
      : undefined,
  });
}
export function selectCanvasEntity(
  active: CanvasSession,
  expected: CadStore["history"]["present"],
  entityId?: string,
) {
  selectCanvasEntities(active, expected, entityId ? [entityId] : []);
}
export function canSelectAllCanvasEntities(state = useCadStore.getState()) {
  const active = useSketchCanvas.getState().active,
    document = state.history.present;
  if (
    !active ||
    state.fileBusy ||
    active.session !== state.documentSession ||
    active.documentId !== document.id
  )
    return false;
  return (
    sketchInActiveComponent(state, active.sketchId) &&
    Boolean(
      document.sketches[active.sketchId] &&
      Object.keys(document.sketches[active.sketchId].entities).length,
    )
  );
}
export function selectAllCanvasEntities() {
  const state = useCadStore.getState(),
    active = useSketchCanvas.getState().active;
  if (!active || !canSelectAllCanvasEntities(state))
    throw new Error(
      "Open a current sketch with geometry before selecting all.",
    );
  selectCanvasEntities(
    active,
    state.history.present,
    Object.keys(
      state.history.present.sketches[active.sketchId]?.entities ?? {},
    ),
  );
}
export function deleteSelectedCanvasEntity() {
  const state = useCadStore.getState(),
    selected = selectedCanvasEntities(state);
  if (!selected)
    throw new Error("Select a current sketch item before deleting.");
  // Deletion also repairs sketches with invalid parameters, solves or planes.
  const expected = state.history.present;
  const next = upsertSketch(
    expected,
    deleteSketchEntities(selected.sketch, selected.entityIds, expected),
  );
  assertProjectJsonShape(next);
  state.updateDocument((document) => (document === expected ? next : document));
  if (useCadStore.getState().history.present === expected)
    throw new Error(
      "Sketch deletion could not be saved. Check project diagnostics.",
    );
  useSketchCanvas.setState({ selection: undefined });
}
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
export function beginSketchCanvas(sketchId?: string): CanvasSession | undefined {
  const state = useCadStore.getState(), document = state.history.present;
  if (state.fileBusy) return;
  const sketch = sketchId
    ? (Object.hasOwn(document.sketches, sketchId) ? document.sketches[sketchId] : undefined)
    : selectedCanvasSketch(state);
  if (sketch) {
    const active = {
      documentId: document.id,
      session: state.documentSession,
      sketchId: sketch.id,
    };
    useSketchCanvas.setState({
      selection: undefined,
      active,
    });
    return active;
  }
}
function currentCanvasToolSession(state: CadStore) {
  const current = useSketchCanvas.getState().active;
  return current && current.session === state.documentSession &&
    current.documentId === state.history.present.id &&
    state.history.present.sketches[current.sketchId] &&
    sketchInActiveComponent(state, current.sketchId) ? current : undefined;
}
export function canBeginSketchCanvasTool(state = useCadStore.getState()): boolean {
  if (state.fileBusy) return false;
  if (currentCanvasToolSession(state)) return true;
  const sketch = selectedCanvasSketch(state);
  return Boolean(sketch && sketchInActiveComponent(state, sketch.id));
}

/** Request a drawing tool through shared commands without editing the document. */
export function beginSketchCanvasTool(tool: CanvasTool): CanvasSession | undefined {
  const state = useCadStore.getState();
  if (!canBeginSketchCanvasTool(state)) return;
  const active = currentCanvasToolSession(state) ?? beginSketchCanvas();
  if (!active) return;
  const requested = {
    ...active,
    requestedTool: tool,
    toolRevision: (active.toolRevision ?? 0) + 1,
  };
  // Starting new drawing geometry exits the previous entity selection.
  useSketchCanvas.setState({ active: requested, selection: undefined });
  return requested;
}

/** Acknowledge only the exact request; a newer request must survive a stale consumer. */
export function consumeSketchCanvasToolRequest(request: CanvasSession) {
  useSketchCanvas.setState((state) => {
    const active = state.active;
    if (!active || active.session !== request.session || active.documentId !== request.documentId ||
      active.sketchId !== request.sketchId || active.toolRevision !== request.toolRevision ||
      active.requestedTool !== request.requestedTool) return {};
    return { active: { ...active, requestedTool: undefined } };
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
  const planes = resolvePlacedDocumentPlanes(
    document,
    evaluation.values,
    solvedSketches ? new Map(Object.entries(solvedSketches)) : undefined,
  );
  // A current native result contains only planes that passed the timeline-stage
  // face check. Pending rebuilds retain the conservative metadata rules.
  const nativePlanes = current && rebuild.result?.availableFaces !== undefined;
  const plane = nativePlanes
    ? rebuild.result?.sketchPlanes?.[sketch.id]
    : planes.transforms.get(sketch.id);
  if (!plane)
    throw new Error(
      (nativePlanes
        ? rebuild.result?.errors.find(
            (error) =>
              error.source === "sketch" && error.sourceId === sketch.id,
          )?.message
        : undefined) ??
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
  sizes: CanvasSizeInput = {},
) {
  const state = useCadStore.getState();
  if (state.history.present !== expected)
    throw new Error("Project changed during drawing. Cancel and draw again.");
  const context = canvasContext(active, state),
    result = addSizedCanvasGeometry(
      context.sketch,
      context.solved,
      tool,
      points,
      construction,
      clockwise,
      sizes,
      evaluateParameters(context.document.parameters).values,
      context.document.unitSettings.length,
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

export function commitCanvasPointMove(
  active: CanvasSession,
  expected: CadStore["history"]["present"],
  pointId: string,
  target: CanvasPoint,
) {
  const state = useCadStore.getState();
  if (state.history.present !== expected)
    throw new Error(
      "Project changed during the point move. Cancel and try again.",
    );
  const context = canvasContext(active, state),
    updated = movedCanvasPoint(context.sketch, pointId, target);
  const before = context.solved.points[pointId];
  if (
    before &&
    Math.hypot(before.x - target.x, before.y - target.y) <= SKETCH_TOLERANCE
  )
    return;
  if (
    Object.values(context.solved.points).some(
      (p) =>
        p.id !== pointId &&
        Math.hypot(p.x - target.x, p.y - target.y) <= SKETCH_TOLERANCE,
    )
  )
    throw new Error(
      "Another point occupies these coordinates. Point moves preserve IDs; use geometry or constraint editing to connect points.",
    );
  const parameters = evaluateParameters(context.document.parameters).values;
  const solved = solveSketch(updated, parameters);
  const error = solved.errors.find((e) => e.severity === "error");
  if (error)
    throw new Error(`Point move would invalidate the sketch: ${error.message}`);
  const point = solved.points[pointId];
  if (
    !point ||
    Math.hypot(point.x - target.x, point.y - target.y) > SKETCH_TOLERANCE
  )
    throw new Error(
      "The solver cannot honor this point move. Edit dimensions or constraints instead.",
    );
  if (
    Object.values(solved.points).some(
      (p) =>
        p.id !== pointId &&
        Math.hypot(p.x - point.x, p.y - point.y) <= SKETCH_TOLERANCE,
    )
  )
    throw new Error(
      "Another point occupies these coordinates after solving. Point moves preserve IDs; use geometry or constraint editing to connect points.",
    );
  const next = upsertSketch(context.document, updated);
  assertProjectJsonShape(next);
  state.updateDocument((d) => (d === expected ? next : d));
  if (useCadStore.getState().history.present === expected)
    throw new Error(
      "Point move could not be saved. Check the project diagnostics.",
    );
}

export function commitCanvasDeformation(
  active: CanvasSession,
  expected: CadStore["history"]["present"],
  pointId: string,
  target: CanvasPoint,
) {
  const state = useCadStore.getState();
  if (state.history.present !== expected)
    throw new Error(
      "Project changed during deformation. Cancel and try again.",
    );
  const context = canvasContext(active, state);
  const result = deformedCanvasSketch(
    context.sketch,
    context.solved,
    pointId,
    target,
  );
  if (result.unchanged) return;
  const solved = solveSketch(
    result.sketch,
    evaluateParameters(context.document.parameters).values,
  );
  validateCanvasDeformation(context.solved, solved, result.targets);
  const next = upsertSketch(context.document, result.sketch);
  assertProjectJsonShape(next);
  state.updateDocument((document) => (document === expected ? next : document));
  if (useCadStore.getState().history.present === expected)
    throw new Error(
      "Deformation could not be saved. Check project diagnostics.",
    );
}

export function commitCanvasTranslation(
  active: CanvasSession,
  expected: CadStore["history"]["present"],
  pointId: string,
  target: CanvasPoint,
) {
  const state = useCadStore.getState();
  if (state.history.present !== expected)
    throw new Error(
      "Project changed during translation. Cancel and try again.",
    );
  const context = canvasContext(active, state),
    result = translatedCanvasGroup(
      context.sketch,
      context.solved,
      pointId,
      target,
    );
  if (result.unchanged) return;
  const solved = solveSketch(
    result.sketch,
    evaluateParameters(context.document.parameters).values,
  );
  validateCanvasTranslation(context.solved, solved, result.targets);
  const next = upsertSketch(context.document, result.sketch);
  assertProjectJsonShape(next);
  state.updateDocument((d) => (d === expected ? next : d));
  if (useCadStore.getState().history.present === expected)
    throw new Error(
      "Translation could not be saved. Check project diagnostics.",
    );
}

export function commitCanvasConstraintReferences(
  active: CanvasSession,
  expected: CadStore["history"]["present"],
  id: string,
  references?: { entityIds: string[]; pointIds: string[] },
) {
  const state = useCadStore.getState();
  if (state.history.present !== expected)
    throw new Error(
      "Project changed. Apply the constraint repair again for the current sketch.",
    );
  const context = canvasContext(active, state, true);
  if (!context.sketch.constraints.some((c) => c.id === id))
    throw new Error("Constraint reference lost. Select a current constraint.");
  const updated = references
    ? withCanvasConstraintReferences(
        context.sketch,
        id,
        references.entityIds,
        references.pointIds,
      )
    : {
        ...context.sketch,
        constraints: context.sketch.constraints.filter((c) => c.id !== id),
      };
  if (updated === context.sketch) return;
  const next = upsertSketch(context.document, updated);
  assertProjectJsonShape(next);
  state.updateDocument((d) => (d === expected ? next : d));
  if (useCadStore.getState().history.present === expected)
    throw new Error(
      "Constraint repair could not be saved. Check project diagnostics.",
    );
}
