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
  createExtrudeFeature,
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
import { beginHoleCreation, holeCreationContext } from "./holeCommand";

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
  exportSelectedBody: boolean;
  createExtrude: boolean;
  createRevolve: boolean;
  selectedFeature: boolean;
  createEdgeTreatment: boolean;
  moveEarlier: boolean;
  moveLater: boolean;
  createHole: boolean;
}

export function selectCommandEnablement(state: CadStore): CommandEnablement {
  return {
    document: Boolean(state.history.present),
    undo: state.history.past.length > 0,
    redo: state.history.future.length > 0,
    exportStl: canExportStl(state) && !state.fileBusy,
    exportSelectedBody: canExportStl(state) && !state.fileBusy && Boolean(selectedExportBody(state)),
    createExtrude: canCreateExtrude(state),
    createRevolve: Boolean(defaultRevolveAxis(state)),
    selectedFeature: Boolean(getSelectedFeature(state)),
    createEdgeTreatment: Boolean(edgeTreatmentOwner(state)),
    moveEarlier: !planTimelineMove(state.history.present, state.selection.selectedIds[0], "earlier").reason,
    moveLater: !planTimelineMove(state.history.present, state.selection.selectedIds[0], "later").reason,
    createHole: Boolean(holeCreationContext(state)),
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
  { id: "file.exportSelectedBody", label: "Export Selected Body STL", enablementKey: "exportSelectedBody",
    run: async () => { const id = selectedExportBody(useCadStore.getState()); if (id) await runFabrication("separate", true, [id]); } },
  { id: "feature.hole", label: "Hole from Selected Sketch", description: "Choose explicit sketch point centers and one target body for a native cylindrical cut.", enablementKey: "createHole", run: beginHoleCreation },
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
      useCadStore.getState().setDocument(createMountingPlateTemplate()),
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
    enablementKey: "document",
    run: () => {
      createSketchCommand("XY");
    },
  },
  {
    id: "sketch.createXZ",
    label: "Create XZ Sketch",
    enablementKey: "document",
    run: () => createSketchCommand("XZ"),
  },
  {
    id: "sketch.createYZ",
    label: "Create YZ Sketch",
    enablementKey: "document",
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
      state.select({
        kind: "feature",
        id: feature.id,
        documentId: state.history.present.id,
      });
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
      state.updateDocument((d) => upsertFeature(d, feature));
      state.select({
        kind: "feature",
        id: feature.id,
        documentId: state.history.present.id,
      });
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
    run: () => globalThis.dispatchEvent(new Event("plaincad:fit-view")),
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
  const updated = mutator(sketch);
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
  state.updateDocument((document) => upsertSketch(document, sketch));
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
    sketches = Object.values(document.sketches);
  const selectedSketch =
    selection?.kind === "sketch"
      ? document.sketches[selection.id]
      : selection?.kind === "sketchEntity"
        ? sketches.find((s) => Boolean(s.entities[selection.id]))
        : undefined;
  const key = selectedSketch?.id ?? "all";
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
        f.id ===
        state.rebuild.result?.bodies.find((b) => b.id === selection.id)
          ?.featureId,
    );
  if (feature?.type === "fillet" || feature?.type === "chamfer") {
    const ownerId = feature.targetEdgeRefs[0]?.featureId;
    feature = document.features.find((f) => f.id === ownerId);
  }
  if (
    feature?.type !== "extrude" ||
    feature.suppressed ||
    feature.operation !== "newBody" ||
    feature.direction !== "positive" ||
    (feature.termination && feature.termination.type !== "distance")
  )
    return undefined;
  const mesh = state.rebuild.result?.meshes.find(
    (m) => m.bodyId === stableBodyIdForFeature(feature.id),
  );
  return availableCapRole(document, feature.id) &&
    mesh?.geometrySource === "opencascade" &&
    ["extrusion", "fillet", "chamfer"].includes(mesh.kernelOperation ?? "")
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
        availableCapRole(state.history.present, owner.id)!,
      ),
    ],
    createdAt: new Date().toISOString(),
  };
  const feature =
    type === "fillet"
      ? { ...common, type, radius: { expression: "1mm", unit: "mm" } }
      : { ...common, type, distance: { expression: "1mm", unit: "mm" } };
  state.updateDocument((d) => upsertFeature(d, feature));
  state.select({
    kind: "feature",
    id: feature.id,
    documentId: state.history.present.id,
  });
}

function availableCapRole(
  document: CadDocument,
  ownerId: string,
): "endCapPerimeter" | "startCapPerimeter" | undefined {
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
      : undefined;
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
