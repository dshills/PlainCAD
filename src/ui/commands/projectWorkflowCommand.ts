import { withComponentPlacement, positionedDocument } from "../../cad/document/componentPlacement";
import {
  currentPlaneChoices,
  alignToSketchPlane,
  useSketchPlanePicker,
} from "./sketchPlanePicker";
import { evaluateExpressionRef, evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { transformPoint } from "../../cad/sketch/planes";
import type { SketchPlaneReference, FacePlaneReference } from "../../cad/document/schema";
import { create } from "zustand";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { createPartSketch } from "../../cad/document/partCreation";
import { addComponent } from "../../cad/document/components";
import { upsertSketch } from "../../cad/document/CadDocument";
import { createSketchOnPlane } from "../../cad/sketch/SketchModel";
import { beginSketchCanvas, useSketchCanvas } from "./sketchCanvasCommand";
import { beginSketchSolidHandoff } from "./sketchSolidHandoffCommand";
import { useWorkspaceState } from "../../state/useWorkspaceState";

interface WorkflowSession {
  session: number;
  documentId: string;
  componentId: string;
  kind: "component" | "sketch";
  partName?: string;
}
export const useProjectWorkflow = create<{
  active?: WorkflowSession;
  startName?: { name: string; documentId: string; session: number };
}>(
  () => ({}),
);
export function activeComponentId(state: CadStore): string {
  const document = state.history.present;
  return Object.hasOwn(document.components, state.activeComponentId)
    ? state.activeComponentId
    : document.rootComponentId;
}
export function beginProjectWorkflow(kind: WorkflowSession["kind"]) {
  const state = useCadStore.getState();
  if (state.fileBusy) return;
  useSketchPlanePicker.setState({ hover: undefined, error: undefined, offset: undefined });
  useProjectWorkflow.setState({
    active: {
      kind,
      session: state.documentSession,
      documentId: state.history.present.id,
      componentId: activeComponentId(state),
    },
  });
}
export function beginPartDrawing(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120)
    throw new Error("Part name must contain 1–120 characters.");
  if (useCadStore.getState().fileBusy) return;
  beginProjectWorkflow("sketch");
  useProjectWorkflow.setState((state) => ({
    active: state.active ? { ...state.active, partName: trimmed } : undefined,
  }));
}
export function workflowCurrent(
  active: WorkflowSession,
  state = useCadStore.getState(),
): boolean {
  return (
    !state.fileBusy &&
    useProjectWorkflow.getState().active === active &&
    active.session === state.documentSession &&
    active.documentId === state.history.present.id &&
    active.componentId === activeComponentId(state)
  );
}
export function finishProjectWorkflow(
  active: WorkflowSession,
  nameOrPlane: string | FacePlaneReference,
) {
  const state = useCadStore.getState();
  if (!workflowCurrent(active, state))
    throw new Error(
      "Project or active component changed. Start this command again.",
    );
  if (active.kind === "component") {
    if (typeof nameOrPlane !== "string")
      throw new Error("Enter a component name.");
    const result = addComponent(state.history.present, nameOrPlane),
      before = state.history.present;
    state.updateDocument((document) =>
      document === before ? result.document : document,
    );
    if (useCadStore.getState().history.present === before)
      throw new Error(
        "Component could not be created. Check project diagnostics.",
      );
    state.activateComponent(result.component.id);
  } else {
    const choice = currentPlaneChoices(state).find((item) =>
      typeof nameOrPlane === "string"
        ? item.reference === nameOrPlane
        : typeof item.reference !== "string" &&
          item.reference.featureId === nameOrPlane.featureId &&
          item.reference.stableFaceId === nameOrPlane.stableFaceId,
    );
    if (!choice)
      throw new Error(
        "Choose a current supported origin plane or native planar face.",
      );
    const offset = useSketchPlanePicker.getState().offset;
    let reference: SketchPlaneReference = typeof choice.reference === "string" ? { type: "origin", plane: choice.reference } : choice.reference;
    let transform = choice.transform;
    if (offset !== undefined) {
      const evaluation = evaluateParameters(state.history.present.parameters);
      if (evaluation.errors.length) throw new Error(`Repair project parameters before creating an offset plane: ${evaluation.errors[0].message}`);
      // Millimeters are canonical; authoredUnit supplies the meaning of bare numbers.
      reference = { type: "offset", base: choice.reference, offset: { expression: offset, unit: "mm", authoredUnit: state.history.present.unitSettings.length } };
      // Resolve with the selected native face's measured basis, preserving its normal.
      const evaluated = evaluateExpressionRef(reference.offset, { parameters: evaluation.values });
      if (evaluated.error || evaluated.quantity?.dimension !== "length") throw new Error(evaluated.error ?? "Offset must resolve to a length.");
      transform = { ...choice.transform, origin: transformPoint(choice.transform, 0, 0, evaluated.quantity.value) };
    }
    const initialPart = active.partName
      ? createPartSketch(state.history.present, active.partName, reference)
      : undefined;
    const sketch = initialPart?.sketch ?? {
      ...createSketchOnPlane(
        `Sketch ${Object.keys(state.history.present.sketches).length + 1}`,
        reference,
      ),
      componentId: active.componentId,
    };
    const before = state.history.present;
    // Store edits bind offset parameter tokens to stable IDs before publication.
    state.updateDocument((document) => {
      if (document !== before) return document;
      if (initialPart) {
        const live = useCadStore.getState();
        const result = live.history.present === document && live.rebuild.status === "succeeded" ? live.rebuild.result : undefined;
        const placement = positionedDocument(document, result).components[active.componentId]?.placement;
        return placement ? withComponentPlacement(initialPart.document, initialPart.sketch.componentId!, placement) : initialPart.document;
      }
      return upsertSketch(document, sketch);
    });
    const published = useCadStore.getState().history.present;
    if (
      published === before ||
      !Object.hasOwn(published.sketches, sketch.id) ||
      published.sketches[sketch.id].componentId !== sketch.componentId ||
      (initialPart && !Object.hasOwn(published.components, initialPart.component.id))
    )
      throw new Error(
        "Sketch could not be created. Check project diagnostics or start drawing again.",
      );
    if (initialPart) state.activateComponent(initialPart.component.id);
    state.select({ kind: "sketch", id: sketch.id, documentId: before.id });
    alignToSketchPlane({ ...choice, transform });
    beginSketchCanvas();
  }
  useProjectWorkflow.setState({ active: undefined });
}
export function finishSketchCanvas() {
  const active = useSketchCanvas.getState().active,
    state = useCadStore.getState();
  useSketchCanvas.setState({ active: undefined, selection: undefined });
  if (
    active &&
    !state.fileBusy &&
    active.session === state.documentSession &&
    active.documentId === state.history.present.id &&
    state.history.present.sketches[active.sketchId]
  ) {
    state.select({
      kind: "sketch",
      id: active.sketchId,
      documentId: active.documentId,
    });
    // The automatic first-solid handoff belongs to the guided Workbench. Editing
    // a consumed sketch rebuilds its existing features and leaves Undo/Save free.
    if (useWorkspaceState.getState().layout === "workbench" &&
        !state.history.present.features.some((feature) => !feature.suppressed &&
          "sketchId" in feature && feature.sketchId === active.sketchId))
      beginSketchSolidHandoff(active.sketchId, true);
  }
}
