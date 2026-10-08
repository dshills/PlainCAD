import { canNavigateLinkedSketchSource, type LinkedSketchContext } from "./linkedSketchCommand";
import { beginProjectGallery } from "../workspace/projectGalleryState";
import { unplacePlane } from "../../cad/document/componentPlacement";
import { beginComponentPlacement, canBeginComponentPlacement } from "./componentPlacementCommand";
import { beginPartLibrary, canOpenPartLibrary } from "./partLibraryCommand";
import { useInspectionState } from "../../state/inspectionState";
import { useWorkspaceState } from "../../state/useWorkspaceState";
import { canOpenSketchProjection, openSketchProjection } from "./sketchProjectionCommand";
import { beginInsertProject, canInsertProject } from "./reusablePartCommand";
import { beginFacePocket, canBeginFacePocket, cancelFacePocket, useFacePocket } from "./facePocketCommand";
import { interactionDraftBusy } from "./interactionDraftState";
import { openSketchReplication, canOpenSketchReplication } from "./sketchReplicationCommand";
import { openSketchOffset, canOpenSketchOffset } from "./sketchOffsetCommand";
import { openSketchTrimExtend } from "./sketchTrimExtendCommand";
import { beginSolidDimensionEdit, solidDimensionEditingAvailable } from "./solidDimensionCommand";
import type { SolidDimension } from "../../cad/inspection/solidDimensions";
import { canMakeSketchSolid, makeSketchSolid, canRemoveSketchMaterial, removeSketchMaterial, chooseSketchSolidRegion, cancelSketchSolidHandoff, useSketchSolidHandoff } from "./sketchSolidHandoffCommand";
import { beginOperationDrop, chooseOperationDropTarget, cancelOperationDrop, canBeginOperationDrop, operationDraftBusy, useOperationDrop, type DropOperation, type OperationDropFrame } from "./operationDropCommand";
import { beginSaveOrExport, canBeginSaveOrExport, saveOrExportBlocked } from "./guidedExportCommand";
import { beginGuidedHole, cancelGuidedHole, canBeginGuidedHole, useGuidedHole } from "./guidedHoleCommand";
import { beginExtrudeCreation, beginExtrudeEditing, editableExtrude, useExtrudeDraft } from "./extrudeCommand";
import { beginModelingCreation, beginModelingEditing, editableModelingFeature, useModelingDraft } from "./modelingDraftCommand";
import { beginFeaturePattern, beginFeaturePatternEditing, selectedPattern, selectedPatternSource } from "./featurePatternCommand";
import { useViewerState } from "../../state/viewerState";
import { selectedCanvasActionTarget, type CanvasActionTarget } from "./canvasActionTarget";
import { toggleAiDrawer, closeAiDrawer, beginPartDescription, useAiDrawer } from "./aiCommand";
import { activeComponentId, beginPartDrawing, beginProjectWorkflow, finishSketchCanvas, useProjectWorkflow } from "./projectWorkflowCommand";
import { renameComponent, sketchComponentId } from "../../cad/document/components";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";
import { beginSketchCanvasTool, canBeginSketchCanvasTool, beginSketchCanvas, deleteSelectedCanvasEntity, selectedCanvasEntity, selectedCanvasSketch, selectAllCanvasEntities, canSelectAllCanvasEntities, useSketchCanvas } from "./sketchCanvasCommand";
import { canCaptureTargetScope, captureSelectedTargetScope, useTargetScopeCapture } from "./targetScopeCaptureCommand";
import { captureCamera, restoreCamera, showStandardView } from "../../viewer/cameraController";
import { MAX_NAMED_VIEWS, STANDARD_VIEWS, saveNamedCamera, unusedViewName } from "../../cad/inspection/cameraViews";
import { useSectionState } from "../../state/sectionState";
import {
  beginFileJob,
  finishFileJob,
  fileJobCurrent,
  runFabrication,
  useFileJobs,
  openFabrication,
} from "../../persistence/fileJobs";
import { saveRecovery } from "../../persistence/autosave";
import { RefObject } from "react";
import { CadStore, useCadStore } from "../../state/useCadStore";
import { canOpenStepExport, openStepExport } from "./stepExportCommand";
import {
  createBoxTemplate,
  createMountingPlateTemplate,
} from "../../templates/templates";
import { importProjectFile } from "../../persistence/importProject";
import {
  downloadArrayBuffer,
  downloadProject,
  projectFilename as makeProjectFilename,
  serializeProject,
} from "../../persistence/exportProject";
import {
  createEmptyDocument,
  deleteFeature,
  suppressFeature,
  upsertFeature,
  upsertSketch,
} from "../../cad/document/CadDocument";
import {
  addCenterRectangle,
  addCircleAt,
  addCornerRectangle,
  createSketchOnPlane,
  createXySketch,
} from "../../cad/sketch/SketchModel";
import { createId } from "../../cad/document/ids";
import { createExtrudeEdgeRef } from "../../cad/features/topologyRefs";
import { stableBodyIdForFeature } from "../../cad/features/featureGraph";
import {
  CadDocument,
  OriginPlane,
  RevolveAxisReference,
} from "../../cad/document/schema";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { ResolvedSketch, solveSketch } from "../../cad/sketch/SketchSolver";
import { resolveDocumentPlanes } from "../../cad/sketch/planes";
import {
  resolveRevolveAxis,
  RevolveAxisValidationError,
} from "../../cad/features/revolveAxis";
import {
  SketchProfile,
  detectProfiles,
} from "../../cad/sketch/profileDetection";
import { moveTimelineItem, planTimelineMove } from "../../cad/document/timelineEditing";
import { beginHoleCreation, beginHoleEditing, editableHole, holeCreationContext, useHoleDraft } from "./holeCommand";
import { prepareProjectDrop, replaceWithDroppedProject, saveAndReplaceDroppedProject } from "./projectDropCommand";
import { focusRepairIssue, addRepairClosingEdge, type RepairContext } from "./repairCommand";
import { canUndoAiChange, canRedoAiChange, type AiHistoryTransaction } from "./aiHistoryState";
import { beginAiFacePicking, clearAiFacePicking } from "../../state/aiFacePicking";
import { currentAiCanvasPreview, clearAiCanvasPreview } from "../../state/aiCanvasPreview";

async function exportCurrentPng(scope: "project" | "body" | "sketch") {
  const captured = useCadStore.getState(), canvas = useSketchCanvas.getState().active;
  const { exportPng } = await import("../../persistence/exportPng");
  const current = useCadStore.getState();
  if (current.history.present !== captured.history.present || current.documentSession !== captured.documentSession ||
      current.rebuild.result !== captured.rebuild.result || current.selection !== captured.selection ||
      useSketchCanvas.getState().active !== canvas || current.fileBusy) {
    current.setFileError("Project or image selection changed. Request the current PNG again.");
    return;
  }
  await exportPng(scope);
}

export interface CommandContext {
  aiHistory?: AiHistoryTransaction;
  canvasTarget?: CanvasActionTarget;
  linkedSketchTarget?: LinkedSketchContext;
  dimension?: SolidDimension;
  operation?: DropOperation;
  operationFrame?: OperationDropFrame;
  operationTargetId?: string;
  repair?: RepairContext;
  sketchId?: string;
  componentId?: string;
  componentName?: string;
  projectName?: string;
  viewName?: string;
  viewId?: string;
  documentSession?: number;
  studio?: import("./studioCommand").StudioCommandContext;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  file?: File;
}

