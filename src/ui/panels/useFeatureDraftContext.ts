import { useEffect, useState } from "react";
import type { CadDocument } from "../../cad/document/schema";
import { documentAtFeature } from "../../cad/document/featureStage";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import { previewExtrusion } from "../../cad/worker/extrudePreviewClient";
import { useCadStore } from "../../state/useCadStore";
import { extrudeContext } from "../commands/extrudeCommand";

interface ContextDraft {
  document: CadDocument;
  componentId: string;
  feature: { id: string };
  editing?: boolean;
}
interface DraftContext {
  context?: ReturnType<typeof extrudeContext>;
  document: CadDocument;
  result?: RebuildResult;
  error?: string;
  ready: boolean;
}
/** Editing choices come from native geometry immediately before the original feature. */
export function useFeatureDraftContext(
  draft: ContextDraft,
  current: boolean,
  sketchId?: string,
): DraftContext {
  const [source] = useState(() => useCadStore.getState());
  const [value, setValue] = useState<DraftContext>(() => ({
    context:
      !draft.editing && sketchId ? extrudeContext(source, sketchId) : undefined,
    document: draft.document,
    result: source.rebuild.result,
    ready: !draft.editing,
  }));
  useEffect(() => {
    if (!draft.editing || !current) return;
    const controller = new AbortController();
    const document = documentAtFeature(draft.document, draft.feature.id);
    void previewExtrusion(document, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          !result.success ||
          result.documentId !== document.id ||
          result.meshes.some(
            (mesh) =>
              mesh.geometrySource !== "opencascade" ||
              !mesh.geometryAssertions?.valid,
          )
        )
          throw new Error(
            result.errors.map((error) => error.message).join(" ") ||
              "Repair upstream geometry before editing this feature.",
          );
        const state = {
          ...source,
          history: { ...source.history, present: document },
          rebuild: {
            ...source.rebuild,
            status: "succeeded" as const,
            kernelReady: true,
            result,
          },
        };
        setValue({
          document,
          result,
          context: sketchId ? extrudeContext(state, sketchId) : undefined,
          ready: true,
        });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setValue({
            document,
            ready: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      });
    return () => controller.abort();
  }, [draft, current, source, sketchId]);
  return value;
}
