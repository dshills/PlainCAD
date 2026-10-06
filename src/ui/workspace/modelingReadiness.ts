import type { CadStore } from "../../state/useCadStore";
import { bodyComponentId, sketchComponentId } from "../../cad/document/components";
import type { RebuildError } from "../../cad/worker/workerProtocol";
import type { CommandEnablement } from "../commands/commandRegistry";
import { isCommandEnabledForSnapshot } from "../commands/commandRegistry";
import { selectionForRepairIssue } from "../commands/repairCommand";

export type ModelingReadiness =
  | "waiting"
  | "empty-project"
  | "empty-sketch"
  | "open-sketch"
  | "broken-sketch"
  | "ready-sketch"
  | "failed-model"
  | "ready-solid"
  | "feature"
  | "choose";
export interface NextModelingAction {
  state: ModelingReadiness;
  title: string;
  description: string;
  command?: string;
  label?: string;
  sketchId?: string;
  issue?: RebuildError;
  note?: string;
}
export type ReadinessSnapshot = Pick<
  CadStore,
  "history" | "selection" | "rebuild" | "activeComponentId" | "fileBusy"
>;

/** Read current worker analysis; never infer readiness from old meshes or solve in React. */
export function nextModelingAction(state: ReadinessSnapshot): NextModelingAction {
  const document = state.history.present;
  const result = state.rebuild.result;
  const settled = state.rebuild.status === "succeeded" || state.rebuild.status === "failed";
  if (!settled || (result && result.documentId !== document.id)) {
    return {
      state: "waiting",
      title: "Checking your model",
      description: "Wait for the current rebuild. Sketch profiles and solids from the previous result are not ready to use.",
    };
  }
  const firstSelected = state.selection.selectedIds[0];
  const selected = firstSelected?.documentId === document.id ? firstSelected : undefined;
  const sketches = Object.values(document.sketches).filter(
    (sketch) => sketchComponentId(document, sketch.id) === state.activeComponentId,
  );
  const sketch = selected?.kind === "sketch"
    ? sketches.find((item) => item.id === selected.id)
    : selected?.kind === "sketchEntity"
      ? sketches.find((item) => Object.hasOwn(item.entities, selected.id))
      : undefined;
  if (sketch && result) {
    const issue = result.errors.find((item) => item.source === "sketch" && item.sourceId === sketch.id);
    const solved = result.solvedSketches?.[sketch.id];
    if (issue || solved?.errors.length || (result.success && state.rebuild.status === "succeeded" && result.sketchPlanes !== undefined && !result.sketchPlanes[sketch.id])) {
      return {
        state: "broken-sketch",
        title: "Repair this sketch",
        description: issue?.message ?? solved?.errors[0]?.message ?? "This sketch's plane is unavailable. Choose an available supported plane in its properties before modeling.",
        command: issue ? "repair.focus" : undefined,
        label: issue ? "Show and repair sketch" : undefined,
        sketchId: sketch.id,
        issue,
      };
    }
  }
  if (state.rebuild.status === "failed" || result?.success === false) {
    const issue = result?.errors[0];
    return {
      state: "failed-model",
      title: "Repair the model first",
      description: issue?.message ?? state.rebuild.message ?? "The current rebuild failed. Open Issues to inspect the inputs before adding features or exporting geometry.",
      command: issue && selectionForRepairIssue(issue, document) ? "repair.focus" : undefined,
      label: issue && selectionForRepairIssue(issue, document) ? "Show and repair issue" : undefined,
      issue,
      note: "STL export requires a successful rebuild of the current project.",
    };
  }
  if (sketch) {
    const hasBoundary = Object.values(sketch.entities).some(
      (entity) => entity.type !== "point" && !entity.construction,
    );
    if (!hasBoundary) {
      return {
        state: "empty-sketch",
        title: "Draw your outline",
        description: "Open this sketch and draw a rectangle, circle, or closed outline. Construction geometry helps you draw but does not make a solid boundary.",
        command: "sketch.editCanvas",
        label: "Draw in this sketch",
        sketchId: sketch.id,
      };
    }
    if (!result?.solvedSketches?.[sketch.id] || !result.sketchPlanes) {
      return {
        state: "waiting",
        title: "Checking this sketch",
        description: "Current sketch analysis is unavailable. Wait for the geometry worker before using a profile.",
        sketchId: sketch.id,
      };
    }
    if (!result.profiles?.[sketch.id]?.length) {
      return {
        state: "open-sketch",
        title: "Close or repair your outline",
        description: "This sketch has no usable closed profile. Join open endpoints or repair intersecting geometry in the drawing before Extrude.",
        command: "sketch.editCanvas",
        label: "Edit sketch",
        sketchId: sketch.id,
        note: result.warnings.find((item) => item.sourceId === sketch.id && item.id.startsWith("profile:"))?.message,
      };
    }
    const solved = result.solvedSketches[sketch.id];
    return {
      state: "ready-sketch",
      title: "Make it solid",
      description: "This sketch has a closed profile. Set a thickness or drag the distance handle, inspect the native preview, then Apply.",
      command: "feature.extrude",
      label: "Extrude sketch",
      sketchId: sketch.id,
      note: solved.status === "underconstrained" && solved.degreesOfFreedom > 0
        ? "Some geometry can still move. You may Extrude now, or add driving dimensions and constraints to lock the intended shape."
        : undefined,
    };
  }
  if (selected?.kind === "feature" && document.features.some((feature) => feature.id === selected.id)) {
    return {
      state: "feature",
      title: "Refine this feature",
      description: "Edit this feature to inspect a native preview before applying changes. Use History to select a different modeling step.",
      command: "feature.edit",
      label: "Edit feature",
    };
  }
  const solid = selected?.kind === "body"
    ? result?.meshes.find((mesh) => mesh.bodyId === selected.id)
    : result?.meshes.find((mesh) => bodyComponentId(document, mesh.bodyId) === state.activeComponentId);
  if (solid) {
    const native = solid.geometrySource === "opencascade" && solid.geometryAssertions?.valid === true;
    return {
      state: "ready-solid",
      title: native ? "Refine your solid" : "Inspect geometry availability",
      description: native
        ? "Select a feature in History to change its dimensions, or place holes on a supported planar face. Draw another sketch to add or remove material."
        : "The current mesh uses fallback geometry. Native face and edge operations require OpenCascade; inspect Issues for the supported limits.",
      command: native ? "feature.guidedHole" : undefined,
      label: native ? "Place holes on face" : undefined,
    };
  }
  if (!sketches.length && (document.features.length || Object.keys(document.sketches).length)) {
    return {
      state: "choose",
      title: "Draw in this component",
      description: "This active component has no sketch or current solid. Create a sketch here, or activate an existing component in Project to work on its geometry.",
      command: "sketch.create",
      label: "Create sketch",
    };
  }
  return sketches.length
    ? {
        state: "choose",
        title: "Choose a sketch to work on",
        description: "Select a sketch in Project or on the canvas to check its outline and make it solid. Start another sketch to draw a different shape.",
        command: "sketch.create",
        label: "Create sketch",
      }
    : {
        state: "empty-project",
        title: "Start your part",
        description: "Name your part in the center, then choose Draw or Describe. PlainCAD creates its component and sketch inside this project for you.",
      };
}

