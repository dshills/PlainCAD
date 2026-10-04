import {
  currentPlaneChoices,
  alignToSketchPlane,
  useSketchPlanePicker,
} from "./sketchPlanePicker";
import type { FacePlaneReference } from "../../cad/document/schema";
import { create } from "zustand";
import { useCadStore, type CadStore } from "../../state/useCadStore";
import { addComponent } from "../../cad/document/components";
import { upsertSketch } from "../../cad/document/CadDocument";
import { createSketchOnPlane } from "../../cad/sketch/SketchModel";
import { beginSketchCanvas, useSketchCanvas } from "./sketchCanvasCommand";

interface WorkflowSession {
  session: number;
  documentId: string;
  componentId: string;
  kind: "component" | "sketch";
}
export const useProjectWorkflow = create<{ active?: WorkflowSession }>(
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
  useSketchPlanePicker.setState({ hover: undefined, error: undefined });
  useProjectWorkflow.setState({
    active: {
      kind,
      session: state.documentSession,
      documentId: state.history.present.id,
      componentId: activeComponentId(state),
    },
  });
}
export function workflowCurrent(
  active: WorkflowSession,
  state = useCadStore.getState(),
): boolean {
  return (
    !state.fileBusy &&
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
    const sketch = {
      ...createSketchOnPlane(
        `Sketch ${Object.keys(state.history.present.sketches).length + 1}`,
        choice.reference,
      ),
      componentId: active.componentId,
    };
    const before = state.history.present;
    state.updateDocument((document) => upsertSketch(document, sketch));
    if (useCadStore.getState().history.present === before)
      throw new Error(
        "Sketch could not be created. Check project diagnostics.",
      );
    state.select({ kind: "sketch", id: sketch.id, documentId: before.id });
    alignToSketchPlane(choice);
    beginSketchCanvas();
  }
  useProjectWorkflow.setState({ active: undefined });
}
export function finishSketchCanvas() {
  const active = useSketchCanvas.getState().active,
    state = useCadStore.getState();
  useSketchCanvas.setState({ active: undefined });
  if (
    active &&
    !state.fileBusy &&
    active.session === state.documentSession &&
    active.documentId === state.history.present.id &&
    state.history.present.sketches[active.sketchId]
  )
    state.select({
      kind: "sketch",
      id: active.sketchId,
      documentId: active.documentId,
    });
}
