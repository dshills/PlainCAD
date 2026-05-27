import { RefObject } from "react";
import { CadStore, useCadStore } from "../../state/useCadStore";
import { createBoxTemplate, createMountingPlateTemplate } from "../../templates/templates";
import { importProjectFile } from "../../persistence/importProject";
import { downloadArrayBuffer, downloadProject, projectFilename as makeProjectFilename, serializeProject } from "../../persistence/exportProject";
import { exportMeshesToStl } from "../../cad/kernel/stlExport";
import { createExtrudeFeature, deleteFeature, suppressFeature, upsertFeature, upsertSketch } from "../../cad/document/CadDocument";
import { addCenterRectangle, addCircleAt, addCornerRectangle, createXySketch } from "../../cad/sketch/SketchModel";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { solveSketch } from "../../cad/sketch/SketchSolver";
import { detectProfiles } from "../../cad/sketch/profileDetection";

export interface CommandContext {
  fileInputRef?: RefObject<HTMLInputElement | null>;
  file?: File;
}

export interface CadCommand {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  alwaysEnabled?: boolean;
  enablementKey?: keyof CommandEnablement;
  run: (ctx: CommandContext) => Promise<void> | void;
}

export interface CommandEnablement {
  document: boolean;
  undo: boolean;
  redo: boolean;
  exportStl: boolean;
  createExtrude: boolean;
  selectedFeature: boolean;
}

export function selectCommandEnablement(state: CadStore): CommandEnablement {
  return {
    document: Boolean(state.history.present),
    undo: state.history.past.length > 0,
    redo: state.history.future.length > 0,
    exportStl: canExportStl(state),
    createExtrude: canCreateExtrude(state),
    selectedFeature: Boolean(getSelectedFeature(state)),
  };
}

export function isCommandEnabledForSnapshot(commandId: string, enablement: CommandEnablement): boolean {
  const command = commandById.get(commandId);
  if (!command) return false;
  if (command.enablementKey) return enablement[command.enablementKey];
  return command.alwaysEnabled === true;
}

