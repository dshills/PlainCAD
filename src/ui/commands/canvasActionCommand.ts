import { featureComponentId } from "../../cad/document/components";
import { useCadStore } from "../../state/useCadStore";
import { useViewerState } from "../../state/viewerState";
import { canvasActionTargetCurrent, type CanvasActionTarget } from "./canvasActionTarget";
import { runCommand, selectCommandEnablement } from "./commandRegistry";

export async function runCanvasBodyAction(action: "edit" | "delete" | "hide" | "isolate", target?: CanvasActionTarget) {
  const state = useCadStore.getState();
  if (!target || !selectCommandEnablement(state).canvasBodyActions || !canvasActionTargetCurrent(target, state))
    throw new Error("Model or selection changed. Select the current visible part again.");
  const ids = target.result.bodies.map(body => body.id);
  const view = useViewerState.getState();
  if (action === "hide") {
    view.toggleBody(target.session, target.bodyId, ids);
    state.select(undefined);
    return;
  }
  if (action === "isolate") {
    useViewerState.setState({ session: target.session, hiddenComponentIds: [], hiddenBodyIds: ids.filter(id => id !== target.bodyId) });
    return;
  }
  const feature = target.document.features.find(item => item.id === target.featureId);
  if (!feature) throw new Error("This part has no supported creating feature. Use its timeline controls.");
  if (action === "edit" && !["extrude", "revolve"].includes(feature.type))
    throw new Error("Edit this feature using its timeline controls.");
  state.activateComponent(featureComponentId(target.document, feature));
  state.select({ kind: "feature", id: feature.id, documentId: target.document.id });
  const available = selectCommandEnablement(useCadStore.getState());
  if (!(action === "edit" ? available.editFeature : available.selectedFeature)) {
    state.activateComponent(state.activeComponentId);
    state.select(state.selection.selectedIds[0]);
    throw new Error("The creating feature cannot be edited here. Use its timeline controls.");
  }
  await runCommand(action === "edit" ? "feature.edit" : "feature.delete");
}
