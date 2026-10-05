import { beginExtrudeCreation, beginExtrudeEditing, editableExtrude } from "./extrudeCommand";
import { beginModelingCreation, beginModelingEditing, editableModelingFeature } from "./modelingDraftCommand";
import { useViewerState } from "../../state/viewerState";
import { toggleAiDrawer } from "./aiCommand";
import { activeComponentId, beginProjectWorkflow, finishSketchCanvas } from "./projectWorkflowCommand";
import { renameComponent, sketchComponentId } from "../../cad/document/components";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";
import { beginSketchCanvas, deleteSelectedCanvasEntity, selectedCanvasEntity, selectedCanvasSketch, useSketchCanvas } from "./sketchCanvasCommand";
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
import { beginHoleCreation, beginHoleEditing, editableHole, holeCreationContext } from "./holeCommand";

export interface CommandContext {
  sketchId?: string;
  componentId?: string;
  componentName?: string;
  projectName?: string;
  viewName?: string;
  viewId?: string;
  documentSession?: number;
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
  document: boolean;
  editProject: boolean;
  newComponent: boolean;
  createSketch: boolean;
  finishSketch: boolean;
  undo: boolean;
  redo: boolean;
  exportStl: boolean;
  exportSelectedBody: boolean;
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
  captureTargetScope: boolean;
  sketchCanvas: boolean;
  deleteSketchEntity: boolean;
}

export function selectCommandEnablement(state: CadStore, scopeCaptureBusy = useTargetScopeCapture.getState().busy, canvasActive = Boolean(useSketchCanvas.getState().active)): CommandEnablement {
  return {
    editProject: !state.fileBusy,
    newComponent: !state.fileBusy && !canvasActive && Object.keys(state.history.present.components).length < MODEL_RESOURCE_LIMITS.maxComponents,
    createSketch: !state.fileBusy && !canvasActive,
    finishSketch: canvasActive,
    sketchCanvas: !canvasActive && Boolean(selectedCanvasSketch(state)),
    deleteSketchEntity: canvasActive && Boolean(selectedCanvasEntity(state)),
    document: Boolean(state.history.present),
    saveNamedView: (state.history.present.viewState?.namedViews?.length ?? 0) < MAX_NAMED_VIEWS,
    restoreNamedView: Boolean(state.history.present.viewState?.namedViews?.length),
    undo: state.history.past.length > 0,
    redo: state.history.future.length > 0,
    exportStl: canExportStl(state) && !state.fileBusy,
    exportSelectedBody: canExportStl(state) && !state.fileBusy && Boolean(selectedExportBody(state)),
    createExtrude: !canvasActive && canCreateExtrude(state),
    createRevolve: !canvasActive && Boolean(defaultRevolveAxis(state)),
    editFeature: !canvasActive && Boolean(editableExtrude(state) || editableModelingFeature(state) || editableHole(state)),
    selectedFeature: !canvasActive && Boolean(getSelectedFeature(state)),
    createEdgeTreatment: !canvasActive && Boolean(edgeTreatmentOwner(state)),
    moveEarlier: !canvasActive && !planTimelineMove(state.history.present, state.selection.selectedIds[0], "earlier").reason,
    moveLater: !canvasActive && !planTimelineMove(state.history.present, state.selection.selectedIds[0], "later").reason,
    createHole: !canvasActive && Boolean(holeCreationContext(state)),
    captureTargetScope: !canvasActive && canCaptureTargetScope(state,scopeCaptureBusy),
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
  { id: "sketch.entity.delete", internal: true, label: "Delete selected sketch item", enablementKey: "deleteSketchEntity", run: deleteSelectedCanvasEntity },
  { id: "ai.toggle", label: "Toggle AI Drawer", description: "Describe a part and preview an editable AI component.", alwaysEnabled: true, run: toggleAiDrawer },
  { id: "feature.edit", label: "Edit Selected Feature", description: "Preview changes to the selected Extrude, Revolve, Fillet, Chamfer or Hole and its downstream geometry.", enablementKey: "editFeature", run: () => { if (editableExtrude(useCadStore.getState())) beginExtrudeEditing(); else if (editableHole(useCadStore.getState())) beginHoleEditing(); else beginModelingEditing(); } },
  {
    id: "file.renameProject", internal: true, label: "Rename Project", enablementKey: "editProject",
    run: ({ projectName }) => {
      if (projectName === undefined) return;
      const name = projectName.trim(), state = useCadStore.getState();
      if (!name || name.length > 120) { state.setFileError("Project name must contain 1–120 characters."); return; }
      state.updateDocument(document => document.name === name ? document : { ...document, name, updatedAt: new Date().toISOString() });
    },
  },
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
  { id: "view.showAllBodies", label: "Show All Bodies", enablementKey: "document", run: () => useViewerState.getState().showAllBodies(useCadStore.getState().documentSession) },
  { id: "view.showAllComponents", label: "Show All Components, Bodies and Sketches", enablementKey: "document", run: () => useViewerState.getState().showAll(useCadStore.getState().documentSession) },
  { id: "timeline.toggleComponentFilter", internal: true, label: "Filter Timeline to Active Component", enablementKey: "document", run: () => useViewerState.getState().toggleTimelineFilter(useCadStore.getState().documentSession) },
  { id: "sketch.create", label: "Create Sketch", enablementKey: "createSketch", run: () => beginProjectWorkflow("sketch") },
  { id: "sketch.finish", label: "Finish Sketch", enablementKey: "finishSketch", run: finishSketchCanvas },
  { id: "sketch.editCanvas", label: "Edit Sketch Canvas", description: "Draw geometry in the selected sketch’s local plane.", enablementKey: "sketchCanvas", run: beginSketchCanvas },
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
    alwaysEnabled: true,
    run: () =>
      useCadStore.getState().setDocument(createEmptyDocument()),
  },
  {
    id: "file.openProject",
    label: "Open Project",
    alwaysEnabled: true,
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
  {
    id: "history.undo",
    label: "Undo",
    enablementKey: "undo",
    run: () => useCadStore.getState().undo(),
  },
  {
    id: "history.redo",
    label: "Redo",
    enablementKey: "redo",
    run: () => useCadStore.getState().redo(),
  },
  {
    id: "parameter.add",
    label: "Add Parameter",
    alwaysEnabled: true,
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
    alwaysEnabled: true,
    run: () =>
      updateSelectedSketch((sketch) =>
        addCenterRectangle(sketch, "80mm", "50mm"),
      ),
  },
  {
    id: "sketch.addCornerRectangle",
    label: "Add Corner Rectangle",
    alwaysEnabled: true,
    run: () =>
      updateSelectedSketch((sketch) =>
        addCornerRectangle(sketch, "80mm", "50mm"),
      ),
  },
  {
    id: "sketch.addCircle",
    label: "Add Circle",
    alwaysEnabled: true,
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
    alwaysEnabled: true,
    run: () => useCadStore.getState().setDocument(createBoxTemplate()),
  },
  {
    id: "template.createMountingPlate",
    label: "Create Mounting Plate",
    alwaysEnabled: true,
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
    const transform =
      analysis?.sketchPlanes?.[match.sketch.id] ??
      (!usesWorkerAnalysis(state)
        ? resolveDocumentPlanes(
            document,
            evaluateParameters(document.parameters).values,
          ).transforms.get(match.sketch.id)
        : undefined);
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
