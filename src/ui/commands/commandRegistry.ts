import { RefObject } from "react";
import { useCadStore } from "../../state/useCadStore";
import { createBoxTemplate, createMountingPlateTemplate } from "../../templates/templates";
import { importProjectFile } from "../../persistence/importProject";
import { downloadArrayBuffer, serializeProject } from "../../persistence/exportProject";
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
  enabled: () => boolean;
  run: (ctx: CommandContext) => Promise<void> | void;
}

export const commands: CadCommand[] = [
  {
    id: "file.newProject",
    label: "New Project",
    shortcut: "Cmd/Ctrl+N",
    enabled: () => true,
    run: () => useCadStore.getState().setDocument(createMountingPlateTemplate()),
  },
  {
    id: "file.openProject",
    label: "Open Project",
    enabled: () => true,
    run: async (ctx) => {
      if (!ctx.file) {
        ctx.fileInputRef?.current?.click();
        return;
      }
      useCadStore.getState().setDocument(await importProjectFile(ctx.file));
    },
  },
  {
    id: "file.saveProject",
    label: "Save Project JSON",
    enabled: () => true,
    run: () => {
      const document = useCadStore.getState().history.present;
      downloadArrayBuffer(new TextEncoder().encode(serializeProject(document)).buffer, `${document.name}.pcaddoc`, "application/json");
    },
  },
  {
    id: "file.exportStl",
    label: "Export STL",
    enabled: () => (useCadStore.getState().rebuild.result?.meshes.length ?? 0) > 0,
    run: () => {
      const state = useCadStore.getState();
      downloadArrayBuffer(exportMeshesToStl(state.rebuild.result?.meshes ?? [], state.history.present.name), `${state.history.present.name}.stl`, "model/stl");
    },
  },
  { id: "history.undo", label: "Undo", enabled: () => useCadStore.getState().history.past.length > 0, run: () => useCadStore.getState().undo() },
  { id: "history.redo", label: "Redo", enabled: () => useCadStore.getState().history.future.length > 0, run: () => useCadStore.getState().redo() },
  { id: "parameter.add", label: "Add Parameter", enabled: () => true, run: () => useCadStore.getState().addParameter() },
  {
    id: "sketch.createXY",
    label: "Create XY Sketch",
    enabled: () => true,
    run: () => {
      const state = useCadStore.getState();
      const sketch = createXySketch(`Sketch ${Object.keys(state.history.present.sketches).length + 1}`);
      state.updateDocument((document) => upsertSketch(document, sketch));
      state.select({ kind: "sketch", id: sketch.id, documentId: state.history.present.id });
    },
  },
  {
    id: "sketch.addCenterRectangle",
    label: "Add Center Rectangle",
    enabled: () => true,
    run: () => updateSelectedSketch((sketch) => addCenterRectangle(sketch, "80mm", "50mm")),
  },
  {
    id: "sketch.addCornerRectangle",
    label: "Add Corner Rectangle",
    enabled: () => true,
    run: () => updateSelectedSketch((sketch) => addCornerRectangle(sketch, "80mm", "50mm")),
  },
  {
    id: "sketch.addCircle",
    label: "Add Circle",
    enabled: () => true,
    run: () => updateSelectedSketch((sketch) => addCircleAt(sketch, "0mm", "0mm", "10mm")),
  },
  {
    id: "feature.extrude",
    label: "Extrude Selected Sketch",
    enabled: () => canCreateExtrude(),
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
    enabled: () => Boolean(getSelectedFeature()),
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
    enabled: () => Boolean(getSelectedFeature()),
    run: () => {
      const state = useCadStore.getState();
      const feature = getSelectedFeature();
      if (!feature) return;
      state.updateDocument((document) => deleteFeature(document, feature.id));
      state.select(undefined);
    },
  },
  { id: "template.createBox", label: "Create Parametric Box", enabled: () => true, run: () => useCadStore.getState().setDocument(createBoxTemplate()) },
  { id: "template.createMountingPlate", label: "Create Mounting Plate", enabled: () => true, run: () => useCadStore.getState().setDocument(createMountingPlateTemplate()) },
  { id: "view.fit", label: "Fit View", shortcut: "F", enabled: () => true, run: () => globalThis.dispatchEvent(new Event("plaincad:fit-view")) },
  { id: "view.resetCamera", label: "Reset Camera", enabled: () => true, run: () => globalThis.dispatchEvent(new Event("plaincad:reset-camera")) },
];

export function runCommand(id: string, context: CommandContext = {}) {
  const command = commands.find((item) => item.id === id);
  if (!command || !command.enabled()) return;
  return command.run(context);
}

function updateSelectedSketch(mutator: (sketch: ReturnType<typeof createXySketch>) => ReturnType<typeof createXySketch>) {
  const state = useCadStore.getState();
  const selection = state.selection.selectedIds[0];
  const document = state.history.present;
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

function getSelectedFeature() {
  const state = useCadStore.getState();
  const selection = state.selection.selectedIds[0];
  return selection?.kind === "feature" ? state.history.present.features.find((feature) => feature.id === selection.id) : undefined;
}

function canCreateExtrude() {
  const state = useCadStore.getState();
  const selection = state.selection.selectedIds[0];
  if (selection?.kind === "sketch") return Boolean(state.history.present.sketches[selection.id]);
  if (selection?.kind === "sketchEntity") {
    return Object.values(state.history.present.sketches).some((sketch) => Boolean(sketch.entities[selection.id]));
  }
  return Object.keys(state.history.present.sketches).length > 0;
}

function findActiveSketchWithProfile() {
  const state = useCadStore.getState();
  const document = state.history.present;
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