export const commands: CadCommand[] = [
  {
    id: "file.newProject",
    label: "New Project",
    shortcut: "Cmd/Ctrl+N",
    alwaysEnabled: true,
    run: () => useCadStore.getState().setDocument(createMountingPlateTemplate()),
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
      try {
        const document = await importProjectFile(ctx.file);
        useCadStore.getState().setDocument(document);
      } catch (error) {
        console.error(error);
        useCadStore.getState().setFileError(error instanceof Error ? error.message : "Project file could not be opened.");
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
          state.setFileError("Project save is unavailable until a project is loaded.");
          return;
        }
        await downloadProject(document);
        state.setFileError(undefined);
      } catch (error) {
        console.error(error);
        state.setFileError(error instanceof Error ? error.message : "Project save failed.");
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
          state.setFileError("JSON export is unavailable until a project is loaded.");
          return;
        }
        await downloadArrayBuffer(new TextEncoder().encode(serializeProject(document)).buffer, makeProjectFilename(document, ".json"), "application/json");
        state.setFileError(undefined);
      } catch (error) {
        console.error(error);
        state.setFileError(error instanceof Error ? error.message : "JSON export failed.");
      }
    },
  },
  {
    id: "file.exportStl",
    label: "Export STL",
    enablementKey: "exportStl",
    run: async () => {
      const state = useCadStore.getState();
      try {
        if (!canExportStl(state)) throw new Error("STL export is unavailable until the current model rebuild succeeds.");
        await downloadArrayBuffer(exportMeshesToStl(state.rebuild.result?.meshes ?? [], state.history.present.name), makeProjectFilename(state.history.present, ".stl"), "model/stl");
        state.setFileError(undefined);
      } catch (error) {
        console.error(error);
        state.setFileError(error instanceof Error ? error.message : "STL export failed.");
      }
    },
  },
  { id: "history.undo", label: "Undo", enablementKey: "undo", run: () => useCadStore.getState().undo() },
  { id: "history.redo", label: "Redo", enablementKey: "redo", run: () => useCadStore.getState().redo() },
  { id: "parameter.add", label: "Add Parameter", alwaysEnabled: true, run: () => useCadStore.getState().addParameter() },
  {
    id: "sketch.createXY",
    label: "Create XY Sketch",
    enablementKey: "document",
    run: () => {
      const state = useCadStore.getState();
      const document = state.history.present;
      if (!document) return;
      const sketch = createXySketch(`Sketch ${Object.keys(document.sketches).length + 1}`);
      state.updateDocument((document) => upsertSketch(document, sketch));
      state.select({ kind: "sketch", id: sketch.id, documentId: document.id });
    },
  },
  {
    id: "sketch.addCenterRectangle",
    label: "Add Center Rectangle",
    alwaysEnabled: true,
    run: () => updateSelectedSketch((sketch) => addCenterRectangle(sketch, "80mm", "50mm")),
  },
  {
    id: "sketch.addCornerRectangle",
    label: "Add Corner Rectangle",
    alwaysEnabled: true,
    run: () => updateSelectedSketch((sketch) => addCornerRectangle(sketch, "80mm", "50mm")),
  },
  {
    id: "sketch.addCircle",
    label: "Add Circle",
    alwaysEnabled: true,
    run: () => updateSelectedSketch((sketch) => addCircleAt(sketch, "0mm", "0mm", "10mm")),
  },
  {
    id: "feature.extrude",
    label: "Extrude Selected Sketch",
    enablementKey: "createExtrude",
    run: () => {
      const state = useCadStore.getState();
      const match = findActiveSketchWithProfile();
      if (!match) return;
      const feature = createExtrudeFeature({
        name: `Extrude ${state.history.present.features.length + 1}`,
        sketchId: match.sketch.id,
        profileId: match.profileId,
        operation: "newBody",
        distance: { expression: "10mm", unit: "mm" },
        direction: "positive",
      });
      state.updateDocument((document) => upsertFeature(document, feature));
      state.select({ kind: "feature", id: feature.id, documentId: state.history.present.id });
    },
  },
  {
    id: "feature.suppress",
    label: "Suppress/Unsuppress Feature",
    enablementKey: "selectedFeature",
    run: () => {
      const state = useCadStore.getState();
      const feature = getSelectedFeature();
      if (!feature) return;
      state.updateDocument((document) => suppressFeature(document, feature.id, !feature.suppressed));
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
  { id: "template.createBox", label: "Create Parametric Box", alwaysEnabled: true, run: () => useCadStore.getState().setDocument(createBoxTemplate()) },
  { id: "template.createMountingPlate", label: "Create Mounting Plate", alwaysEnabled: true, run: () => useCadStore.getState().setDocument(createMountingPlateTemplate()) },
  { id: "view.fit", label: "Fit View", shortcut: "F", alwaysEnabled: true, run: () => globalThis.dispatchEvent(new Event("plaincad:fit-view")) },
  { id: "view.resetCamera", label: "Reset Camera", alwaysEnabled: true, run: () => globalThis.dispatchEvent(new Event("plaincad:reset-camera")) },
];

export const commandById = new Map(commands.map((command) => [command.id, command]));

export function runCommand(id: string, context: CommandContext = {}) {
  const command = commandById.get(id);
  const state = useCadStore.getState();
  if (!command || !isCommandEnabledForSnapshot(id, selectCommandEnablement(state))) return;
  return command.run(context);
}

function updateSelectedSketch(mutator: (sketch: ReturnType<typeof createXySketch>) => ReturnType<typeof createXySketch>) {
  const state = useCadStore.getState();
  const selection = state.selection.selectedIds[0];
  const document = state.history.present;
  if (!document) return;
  const selectedSketch =
    selection?.kind === "sketch"
      ? document.sketches[selection.id]
      : selection?.kind === "sketchEntity"
        ? Object.values(document.sketches).find((sketch) => Boolean(sketch.entities[selection.id]))
        : undefined;
  const sketch = selectedSketch ?? createXySketch(`Sketch ${Object.keys(document.sketches).length + 1}`);
  const updated = mutator(sketch);
  state.updateDocument((nextDocument) => upsertSketch(nextDocument, updated));
  state.select({ kind: "sketch", id: updated.id, documentId: document.id });
}

function getSelectedFeature(state = useCadStore.getState()) {
  const selection = state.selection.selectedIds[0];
  const document = state.history.present;
  return selection?.kind === "feature" ? document?.features.find((feature) => feature.id === selection.id) : undefined;
}

function canCreateExtrude(state = useCadStore.getState()) {
  const selection = state.selection.selectedIds[0];
  const document = state.history.present;
  if (!document) return false;
  if (selection?.kind === "sketch") return Boolean(document.sketches[selection.id]);
  if (selection?.kind === "sketchEntity") {
    return Object.values(document.sketches).some((sketch) => Boolean(sketch.entities[selection.id]));
  }
  return Object.keys(document.sketches).length > 0;
}

export function canExportStl(state: CadStore) {
  const { rebuild } = state;
  const document = state.history.present;
  return Boolean(document) && rebuild.kernelReady && rebuild.status === "succeeded" && rebuild.result?.success === true && rebuild.result.documentId === document.id && rebuild.result.meshes.length > 0;
}

function findActiveSketchWithProfile() {
  const state = useCadStore.getState();
  const document = state.history.present;
  if (!document) return undefined;
  const selection = state.selection.selectedIds[0];
  const sketches = Object.values(document.sketches);
  const selectedSketch =
    selection?.kind === "sketch"
      ? document.sketches[selection.id]
      : selection?.kind === "sketchEntity"
        ? sketches.find((sketch) => Boolean(sketch.entities[selection.id]))
        : undefined;
  const evaluated = evaluateParameters(document.parameters);
  for (const sketch of selectedSketch ? [selectedSketch] : sketches) {
    const detected = detectProfiles(solveSketch(sketch, evaluated.values));
    const profile = detected.profiles[0];
    if (profile) return { sketch, profileId: profile.id };
  }
  return undefined;
}
