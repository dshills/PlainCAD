import { create } from "zustand";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { CadStore } from "./useCadStore";
import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";
import { PROJECT_IMPORT_LIMITS } from "../persistence/importSafety";

/** Display-only context. Never written to the document, selection or undo history. */
export interface GeometryHighlight {
  document: CadDocument;
  session: number;
  source: "ai" | "repair" | "operation";
  bodyIds: readonly string[];
  componentId?: string;
  /** Omit only when following the live settled rebuild; capture to bind a specific preview. */
  result?: RebuildResult;
  sketchId?: string;
  sketchEntityIds?: readonly string[];
}
export const useGeometryHighlight = create<{ highlight?: GeometryHighlight }>(
  () => ({}),
);

/** Identity-safe cleanup cannot erase a newer highlight from another interaction. */
export function showGeometryHighlight(input: GeometryHighlight): () => void {
  const highlight: GeometryHighlight = {
    ...input,
    bodyIds: [...new Set(input.bodyIds)].slice(
      0,
      MODEL_RESOURCE_LIMITS.maxBodies,
    ),
    ...(input.sketchEntityIds
      ? {
          sketchEntityIds: [...new Set(input.sketchEntityIds)].slice(
            0,
            PROJECT_IMPORT_LIMITS.maxSketchEntitiesPerSketch,
          ),
        }
      : {}),
  };
  useGeometryHighlight.setState({ highlight });
  return () => {
    if (useGeometryHighlight.getState().highlight === highlight)
      useGeometryHighlight.setState({ highlight: undefined });
  };
}

/** Failed rebuilds can still contain valid upstream repair previews. Pending,
 * replaced and busy-file contexts must never display yesterday's target. */
export function currentGeometryHighlight(
  state: Pick<CadStore, "history" | "documentSession" | "fileBusy" | "activeComponentId" | "rebuild">,
  highlight = useGeometryHighlight.getState().highlight,
): GeometryHighlight | undefined {
  const result = state.rebuild.result;
  if (
    !highlight ||
    highlight.document !== state.history.present ||
    highlight.session !== state.documentSession ||
    state.fileBusy ||
    (highlight.componentId !== undefined &&
      highlight.componentId !== state.activeComponentId) ||
    !["succeeded", "failed"].includes(state.rebuild.status) ||
    !result ||
    result.documentId !== state.history.present.id ||
    (highlight.result && highlight.result !== result)
  )
    return undefined;
  const live = new Set(result.meshes.map((mesh) => mesh.bodyId));
  const entities = highlight.sketchId
    ? state.history.present.sketches[highlight.sketchId]?.entities
    : undefined;
  return {
    ...highlight,
    bodyIds: highlight.bodyIds.filter((id) => live.has(id)),
    ...(highlight.sketchEntityIds
      ? {
          sketchEntityIds: highlight.sketchEntityIds.filter(
            (id) => entities && Object.hasOwn(entities, id),
          ),
        }
      : {}),
  };
}
