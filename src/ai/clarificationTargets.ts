import type { CadDocument } from "../cad/document/schema";
import {
  buildDependencyGraph,
  dependencyKey,
} from "../cad/document/dependencyGraph";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { AiEditContext } from "./plan";
import { aiEditContext } from "./editPlan";
import { aiFeatureEditContext } from "./featureEditPlan";
import type { AiScope } from "./contextualIntent";

export interface AiClarificationTarget {
  dimension: AiEditContext["parameters"][number];
  label: string;
  bodyIds: string[];
  bodyNames: string[];
  sketchId?: string;
  sketchEntityIds?: string[];
}
export const aiDimensionLabel = (name: string) => name.replace(/^ai_\d+_/, "");

/** Read-only authored dependency tracing. It explains existing bounded choices;
 * it cannot introduce new editable parameters, features, bodies or selections. */
export function aiClarificationTargets(
  document: CadDocument,
  componentId: string,
  scope: AiScope,
  choices: readonly AiEditContext["parameters"][number][],
  result: RebuildResult | undefined,
  featureId?: string,
): AiClarificationTarget[] {
  if (scope === "create") return [];
  const selectedFeature =
    scope === "feature"
      ? document.features.find((f) => f.id === featureId)
      : undefined;
  if (scope === "feature" && !selectedFeature) return [];
  const allowed =
    scope === "feature"
      ? aiFeatureEditContext(document, componentId, featureId ?? "")
      : aiEditContext(document, componentId);
  const graph = buildDependencyGraph(document);
  const meshes = result?.documentId === document.id ? result.meshes : [];
  const live = new Set(meshes.map((mesh) => mesh.bodyId));
  return choices.flatMap((choice) => {
    const dimension = allowed.parameters.find(
      (p) => p.id === choice.id && p.name === choice.name,
    );
    if (!dimension) return [];
    // Feature fields have synthetic IDs (e.g. feature:diameter), not parameter
    // nodes. All dimensions of that operation therefore share related solids;
    // field names/current values and the native preview distinguish exact edits.
    const root = selectedFeature
      ? dependencyKey("feature", selectedFeature.id)
      : dependencyKey("parameter", dimension.id);
    const pending = [root],
      visited = new Set<string>(),
      primarySketches = new Set<string>();
    if (selectedFeature && "sketchId" in selectedFeature)
      primarySketches.add(selectedFeature.sketchId);
    while (pending.length) {
      const key = pending.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const edge of graph.outputs.get(key) ?? []) {
        if (graph.nodes.get(key)?.kind === "parameter") {
          const target = graph.nodes.get(edge.to);
          if (target?.kind === "sketch") primarySketches.add(target.id);
          if (target?.kind === "feature") {
            const feature = document.features.find((f) => f.id === target.id);
            if (feature && "sketchId" in feature)
              primarySketches.add(feature.sketchId);
          }
        }
        pending.push(edge.to);
      }
    }
    const bodyIds = [...graph.bodyWriters]
      .filter(
        ([id, writer]) =>
          live.has(id) && visited.has(dependencyKey("feature", writer)),
      )
      .map(([id]) => id);
    const bodyNames = bodyIds.map(
      (id) =>
        result?.bodies.find((body) => body.id === id)?.name ?? "Modeled body",
    );
    const sketchId =
      primarySketches.size === 1 ? [...primarySketches][0] : undefined;
    return [
      {
        dimension,
        label: aiDimensionLabel(dimension.name),
        bodyIds,
        bodyNames,
        ...(sketchId && document.sketches[sketchId]
          ? {
              sketchId,
              sketchEntityIds: Object.keys(
                document.sketches[sketchId].entities,
              ),
            }
          : {}),
      },
    ];
  });
}