/** The registry remains authoritative; these explanations never enable an action. */
export function modelingPrerequisite(
  command: string,
  state: ReadinessSnapshot,
  enablement: CommandEnablement,
): string | undefined {
  if (isCommandEnabledForSnapshot(command, enablement)) return;
  if (state.fileBusy) return "Wait for the current file operation to finish.";
  if (!["succeeded", "failed"].includes(state.rebuild.status) &&
    ["feature.extrude", "feature.guidedHole", "feature.hole"].includes(command)) {
    return "Wait for the current rebuild before using sketch profiles or native solids.";
  }
  if (enablement.finishSketch && command.startsWith("feature.")) {
    return "Finish Sketch before using a solid-modeling action.";
  }
  if (command === "feature.edit" && !state.rebuild.kernelReady) {
    return "Feature preview editing requires OpenCascade. Inspect Issues if the kernel could not load.";
  }
  const prerequisites: Record<string, string> = {
    "feature.extrude": "Select a sketch with a usable closed profile. Repair its geometry or plane before extruding.",
    "feature.guidedHole": "A current native solid with a supported planar face is required. Select or create one before placing holes.",
    "feature.hole": "Select a sketch containing hole-center points and rebuild native target solids before creating a hole.",
    "feature.edit": "Select an editable Extrude, Revolve, Hole, Fillet or Chamfer feature in History.",
    "feature.delete": "Select a feature in History before deleting a modeling step.",
    "feature.suppress": "Select a feature in History before changing its suppression.",
    "repair.focus": "Finish or cancel the current task before repairing a model issue.",
    "component.create": "Finish the current task or file operation, and keep the project below its component limit.",
    "sketch.create": "Finish or cancel the current task before starting another sketch.",
    "sketch.editCanvas": "Select a sketch and finish or cancel the current task before opening its drawing.",
  };
  return prerequisites[command] ?? "Finish or cancel the current task before continuing.";
}
