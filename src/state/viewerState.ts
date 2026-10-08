import { create } from "zustand";
import type { CadDocument } from "../cad/document/schema";
import { bodyComponentId } from "../cad/document/components";

export type PresentationMode = "model" | "render";
export const STUDIO_MATERIAL_IDS = ["original", "metal", "powder"] as const;
export const STUDIO_BACKDROP_IDS = ["theme", "neutral", "warm", "dark"] as const;
export type StudioMaterial = typeof STUDIO_MATERIAL_IDS[number];
export type StudioBackdrop = typeof STUDIO_BACKDROP_IDS[number];
interface AppearancePreferences { showModelEdges: boolean; showGrid: boolean; }

interface ViewerState {
  session: number;
  hiddenBodyIds: string[];
  hiddenComponentIds: string[];
  hiddenSketchIds: string[];
  activeComponentTimeline: boolean;
  presentationMode: PresentationMode;
  studioMaterial: StudioMaterial;
  studioBackdrop: StudioBackdrop;
  modelPreferences: AppearancePreferences;
  renderPreferences: AppearancePreferences;
  showGrid: boolean;
  showModelEdges: boolean;
  optimizeWhileMoving: boolean;
  setPresentationMode(session: number, mode: PresentationMode): void;
  setStudioAppearance(session: number, change: { material?: StudioMaterial; backdrop?: StudioBackdrop }): void;
  toggleGrid(session: number): void;
  toggleModelEdges(session: number): void;
  toggleMovingQuality(session: number): void;
  openDocument(document: CadDocument, session: number): void;
  toggleBody(
    session: number,
    bodyId: string,
    availableIds: readonly string[],
  ): void;
  toggleSketch(
    session: number,
    sketchId: string,
    availableIds: readonly string[],
  ): void;
  toggleComponent(
    session: number,
    componentId: string,
    availableIds: readonly string[],
  ): void;
  isolateComponent(
    session: number,
    componentId: string,
    availableIds: readonly string[],
  ): void;
  toggleTimelineFilter(session: number): void;
  showAllBodies(session: number): void;
  showAll(session: number): void;
}
const defaults = {
  hiddenBodyIds: [] as string[],
  hiddenComponentIds: [] as string[],
  hiddenSketchIds: [] as string[],
  activeComponentTimeline: false,
  presentationMode: "model" as PresentationMode,
  studioMaterial: "original" as StudioMaterial,
  studioBackdrop: "theme" as StudioBackdrop,
  modelPreferences: { showModelEdges: true, showGrid: true },
  renderPreferences: { showModelEdges: false, showGrid: false },
  showGrid: true,
  showModelEdges: true,
  optimizeWhileMoving: true,
};
// Runtime view preferences never enter document history or project JSON.
export const useViewerState = create<ViewerState>((set, get) => {
  const current = (session: number) =>
    get().session === session ? get() : defaults;
  return {
    session: -1,
    ...defaults,
    // Keep source drawings editable, but open finished models without their overlays.
    openDocument: (document, session) =>
      set({
        ...defaults,
        session,
        hiddenSketchIds: [...new Set(document.features.flatMap((feature) =>
          !feature.suppressed && "sketchId" in feature && document.sketches[feature.sketchId]
            ? [feature.sketchId] : [],
        ))],
      }),
    setPresentationMode: (session, mode) => {
      const view = current(session);
      if (mode === view.presentationMode) return;
      const saved = { showModelEdges: view.showModelEdges, showGrid: view.showGrid };
      const next = mode === "model" ? view.modelPreferences : view.renderPreferences;
      set({ ...view, session, presentationMode: mode,
        ...(view.presentationMode === "model" ? { modelPreferences: saved } : { renderPreferences: saved }),
        ...next });
    },
    setStudioAppearance: (session, change) => {
      const view = get();
      if (view.session !== session || view.presentationMode !== "render") return;
      if (change.material !== undefined && !STUDIO_MATERIAL_IDS.includes(change.material)) return;
      if (change.backdrop !== undefined && !STUDIO_BACKDROP_IDS.includes(change.backdrop)) return;
      set({
        ...(change.material === undefined ? {} : { studioMaterial: change.material }),
        ...(change.backdrop === undefined ? {} : { studioBackdrop: change.backdrop }),
      });
    },
    toggleGrid: (session) => {
      const view = current(session);
      set({ ...view, session, showGrid: !view.showGrid });
    },
    toggleModelEdges: (session) => {
      const view = current(session);
      set({ ...view, session, showModelEdges: !view.showModelEdges });
    },
    toggleMovingQuality: (session) => {
      const view = current(session);
      set({ ...view, session, optimizeWhileMoving: !view.optimizeWhileMoving });
    },
    toggleBody: (session, bodyId, availableIds) => {
      if (!availableIds.includes(bodyId)) return;
      const view = current(session),
        hidden = view.hiddenBodyIds.filter((id) => availableIds.includes(id));
      set({
        ...view,
        session,
        hiddenBodyIds: hidden.includes(bodyId)
          ? hidden.filter((id) => id !== bodyId)
          : [...hidden, bodyId],
      });
    },
    toggleSketch: (session, sketchId, availableIds) => {
      if (!availableIds.includes(sketchId)) return;
      const view = current(session),
        hidden = view.hiddenSketchIds.filter((id) => availableIds.includes(id));
      set({
        ...view,
        session,
        hiddenSketchIds: hidden.includes(sketchId)
          ? hidden.filter((id) => id !== sketchId)
          : [...hidden, sketchId],
      });
    },
    toggleComponent: (session, componentId, availableIds) => {
      if (!availableIds.includes(componentId)) return;
      const view = current(session),
        hidden = view.hiddenComponentIds.filter((id) =>
          availableIds.includes(id),
        );
      set({
        ...view,
        session,
        hiddenComponentIds: hidden.includes(componentId)
          ? hidden.filter((id) => id !== componentId)
          : [...hidden, componentId],
      });
    },
    isolateComponent: (session, componentId, availableIds) => {
      if (!availableIds.includes(componentId)) return;
      set({
        ...current(session),
        session,
        hiddenBodyIds: [],
        hiddenComponentIds: availableIds.filter((id) => id !== componentId),
      });
    },
    toggleTimelineFilter: (session) =>
      set({
        ...current(session),
        session,
        activeComponentTimeline: !current(session).activeComponentTimeline,
      }),
    // Restoring body/component visibility preserves deliberate sketch decluttering.
    showAllBodies: (session) =>
      set({
        ...current(session),
        session,
        hiddenBodyIds: [],
        hiddenComponentIds: [],
      }),
    showAll: (session) =>
      set({
        ...current(session),
        session,
        hiddenBodyIds: [],
        hiddenComponentIds: [],
        hiddenSketchIds: [],
      }),
  };
});

export function hiddenViewerBodies(
  document: CadDocument,
  bodyIds: readonly string[],
  session: number,
  view: Pick<ViewerState, "session" | "hiddenBodyIds" | "hiddenComponentIds">,
): string[] {
  if (view.session !== session) return [];
  return bodyIds.filter(
    (id) =>
      view.hiddenBodyIds.includes(id) ||
      view.hiddenComponentIds.includes(bodyComponentId(document, id) ?? ""),
  );
}
