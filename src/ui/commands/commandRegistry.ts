import { RefObject } from "react";
import { useCadStore } from "../../state/useCadStore";
import { createBoxTemplate, createMountingPlateTemplate } from "../../templates/templates";
import { importProjectFile } from "../../persistence/importProject";
import { downloadArrayBuffer, serializeProject } from "../../persistence/exportProject";
import { exportMeshesToStl } from "../../cad/kernel/stlExport";

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