export interface CadCommand {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  alwaysEnabled?: boolean;
  /** Context-only browser actions are excluded from the palette. */
  internal?: boolean;
  enablementKey?: keyof CommandEnablement;
  run: (ctx: CommandContext) => Promise<void> | void;
}

export interface CommandEnablement {
  aiAssistant: boolean;
  linkedSketchShowSource: boolean;
  linkedSketchEditSource: boolean;
  canvasBodyActions: boolean;
  canvasEditBase: boolean;
  canvasDeleteBase: boolean;
  moveComponent: boolean;
  partLibrary: boolean;
  projectSketchEdges: boolean;
  insertProject: boolean;
  measurementPicking: boolean;
  createFacePocket: boolean;
  removeSketchMaterial: boolean;
  trimSketch: boolean;
  replicateSketch: boolean;
  offsetSketch: boolean;
  editSolidDimension: boolean;
  makeSketchSolid: boolean;
  createOperationDrop: boolean;
  operationTarget: boolean;
  repairModel: boolean;
  document: boolean;
  editProject: boolean;
  newComponent: boolean;
  createSketch: boolean;
  finishSketch: boolean;
  undo: boolean;
  redo: boolean;
  undoAiChange: boolean;
  redoAiChange: boolean;
  saveOrExport: boolean;
  exportStl: boolean;
  exportStep: boolean;
  exportSelectedBody: boolean;
  exportProjectPng: boolean;
  exportBodyPng: boolean;
  exportSketchPng: boolean;
  saveNamedView: boolean;
  restoreNamedView: boolean;
  createExtrude: boolean;
  createRevolve: boolean;
  selectedFeature: boolean;
  editFeature: boolean;
  createEdgeTreatment: boolean;
  moveEarlier: boolean;
  moveLater: boolean;
  createHole: boolean;
  createFeaturePattern: boolean;
  createGuidedHole: boolean;
  guidedHoleActive: boolean;
  outsideGuidedHole: boolean;
  captureTargetScope: boolean;
  sketchCanvas: boolean;
  drawSketch: boolean;
  deleteSketchEntity: boolean;
  selectAllSketchEntities: boolean;
}

export function selectCommandEnablement(state: CadStore, scopeCaptureBusy = useTargetScopeCapture.getState().busy, canvasActive = Boolean(useSketchCanvas.getState().active), guidedHoleActive = Boolean(useGuidedHole.getState().draft), guidedHoleStartBlocked = Boolean(useExtrudeDraft.getState().draft || useHoleDraft.getState().draft || useModelingDraft.getState().draft || useProjectWorkflow.getState().active), exportDialogOpen = useFileJobs.getState().exportOpen, operationBusy = operationDraftBusy(), operationFrameActive = Boolean(useOperationDrop.getState().frame)): CommandEnablement {
  const refinementBusy = interactionDraftBusy();
  const facePickerActive = Boolean(useFacePocket.getState().frame);
  const aiPreviewActive = Boolean(currentAiCanvasPreview(state));
  const handoffReady = !aiPreviewActive && !facePickerActive && !refinementBusy && !guidedHoleActive && !exportDialogOpen && !guidedHoleStartBlocked && !state.fileBusy && canMakeSketchSolid(state);
  const transientPickerActive = facePickerActive || guidedHoleActive || operationBusy || exportDialogOpen || refinementBusy;
  const targetPickerActive = transientPickerActive || aiPreviewActive;
  const canvasTarget = selectedCanvasActionTarget(state);
  const canvasBodyActions = Boolean(canvasTarget && !targetPickerActive && !canvasActive && !guidedHoleStartBlocked && !scopeCaptureBusy && !useInspectionState.getState().picking);
  const base = state.history.present.features.find(feature => feature.id === canvasTarget?.featureId);
  const links = state.history.present.sketches[useSketchCanvas.getState().active?.sketchId ?? ""]?.projections ?? [];
  return {
    aiAssistant: useAiDrawer.getState().open || (!transientPickerActive && !guidedHoleStartBlocked && !scopeCaptureBusy && !state.fileBusy),
    linkedSketchShowSource: !targetPickerActive && !guidedHoleStartBlocked && !state.fileBusy && links.some(link => canNavigateLinkedSketchSource(link.id)),
    linkedSketchEditSource: !targetPickerActive && !guidedHoleStartBlocked && !state.fileBusy && links.some(link => canNavigateLinkedSketchSource(link.id, true)),
    canvasBodyActions,
    canvasEditBase: canvasBodyActions && Boolean(base && (base.type === "extrude" || base.type === "revolve")),
    canvasDeleteBase: canvasBodyActions && Boolean(base),
    projectSketchEdges: !targetPickerActive && !guidedHoleStartBlocked && !state.fileBusy && canOpenSketchProjection(state),
    insertProject: !aiPreviewActive && canInsertProject(state),
    partLibrary: !aiPreviewActive && canOpenPartLibrary(state),
    moveComponent: !aiPreviewActive && canBeginComponentPlacement(state),
    measurementPicking: state.rebuild.status === "succeeded" && Boolean(state.rebuild.result?.success && state.rebuild.result.documentId === state.history.present.id) && !state.fileBusy && !canvasActive && !guidedHoleStartBlocked && !targetPickerActive && !scopeCaptureBusy,
    createFacePocket: !targetPickerActive && !canvasActive && !guidedHoleStartBlocked && !scopeCaptureBusy && canBeginFacePocket(state),
    removeSketchMaterial: handoffReady && canRemoveSketchMaterial(state),
    trimSketch: !targetPickerActive && canvasActive && !guidedHoleStartBlocked && !state.fileBusy,
    replicateSketch: !targetPickerActive && !guidedHoleStartBlocked && !state.fileBusy && canOpenSketchReplication(),
    offsetSketch: !targetPickerActive && !guidedHoleStartBlocked && !state.fileBusy && canOpenSketchOffset(),
    editSolidDimension: !aiPreviewActive && !facePickerActive && solidDimensionEditingAvailable(state),
    makeSketchSolid: handoffReady,
    saveOrExport: canBeginSaveOrExport(state, saveOrExportBlocked(canvasActive, guidedHoleActive, guidedHoleStartBlocked || operationBusy || refinementBusy, exportDialogOpen, scopeCaptureBusy)),
    repairModel: !scopeCaptureBusy && !targetPickerActive && !guidedHoleStartBlocked && !state.fileBusy,
    // The active token stays draggable in its panel; starting another picker is blocked.
    createOperationDrop: !targetPickerActive && !canvasActive && !guidedHoleStartBlocked && canBeginOperationDrop(state),
    operationTarget: operationFrameActive,
    createGuidedHole: !targetPickerActive && !canvasActive && !guidedHoleStartBlocked && canBeginGuidedHole(state),
    guidedHoleActive,
    // Preserve the shared legacy command key while blocking all transient target tasks.
    outsideGuidedHole: !targetPickerActive,
    editProject: !state.fileBusy && !targetPickerActive,
    newComponent: !targetPickerActive && !guidedHoleStartBlocked && !state.fileBusy && !canvasActive && Object.keys(state.history.present.components).length < MODEL_RESOURCE_LIMITS.maxComponents,
    createSketch: !targetPickerActive && !state.fileBusy && !canvasActive,
    finishSketch: !targetPickerActive && canvasActive,
    drawSketch: !targetPickerActive && !guidedHoleStartBlocked && !scopeCaptureBusy && canBeginSketchCanvasTool(state),
    sketchCanvas: !targetPickerActive && !canvasActive && Boolean(selectedCanvasSketch(state)),
    selectAllSketchEntities: !targetPickerActive && canvasActive && canSelectAllCanvasEntities(state),
    deleteSketchEntity: !targetPickerActive && canvasActive && Boolean(selectedCanvasEntity(state)),
    document: Boolean(state.history.present),
    saveNamedView: !targetPickerActive && (state.history.present.viewState?.namedViews?.length ?? 0) < MAX_NAMED_VIEWS,
    restoreNamedView: Boolean(state.history.present.viewState?.namedViews?.length),
    undo: !transientPickerActive && state.history.past.length > 0,
    redo: !transientPickerActive && state.history.future.length > 0,
    undoAiChange: !transientPickerActive && !guidedHoleStartBlocked && !scopeCaptureBusy && canUndoAiChange(state),
    redoAiChange: !transientPickerActive && !guidedHoleStartBlocked && !scopeCaptureBusy && canRedoAiChange(state),
    exportStl: !aiPreviewActive && canExportStl(state) && !state.fileBusy && !operationBusy && !refinementBusy,
    exportStep: !aiPreviewActive && canOpenStepExport(state) && !operationBusy && !refinementBusy,
    exportSelectedBody: !aiPreviewActive && canExportStl(state) && !state.fileBusy && !operationBusy && !refinementBusy && Boolean(selectedExportBody(state)),
    exportProjectPng: canExportStl(state) && !state.fileBusy && !targetPickerActive && !guidedHoleStartBlocked && !canvasActive && !scopeCaptureBusy,
    exportBodyPng: canExportStl(state) && !state.fileBusy && !targetPickerActive && !guidedHoleStartBlocked && !canvasActive && !scopeCaptureBusy && Boolean(selectedExportBody(state)),
    exportSketchPng: canvasActive && !state.fileBusy && !targetPickerActive && !guidedHoleStartBlocked && !scopeCaptureBusy,
    createExtrude: !canvasActive && ((!targetPickerActive && canCreateExtrude(state)) || handoffReady),
    createRevolve: !targetPickerActive && !canvasActive && Boolean(defaultRevolveAxis(state)),
    editFeature: !targetPickerActive && !canvasActive && Boolean(editableExtrude(state) || editableModelingFeature(state) || editableHole(state) || selectedPattern(state)),
    selectedFeature: !targetPickerActive && !canvasActive && Boolean(getSelectedFeature(state)),
    createEdgeTreatment: !targetPickerActive && !canvasActive && Boolean(edgeTreatmentOwner(state)),
    moveEarlier: !targetPickerActive && !canvasActive && !planTimelineMove(state.history.present, state.selection.selectedIds[0], "earlier").reason,
    moveLater: !targetPickerActive && !canvasActive && !planTimelineMove(state.history.present, state.selection.selectedIds[0], "later").reason,
    createHole: !targetPickerActive && !canvasActive && Boolean(holeCreationContext(state)),
    createFeaturePattern: !targetPickerActive && !canvasActive && Boolean(selectedPatternSource(state)),
    captureTargetScope: !targetPickerActive && !canvasActive && canCaptureTargetScope(state,scopeCaptureBusy),
  };
}

