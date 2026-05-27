import { RefObject } from "react";
import { useCadStore } from "../../state/useCadStore";
import { createBoxTemplate, createMountingPlateTemplate } from "../../templates/templates";
import { importProjectFile } from "../../persistence/importProject";
import { downloadArrayBuffer, serializeProject } from "../../persistence/exportProject";
import { exportMeshesToStl } from "../../cad/kernel/stlExport";
import { upsertSketch } from "../../cad/document/CadDocument";
import { addCenterRectangle, addCircleAt, addCornerRectangle, createXySketch } from "../../cad/sketch/SketchModel";

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