export function isCommandEnabledForSnapshot(
  commandId: string,
  enablement: CommandEnablement,
): boolean {
  const command = commandById.get(commandId);
  if (!command) return false;
  if (command.enablementKey) return enablement[command.enablementKey];
  return command.alwaysEnabled === true;
}

export const commands: CadCommand[] = [
  { id: "file.exportProjectPng", label: "Download project view PNG", description: "Capture the current 3D camera, visible bodies and section view without sketch or selection overlays.", enablementKey: "exportProjectPng", run: () => exportCurrentPng("project") },
  { id: "file.exportBodyPng", label: "Download selected part PNG", description: "Select a body, then download a fitted image of that body alone.", enablementKey: "exportBodyPng", run: () => exportCurrentPng("body") },
  { id: "file.exportSketchPng", label: "Download sketch PNG", description: "Open a sketch, then capture the drawing with its visible dimensions and constraints.", enablementKey: "exportSketchPng", run: () => exportCurrentPng("sketch") },
  { id: "sketch.link.showSource", internal: true, label: "Show linked sketch source", enablementKey: "linkedSketchShowSource", run: async ({ linkedSketchTarget }) => { const module = await import("./linkedSketchCommand"); module.showLinkedSketchSource(linkedSketchTarget); } },
  { id: "sketch.link.editSource", internal: true, label: "Edit linked sketch source", enablementKey: "linkedSketchEditSource", run: async ({ linkedSketchTarget }) => { const module = await import("./linkedSketchCommand"); module.editLinkedSketchSource(linkedSketchTarget); } },
  ...(["edit", "delete", "hide", "isolate"] as const).map((action): CadCommand => ({
    id: `canvas.${action}Body`, internal: true,
    label: action === "edit" ? "Edit part base feature" : action === "delete" ? "Delete part base feature" : action === "hide" ? "Hide selected part" : "Isolate selected part",
    enablementKey: action === "edit" ? "canvasEditBase" : action === "delete" ? "canvasDeleteBase" : "canvasBodyActions",
    run: async ({ canvasTarget }) => (await import("./canvasActionCommand")).runCanvasBodyAction(action, canvasTarget),
  })),
  { id: "sketch.facePocket", label: "Draw on face", enablementKey: "createFacePocket", run: () => beginFacePocket() },
  { id: "sketch.removeMaterial", label: "Remove material", enablementKey: "removeSketchMaterial", run: () => removeSketchMaterial() },
  { id: "sketch.trim", label: "Trim sketch curves", enablementKey: "trimSketch", run: () => openSketchTrimExtend("trim") },
  { id: "sketch.extend", label: "Extend sketch curves", enablementKey: "trimSketch", run: () => openSketchTrimExtend("extend") },
  { id: "sketch.mirror", label: "Mirror selected sketch geometry", enablementKey: "replicateSketch", run: () => openSketchReplication("mirror") },
  { id: "sketch.linearPattern", label: "Linear pattern selected sketch geometry", enablementKey: "replicateSketch", run: () => openSketchReplication("linear") },
  { id: "sketch.offsetOutline", label: "Offset sketch outline", enablementKey: "offsetSketch", run: () => openSketchOffset() },
  { id: "sketch.cancelFacePocket", label: "Cancel face selection", alwaysEnabled: true, internal: true, run: () => cancelFacePocket() },
  { id: "project.startDrawing", internal: true, label: "Draw a named part", enablementKey: "newComponent", run: ({ componentName }) => beginPartDrawing(componentName ?? "Part 1") },
  { id: "project.startDescribing", internal: true, label: "Describe a named part", enablementKey: "newComponent", run: ({ componentName }) => beginPartDescription(componentName ?? "Part 1") },
  { id: "feature.editSolidDimension", internal: true, label: "Edit Solid Driving Dimension", enablementKey: "editSolidDimension", run: ({ dimension }) => beginSolidDimensionEdit(dimension) },
  { id: "sketch.solidRegion", internal: true, label: "Choose Sketch Region", enablementKey: "operationTarget", run: ({ operationFrame, operationTargetId }) => chooseSketchSolidRegion(operationFrame, operationTargetId) },
  { id: "sketch.makeSolid", label: "Make Sketch Solid", enablementKey: "makeSketchSolid", run: makeSketchSolid },
  { id: "sketch.cancelSolidHandoff", internal: true, label: "Cancel Sketch Solid", alwaysEnabled: true, run: cancelSketchSolidHandoff },
  { id: "feature.operationTargets", label: "Choose Operation Target", description: "Drag or choose Extrude, Fillet or Chamfer on explicit supported geometry; inspect the native preview before Apply.", enablementKey: "createOperationDrop", run: ({ operation }) => beginOperationDrop(operation) },
  { id: "feature.operationTarget", internal: true, label: "Preview Operation on Target", enablementKey: "operationTarget", run: ({ operationFrame, operationTargetId }) => chooseOperationDropTarget(operationFrame, operationTargetId) },
  { id: "feature.cancelOperationDrop", internal: true, label: "Cancel Operation Targets", alwaysEnabled: true, run: cancelOperationDrop },

  { id: "file.saveOrExport", label: "Save or Export…", description: "Save an editable project or choose bodies to export for printing.", enablementKey: "saveOrExport", run: beginSaveOrExport },
  { id: "repair.focus", internal: true, label: "Show and repair model issue", enablementKey: "repairModel", run: ({ repair }) => { if (repair) focusRepairIssue(repair); } },
  { id: "repair.closeOutline", internal: true, label: "Add missing closing edge", enablementKey: "repairModel", run: ({ repair }) => { if (repair) addRepairClosingEdge(repair); } },
  { id: "sketch.entity.selectAll", internal: true, label: "Select all sketch geometry", enablementKey: "selectAllSketchEntities", run: selectAllCanvasEntities },
  { id: "file.dropProject", internal: true, label: "Open Dropped Project", enablementKey: "editProject", run: ({ file }) => { if (file) return prepareProjectDrop(file); } },
  { id: "file.replaceDroppedProject", internal: true, label: "Replace With Dropped Project", enablementKey: "editProject", run: replaceWithDroppedProject },
  { id: "file.saveAndReplaceDroppedProject", internal: true, label: "Save Current and Open Dropped Project", enablementKey: "editProject", run: saveAndReplaceDroppedProject },
  { id: "feature.guidedHole", label: "Place Holes on Face", description: "Choose a supported planar face, place hole centers, and preview a native inward cut.", enablementKey: "createGuidedHole", run: beginGuidedHole },
  { id: "feature.cancelGuidedHole", internal: true, label: "Cancel Guided Holes", alwaysEnabled: true, run: cancelGuidedHole },
  { id: "sketch.entity.delete", internal: true, label: "Delete selected sketch item", enablementKey: "deleteSketchEntity", run: deleteSelectedCanvasEntity },
  { id: "ai.pickFace", label: "Choose AI target face", internal: true, enablementKey: "measurementPicking", run: () => { beginAiFacePicking(); } },
  { id: "ai.cancelFacePick", label: "Cancel AI face selection", internal: true, alwaysEnabled: true, run: clearAiFacePicking },
  { id: "ai.close", label: "Close AI assistant", internal: true, alwaysEnabled: true, run: closeAiDrawer },
  { id: "ai.toggle", label: "Toggle AI assistant", description: "Open the bottom AI dock to describe changes and review geometry in the main viewport.", enablementKey: "aiAssistant", run: toggleAiDrawer },
  { id: "feature.edit", label: "Edit Selected Feature", description: "Preview changes to the selected Extrude, Revolve, Fillet, Chamfer, Hole or Pattern and its downstream geometry.", enablementKey: "editFeature", run: () => { if (selectedPattern(useCadStore.getState())) beginFeaturePatternEditing(); else if (editableExtrude(useCadStore.getState())) beginExtrudeEditing(); else if (editableHole(useCadStore.getState())) beginHoleEditing(); else beginModelingEditing(); } },
  { id: "feature.pattern", label: "Repeat Hole or Pocket", description: "Select a single-center Hole or distance Cut Extrude, then create a linked linear or circular native feature pattern.", enablementKey: "createFeaturePattern", run: beginFeaturePattern },
  {
    id: "file.renameProject", internal: true, label: "Rename Project", enablementKey: "editProject",
    run: ({ projectName }) => {
      if (projectName === undefined) return;
      const name = projectName.trim(), state = useCadStore.getState();
      if (!name || name.length > 120) { state.setFileError("Project name must contain 1–120 characters."); return; }
      state.updateDocument(document => document.name === name ? document : { ...document, name, updatedAt: new Date().toISOString() });
    },
  },
  { id: "component.move", label: "Move component", description: "Move or rotate the active component with mouse handles or precise numeric coordinates, then apply a validated native preview.", enablementKey: "moveComponent", run: ({ componentId }) => beginComponentPlacement(componentId) },
  { id: "component.create", label: "New Component", enablementKey: "newComponent", run: () => beginProjectWorkflow("component") },
  {
    id: "component.rename", internal: true, label: "Rename Active Component", enablementKey: "editProject",
    run: ({ componentId, componentName }) => {
      if (componentId && componentName !== undefined)
        useCadStore.getState().updateDocument(document => renameComponent(document, componentId, componentName));
    },
  },
  {
    id: "component.activate", internal: true, label: "Activate Component", enablementKey: "editProject",
    run: ({ componentId }) => { if (componentId) useCadStore.getState().activateComponent(componentId); },
  },
  ...(["toggleVisibility", "isolate"] as const).map((action): CadCommand => ({
    id: `component.${action}`, internal: true, label: action === "isolate" ? "Isolate Component" : "Toggle Component Visibility", enablementKey: "document",
    run: ({ componentId, documentSession }) => {
      const state = useCadStore.getState();
      // Context-only component buttons capture their document session; palette entries exclude these commands.
      if (documentSession === undefined || documentSession !== state.documentSession) return;
      if (!componentId || !Object.hasOwn(state.history.present.components, componentId)) return;
      const view = useViewerState.getState(), ids = Object.keys(state.history.present.components);
      if (action === "isolate") view.isolateComponent(state.documentSession, componentId, ids);
      else view.toggleComponent(state.documentSession, componentId, ids);
    },
  })),
  {
    id: "sketch.toggleVisibility", internal: true, label: "Toggle Sketch Visibility", enablementKey: "document",
    run: ({ sketchId, documentSession }) => {
      const state = useCadStore.getState();
      if (documentSession === undefined || documentSession !== state.documentSession || !sketchId || !Object.hasOwn(state.history.present.sketches, sketchId)) return;
      useViewerState.getState().toggleSketch(documentSession, sketchId, Object.keys(state.history.present.sketches));
    },
  },
  { id: "view.model", label: "Model View", description: "Restore modeling lighting, overlays and your modeling edge/grid preferences.", enablementKey: "document", run: (context) => { const state = useCadStore.getState(); if (context.documentSession !== undefined && context.documentSession !== state.documentSession) return; useViewerState.getState().setPresentationMode(state.documentSession, "model"); } },
  { id: "view.render", label: "Render View", description: "Present the current native model with smooth shading, studio lighting and clean PNG exports.", enablementKey: "document", run: (context) => { const state = useCadStore.getState(); if (context.documentSession !== undefined && context.documentSession !== state.documentSession) return; useViewerState.getState().setPresentationMode(state.documentSession, "render"); } },
  { id: "view.studioAppearance", label: "Studio appearance", internal: true, enablementKey: "document", run: async (context) => {
    const captured = useCadStore.getState();
    const reportFailure = (message: string) => {
      const current = useCadStore.getState(), view = useViewerState.getState();
      if (current.history.present === captured.history.present && current.documentSession === captured.documentSession &&
          view.session === captured.documentSession && view.presentationMode === "render") current.setFileError(message);
    };
    let apply: typeof import("./studioCommand").setStudioAppearance;
    try {
      ({ setStudioAppearance: apply } = await import("./studioCommand"));
    } catch (error) {
      console.error("Studio command could not load.", error);
      reportFailure("Studio controls could not load. Save your project and reload to retry.");
      return;
    }
    try {
      await apply(context.studio, captured);
    } catch (error) {
      console.error("Studio settings could not be applied.", error);
      reportFailure("Studio settings could not be applied. Try choosing the finish or view again.");
    }
  } },
  { id: "file.projectGallery", label: "Project gallery", description: "Browse real example parts and recently saved local projects.", enablementKey: "outsideGuidedHole", run: () => beginProjectGallery() },
  { id: "view.toggleGrid", label: "Toggle Ground Grid", description: "Show or hide the ground grid in the current view preset and project PNG images.", enablementKey: "document", run: (context) => { const state = useCadStore.getState(); if (context.documentSession !== undefined && context.documentSession !== state.documentSession) return; useViewerState.getState().toggleGrid(state.documentSession); } },
  { id: "view.toggleModelEdges", label: "Toggle Model Edges", description: "Show or hide solid edge lines in the 3D view and PNG images.", enablementKey: "document", run: () => useViewerState.getState().toggleModelEdges(useCadStore.getState().documentSession) },
  { id: "view.toggleMovingQuality", label: "Toggle Movement Optimization", description: "Use lower resolution and hide model edges while moving the camera, then restore detail promptly after input ends.", enablementKey: "document", run: () => useViewerState.getState().toggleMovingQuality(useCadStore.getState().documentSession) },
  { id: "view.exitIsolation", label: "Exit isolation", description: "Restore all component and part visibility while preserving source sketch visibility.", enablementKey: "document", run: () => useViewerState.getState().showAllBodies(useCadStore.getState().documentSession) },
  { id: "view.showAllBodies", label: "Show All Bodies", enablementKey: "document", run: () => useViewerState.getState().showAllBodies(useCadStore.getState().documentSession) },
  { id: "view.showAllComponents", label: "Show All Components, Bodies and Sketches", enablementKey: "document", run: () => useViewerState.getState().showAll(useCadStore.getState().documentSession) },
  { id: "timeline.toggleComponentFilter", internal: true, label: "Filter Timeline to Active Component", enablementKey: "document", run: () => useViewerState.getState().toggleTimelineFilter(useCadStore.getState().documentSession) },
  { id: "sketch.create", label: "Create Sketch", enablementKey: "createSketch", run: () => beginProjectWorkflow("sketch") },
  { id: "sketch.finish", label: "Finish Sketch", enablementKey: "finishSketch", run: finishSketchCanvas },
  { id: "sketch.drawRectangle", label: "Draw Rectangle", description: "Draw a rectangle with explicit corner or center creation mode in the selected sketch.", enablementKey: "drawSketch", run: () => { beginSketchCanvasTool("rectangle"); } },
  { id: "sketch.editCanvas", label: "Edit Sketch Canvas", description: "Draw geometry in the selected sketch’s local plane.", enablementKey: "sketchCanvas", run: () => { beginSketchCanvas(); } },
  {id:"feature.captureTargetScope",label:"Capture Intersected Targets",description:"Save the current native body/tool intersections as explicit target IDs.",enablementKey:"captureTargetScope",run:captureSelectedTargetScope},
  ...STANDARD_VIEWS.map((view): CadCommand => ({ id: `view.${view}`, label: `${view[0].toUpperCase()}${view.slice(1)} View`, alwaysEnabled: true, run: () => { showStandardView(view); } })),
  { id: "view.saveNamed", label: "Save Named View", enablementKey: "saveNamedView", run: (ctx) => {
    const state = useCadStore.getState(), pose = captureCamera();
    if (ctx.documentSession !== undefined && ctx.documentSession !== state.documentSession) return;
    if (!pose) { state.setFileError("Camera is unavailable. Try saving the view again."); return; }
    const before = state.history.present;
    state.updateDocument((doc) => saveNamedCamera(doc, ctx.viewName ?? unusedViewName(doc), pose));
    if (useCadStore.getState().history.present !== before) state.setFileError(undefined);
  } },
  { id: "view.restoreNamed", label: "Restore Named View", enablementKey: "restoreNamedView", run: (ctx) => {
    const state=useCadStore.getState();
    if (ctx.documentSession !== undefined && ctx.documentSession !== state.documentSession) return;
    const view=ctx.viewId ? state.history.present.viewState?.namedViews?.find((v)=>v.id===ctx.viewId) : state.history.present.viewState?.namedViews?.[0];
    if (view && !restoreCamera(view)) state.setFileError("Saved camera cannot be restored. Reopen the project or save a replacement view.");
  } },
  { id: "view.clearSection", label: "Clear Section View", alwaysEnabled:true, run:()=>useSectionState.getState().clear(useCadStore.getState().documentSession) },
  { id: "file.exportSelectedBody", label: "Export Selected Body STL", enablementKey: "exportSelectedBody",
    run: async () => { const id = selectedExportBody(useCadStore.getState()); if (id) await runFabrication("separate", true, [id]); } },
  { id: "feature.hole", label: "Hole from Selected Sketch", description: "Choose explicit sketch point centers and target bodies for native cylindrical cuts.", enablementKey: "createHole", run: beginHoleCreation },
  ...(["earlier", "later"] as const).map((direction): CadCommand => ({
    id: `timeline.move${direction === "earlier" ? "Earlier" : "Later"}`,
    label: `Move Selected Item ${direction === "earlier" ? "Earlier" : "Later"}`,
    enablementKey: direction === "earlier" ? "moveEarlier" : "moveLater",
    run: () => {
      const state = useCadStore.getState();
      state.updateDocument((d) => moveTimelineItem(d, state.selection.selectedIds[0], direction));
    },
  })),
  {
    id: "file.newProject",
    label: "New Project",
    shortcut: "Cmd/Ctrl+N",
    enablementKey: "outsideGuidedHole",
    run: () =>
      useCadStore.getState().setDocument(createEmptyDocument()),
  },
  { id: "inspect.pickModel", label: "Measure in Model", description: "Click supported authored points, edges, faces and bodies to inspect their geometry.", enablementKey: "measurementPicking", run: () => { const state = useCadStore.getState(); useInspectionState.getState().setPicking(state.documentSession, true); useViewerState.getState().setPresentationMode(state.documentSession, "model"); useWorkspaceState.getState().setPanel("measure"); } },
  { id: "sketch.projectEdges", label: "Project Edges into Sketch", description: "Link a surviving complete authored cap boundary into a parallel sketch.", enablementKey: "projectSketchEdges", run: () => openSketchProjection() },
  { id: "partLibrary", label: "Local part library", description: "Save editable components locally and insert independent copies by dragging or at the origin.", enablementKey: "partLibrary", run: beginPartLibrary },
  { id: "file.insertProject", label: "Insert Reusable Part", description: "Copy editable components from a local project at the shared origin without replacing the open project.", enablementKey: "insertProject", run: beginInsertProject },
  {
    id: "file.openProject",
    label: "Open Project",
    enablementKey: "outsideGuidedHole",
    run: async (ctx) => {
      if (!ctx.file) {
        ctx.fileInputRef?.current?.click();
        return;
      }
      const controller = beginFileJob("Opening project…");
      const previous = useCadStore.getState().history.present;
      try {
        const document = await importProjectFile(
          ctx.file,
          controller.signal,
          (message) => {
            if (fileJobCurrent(controller)) useFileJobs.setState({ message });
          },
        );
        if (!fileJobCurrent(controller)) return;
        if (useCadStore.getState().history.present !== previous)
          throw new Error(
            "Project changed while opening the file. Open it again to replace the current document.",
          );
        useCadStore.getState().setDocument(document);
      } catch (error) {
        if (fileJobCurrent(controller))
          useCadStore
            .getState()
            .setFileError(
              error instanceof Error
                ? error.message
                : "Project file could not be opened.",
            );
      } finally {
        finishFileJob(controller);
      }
    },
  },
  {
    id: "file.saveProject",
    label: "Save Project",
    enablementKey: "document",
    run: async () => {
      const state = useCadStore.getState();
      try {
        const document = state.history.present;
        if (!document) {
          state.setFileError(
            "Project save is unavailable until a project is loaded.",
          );
          return;
        }
        await downloadProject(document);
        state.setFileError(undefined);
        try {
          await saveRecovery(document, true);
          const current = useCadStore.getState();
          if (current.history.present === document && current.documentSession === state.documentSession && current.rebuild.status === "succeeded") {
            const result = current.rebuild.result;
            // Covers are optional; a successful project download remains successful.
            try {
              const { rememberGalleryProject } = await import("../../persistence/projectGallery");
              await rememberGalleryProject(document, result);
            } catch { /* The saved editable project does not depend on its optional cover. */ }
          }
        } catch (error) {
          state.setFileError(
            `Project download started, but its recovery save marker could not be stored: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } catch (error) {
        console.error(error);
        state.setFileError(
          error instanceof Error ? error.message : "Project save failed.",
        );
      }
    },
  },
  {
    id: "file.exportJson",
    label: "Export Project JSON",
    enablementKey: "document",
    run: async () => {
      const state = useCadStore.getState();
      try {
        const document = state.history.present;
        if (!document) {
          state.setFileError(
            "JSON export is unavailable until a project is loaded.",
          );
          return;
        }
        await downloadArrayBuffer(
          new TextEncoder().encode(serializeProject(document)).buffer,
          makeProjectFilename(document, ".json"),
          "application/json",
        );
        state.setFileError(undefined);
      } catch (error) {
        console.error(error);
        state.setFileError(
          error instanceof Error ? error.message : "JSON export failed.",
        );
      }
    },
  },
  {
    id: "file.exportStl",
    label: "Export STL",
    enablementKey: "exportStl",
    run: async () => {
      const state = useCadStore.getState();
      if (state.fileBusy) return;
      if (!canExportStl(state)) {
        state.setFileError("STL export is unavailable until the current model rebuild succeeds.");
        return;
      }
      if (state.rebuild.result!.meshes.length > 1)
        openFabrication();
      else await runFabrication();
    },
  },
  { id: "file.exportStep", label: "Export STEP", description: "Export selected native solids at their world positions, verified by native STEP reimport; bodies remain separate.", enablementKey: "exportStep", run: openStepExport },
  {
    id: "history.undo",
    label: "Undo",
    enablementKey: "undo",
    run: () => { clearAiCanvasPreview(); useCadStore.getState().undo(); },
  },
  {
    id: "ai.undoChange",
    label: "Undo latest AI change",
    description: "Undo the last applied AI proposal only while it is the latest project action.",
    enablementKey: "undoAiChange",
    run: (context) => {
      const state = useCadStore.getState();
      if (canUndoAiChange(state, context.aiHistory)) { clearAiCanvasPreview(); state.undo(); }
    },
  },
  {
    id: "ai.redoChange",
    label: "Redo latest AI change",
    description: "Redo the AI proposal only while it is the next project redo action.",
    enablementKey: "redoAiChange",
    run: (context) => {
      const state = useCadStore.getState();
      if (canRedoAiChange(state, context.aiHistory)) { clearAiCanvasPreview(); state.redo(); }
    },
  },
  {
    id: "history.redo",
    label: "Redo",
    enablementKey: "redo",
    run: () => { clearAiCanvasPreview(); useCadStore.getState().redo(); },
  },
  {
    id: "parameter.add",
    label: "Add Parameter",
    enablementKey: "outsideGuidedHole",
    run: () => useCadStore.getState().addParameter(),
  },
  {
    id: "sketch.createXY",
    label: "Create XY Sketch",
    enablementKey: "createSketch",
    run: () => {
      createSketchCommand("XY");
    },
  },
  {
    id: "sketch.createXZ",
    label: "Create XZ Sketch",
    enablementKey: "createSketch",
    run: () => createSketchCommand("XZ"),
  },
  {
    id: "sketch.createYZ",
    label: "Create YZ Sketch",
    enablementKey: "createSketch",
    run: () => createSketchCommand("YZ"),
  },
  {
    id: "sketch.addCenterRectangle",
    label: "Add Center Rectangle",
    description: "Insert an 80mm by 50mm centered rectangle preset. Use Draw Rectangle for mouse or typed-size creation.",
    enablementKey: "outsideGuidedHole",
    run: () =>
      updateSelectedSketch((sketch) =>
        addCenterRectangle(sketch, "80mm", "50mm"),
      ),
  },
  {
    id: "sketch.addCornerRectangle",
    label: "Add Corner Rectangle",
    description: "Insert an 80mm by 50mm corner rectangle preset. Use Draw Rectangle for mouse or typed-size creation.",
    enablementKey: "outsideGuidedHole",
    run: () =>
      updateSelectedSketch((sketch) =>
        addCornerRectangle(sketch, "80mm", "50mm"),
      ),
  },
  {
    id: "sketch.addCircle",
    label: "Add Circle",
    enablementKey: "outsideGuidedHole",
    run: () =>
      updateSelectedSketch((sketch) =>
        addCircleAt(sketch, "0mm", "0mm", "10mm"),
      ),
  },
  {
    id: "feature.extrude",
    label: "Extrude Selected Sketch",
    enablementKey: "createExtrude",
    run: () => {
      if (canMakeSketchSolid()) { makeSketchSolid(); return; }
      if (useSketchSolidHandoff.getState().source) cancelSketchSolidHandoff();
      const match = findActiveSketchWithProfile();
      if (match) beginExtrudeCreation(match.sketch.id);
    },
  },
  {
    id: "feature.revolve",
    label: "Revolve Selected Sketch",
    description:
      "Requires a profile on one side of a coplanar origin axis or sketch line. Add a construction line if no origin axis is usable.",
    enablementKey: "createRevolve",
    run: () => {
      const state = useCadStore.getState(),
        match = findActiveSketchWithProfile();
      if (!match) return;
      const axis = defaultRevolveAxis(state);
      if (!axis) return;
      const feature = {
        id: createId("feature"),
        type: "revolve" as const,
        name: `Revolve ${state.history.present.features.length + 1}`,
        sketchId: match.sketch.id,
        profileId: match.profileId,
        operation: "newBody" as const,
        angle: { expression: "360deg", unit: "deg" },
        axis,
        createdAt: new Date().toISOString(),
      };
      beginModelingCreation(feature);
    },
  },
  {
    id: "feature.fillet",
    label: "Fillet Extrusion Edges",
    enablementKey: "createEdgeTreatment",
    run: () => createEdgeTreatment("fillet"),
  },
  {
    id: "feature.chamfer",
    label: "Chamfer Extrusion Edges",
    enablementKey: "createEdgeTreatment",
    run: () => createEdgeTreatment("chamfer"),
  },
  {
    id: "feature.suppress",
    label: "Suppress/Unsuppress Feature",
    enablementKey: "selectedFeature",
    run: () => {
      const state = useCadStore.getState();
      const feature = getSelectedFeature();
      if (!feature) return;
      state.updateDocument((document) =>
        suppressFeature(document, feature.id, !feature.suppressed),
      );
    },
  },
  {
    id: "feature.delete",
    label: "Delete Feature",
    enablementKey: "selectedFeature",
    run: () => {
      const state = useCadStore.getState();
      const feature = getSelectedFeature();
      if (!feature) return;
      state.updateDocument((document) => deleteFeature(document, feature.id));
      state.select(undefined);
    },
  },
  {
    id: "template.createBox",
    label: "Create Parametric Box",
    enablementKey: "outsideGuidedHole",
    run: () => useCadStore.getState().setDocument(createBoxTemplate()),
  },
  {
    id: "template.createMountingPlate",
    label: "Create Mounting Plate",
    enablementKey: "outsideGuidedHole",
    run: () =>
      useCadStore.getState().setDocument(createMountingPlateTemplate()),
  },
  {
    id: "view.fit",
    label: "Fit View",
    shortcut: "F",
    alwaysEnabled: true,
    run: () => {
      const name = useSketchCanvas.getState().active ? "plaincad:fit-sketch" : "plaincad:fit-view";
      globalThis.dispatchEvent(new Event(name));
    },
  },
  {
    id: "view.resetCamera",
    label: "Reset Camera",
    alwaysEnabled: true,
    run: () => globalThis.dispatchEvent(new Event("plaincad:reset-camera")),
  },
];

export const commandById = new Map(
  commands.map((command) => [command.id, command]),
);

export function runCommand(id: string, context: CommandContext = {}) {
  const command = commandById.get(id);
  const state = useCadStore.getState();
  if (
    !command ||
    !isCommandEnabledForSnapshot(id, selectCommandEnablement(state))
  )
    return;
  return command.run(context);
}

function updateSelectedSketch(
  mutator: (
    sketch: ReturnType<typeof createXySketch>,
  ) => ReturnType<typeof createXySketch>,
) {
  const state = useCadStore.getState();
  const selection = state.selection.selectedIds[0];
  const document = state.history.present;
  if (!document) return;
  const selectedSketch =
    selection?.kind === "sketch"
      ? document.sketches[selection.id]
      : selection?.kind === "sketchEntity"
        ? Object.values(document.sketches).find((sketch) =>
            Boolean(sketch.entities[selection.id]),
          )
        : undefined;
  const sketch =
    selectedSketch ??
    createXySketch(`Sketch ${Object.keys(document.sketches).length + 1}`);
  const updated = mutator({ ...sketch, componentId: selectedSketch ? sketchComponentId(document, sketch.id) : activeComponentId(state) });
  state.updateDocument((nextDocument) => upsertSketch(nextDocument, updated));
  state.select({ kind: "sketch", id: updated.id, documentId: document.id });
}

function createSketchCommand(plane: OriginPlane) {
  const state = useCadStore.getState();
  const document = state.history.present;
  if (!document) return;
  const sketch = createSketchOnPlane(
    `Sketch ${Object.keys(document.sketches).length + 1}`,
    plane,
  );
  const componentId = activeComponentId(state);
  state.updateDocument((document) => upsertSketch(document, { ...sketch, componentId }));
  state.select({ kind: "sketch", id: sketch.id, documentId: document.id });
}

function getSelectedFeature(state = useCadStore.getState()) {
  const selection = state.selection.selectedIds[0];
  const document = state.history.present;
  return selection?.kind === "feature"
    ? document?.features.find((feature) => feature.id === selection.id)
    : undefined;
}

function canCreateExtrude(state = useCadStore.getState()) {
  return Boolean(findActiveSketchWithProfile(state));
}

export function canExportStl(state: CadStore) {
  const { rebuild } = state;
  const document = state.history.present;
  return (
    Boolean(document) &&
    rebuild.kernelReady &&
    rebuild.status === "succeeded" &&
    rebuild.result?.success === true &&
    rebuild.result.documentId === document.id &&
    rebuild.result.meshes.length > 0
  );
}
function selectedExportBody(state: CadStore): string | undefined {
  const selected = state.selection.selectedIds[0];
  return selected?.kind === "body" && selected.documentId === state.history.present.id && state.rebuild.result?.meshes.some((mesh) => mesh.bodyId === selected.id) ? selected.id : undefined;
}

interface ActiveProfile {
  sketch: CadDocument["sketches"][string];
  profileId: string;
  profile: SketchProfile;
  solved: ResolvedSketch;
}
type AnalysisCache<T> = WeakMap<
  CadDocument,
  WeakMap<object, Map<string, T | undefined>>
>;
const activeProfileCache: AnalysisCache<ActiveProfile> = new WeakMap();
// Weak snapshot keys avoid retaining old runtime meshes through document history.
function cachedAnalysis<T>(
  cache: AnalysisCache<T>,
  document: CadDocument,
  snapshot: object,
): Map<string, T | undefined> {
  let versions = cache.get(document);
  if (!versions) {
    versions = new WeakMap();
    cache.set(document, versions);
  }
  let values = versions.get(snapshot);
  if (!values) {
    values = new Map();
    versions.set(snapshot, values);
  }
  return values;
}
// The no-Worker runtime rebuilds synchronously and supports bootstrap command analysis.
function usesWorkerAnalysis(state: CadStore): boolean {
  return typeof Worker !== "undefined" && state.rebuild.kernelReady;
}
function currentAnalysis(state: CadStore): RebuildResult | undefined {
  if (!usesWorkerAnalysis(state)) return undefined;
  const result = state.rebuild.result;
  return (state.rebuild.status === "succeeded" ||
    state.rebuild.status === "failed") &&
    result?.documentId === state.history.present.id
    ? result
    : undefined;
}
function findActiveSketchWithProfile(
  state = useCadStore.getState(),
): ActiveProfile | undefined {
  const document = state.history.present;
  if (!document) return undefined;
  const analysis = currentAnalysis(state);
  if (usesWorkerAnalysis(state) && !analysis) return undefined;
  const selection = state.selection.selectedIds[0],
    sketches = Object.values(document.sketches).filter(sketch => sketchComponentId(document, sketch.id) === activeComponentId(state));
  const selectedSketch =
    selection?.kind === "sketch"
      ? document.sketches[selection.id]
      : selection?.kind === "sketchEntity"
        ? sketches.find((s) => Boolean(s.entities[selection.id]))
        : undefined;
  if (selectedSketch && sketchComponentId(document, selectedSketch.id) !== activeComponentId(state)) return undefined;
  const key = selectedSketch?.id ?? `all:${activeComponentId(state)}`;
  const cache = cachedAnalysis(
    activeProfileCache,
    document,
    analysis ?? document,
  );
  if (cache.has(key)) return cache.get(key);
  try {
    // The initialized app reuses worker analysis; local solving is only a bootstrap fallback.
    const parameters = !usesWorkerAnalysis(state)
      ? evaluateParameters(document.parameters).values
      : {};
    for (const sketch of selectedSketch ? [selectedSketch] : sketches) {
      const solved =
        analysis?.solvedSketches?.[sketch.id] ??
        (!usesWorkerAnalysis(state)
          ? solveSketch(sketch, parameters)
          : undefined);
      if (!solved || solved.errors.length) continue;
      const profiles =
        analysis?.profiles?.[sketch.id] ??
        (!usesWorkerAnalysis(state) ? detectProfiles(solved).profiles : []);
      const profile = profiles[0];
      if (profile) {
        const match = { sketch, profileId: profile.id, profile, solved };
        cache.set(key, match);
        return match;
      }
    }
  } catch (error) {
    console.error("Sketch availability analysis failed", error);
  }
  cache.set(key, undefined);
  return undefined;
}

function edgeTreatmentOwner(state = useCadStore.getState()) {
  if (!canExportStl(state)) return undefined;
  const document = state.history.present,
    selection = state.selection.selectedIds[0];
  let feature = getSelectedFeature(state);
  if (selection?.kind === "body")
    feature = document.features.find(
      (f) =>
        stableBodyIdForFeature(f.id) === selection.id,
    );
  if (feature?.type === "fillet" || feature?.type === "chamfer") {
    const ownerId = feature.targetEdgeRefs[0]?.featureId;
    feature = document.features.find((f) => f.id === ownerId);
  }
  if (
    feature?.type !== "extrude" ||
    feature.suppressed ||
    feature.operation !== "newBody" ||
    (feature.termination && feature.termination.type !== "distance")
  )
    return undefined;
  const mesh = state.rebuild.result?.meshes.find(
    (m) => m.bodyId === stableBodyIdForFeature(feature.id),
  );
  return mesh?.geometrySource === "opencascade" &&
    ["extrusion", "cut", "fuse", "fillet", "chamfer"].includes(mesh.kernelOperation ?? "")
    ? feature
    : undefined;
}
function createEdgeTreatment(type: "fillet" | "chamfer") {
  const state = useCadStore.getState(),
    owner = edgeTreatmentOwner(state);
  if (!owner) return;
  const common = {
    id: createId("feature"),
    name: `${type === "fillet" ? "Fillet" : "Chamfer"} ${state.history.present.features.length + 1}`,
    targetEdgeRefs: [
      createExtrudeEdgeRef(
        owner.id,
        preferredCapRole(state.history.present, owner.id),
      ),
    ],
    createdAt: new Date().toISOString(),
  };
  const feature =
    type === "fillet"
      ? { ...common, type, radius: { expression: "1mm", unit: "mm" } }
      : { ...common, type, distance: { expression: "1mm", unit: "mm" } };
  beginModelingCreation(feature);
}

// Initial UI preference only: used cap roles can still contain untouched source
// edges. The native draft preview decides whether the explicit edge survives.
function preferredCapRole(
  document: CadDocument,
  ownerId: string,
): "endCapPerimeter" | "startCapPerimeter" {
  const used = new Set(
    document.features.flatMap((feature) =>
      !feature.suppressed &&
      (feature.type === "fillet" || feature.type === "chamfer")
        ? feature.targetEdgeRefs
            .filter((ref) => ref.featureId === ownerId)
            .map((ref) => ref.role)
        : [],
    ),
  );
  return !used.has("endCapPerimeter")
    ? "endCapPerimeter"
    : !used.has("startCapPerimeter")
      ? "startCapPerimeter"
      : "endCapPerimeter";
}

const defaultAxisCache: AnalysisCache<RevolveAxisReference> = new WeakMap();
function defaultRevolveAxis(state: CadStore): RevolveAxisReference | undefined {
  const match = findActiveSketchWithProfile(state);
  if (!match) return undefined;
  const document = state.history.present,
    analysis = currentAnalysis(state);
  const key = JSON.stringify([match.sketch.id, match.profileId]);
  const cache = cachedAnalysis(
    defaultAxisCache,
    document,
    analysis ?? document,
  );
  if (cache.has(key)) return cache.get(key);
  try {
    const posed = analysis?.sketchPlanes?.[match.sketch.id];
    const transform = posed
      ? unplacePlane(posed, document.components[sketchComponentId(document, match.sketch.id)]?.placement)
      : !usesWorkerAnalysis(state)
        ? resolveDocumentPlanes(document, evaluateParameters(document.parameters).values).transforms.get(match.sketch.id)
        : undefined;
    if (transform) {
      const lines = Object.values(match.sketch.entities).filter(
        (e) => e.type === "line",
      );
      const lineAxis = (id: string): RevolveAxisReference => ({
        type: "sketchLine",
        sketchId: match.sketch.id,
        lineId: id,
      });
      const preferred =
        match.sketch.plane.type === "origin" &&
        match.sketch.plane.plane !== "XY"
          ? "Z"
          : "Y";
      const origins = Array.from(new Set([preferred, "X", "Y", "Z"] as const));
      const candidates: RevolveAxisReference[] = [
        ...lines.filter((l) => l.construction).map((l) => lineAxis(l.id)),
        ...origins.map((axis) => ({ type: "origin" as const, axis })),
        ...lines.filter((l) => !l.construction).map((l) => lineAxis(l.id)),
      ];
      for (const candidate of candidates) {
        try {
          resolveRevolveAxis(
            candidate,
            match.solved,
            transform,
            match.profile,
            Math.PI * 2,
          );
          cache.set(key, candidate);
          return candidate;
        } catch (error) {
          if (!(error instanceof RevolveAxisValidationError)) throw error;
        }
      }
    }
  } catch (error) {
    console.error("Revolve availability analysis failed", error);
  }
  cache.set(key, undefined);
  return undefined;
}
