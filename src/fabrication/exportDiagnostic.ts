import { stableBodyIdForFeature } from "../cad/document/ids";
import type { CadDocument } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";

/** Explain the existing bounded validator's errors without relaxing its checks. */
export function exportDiagnostic(
  message: string,
  document: CadDocument,
  result?: RebuildResult,
) {
  const body = [...(result?.bodies ?? [])]
      .sort((a, b) => b.id.length - a.id.length)
      .find((item) => {
        const escaped = item.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(
          message,
        );
      }),
    ownerId =
      body?.featureId ??
      document.features.find(
        (item) => stableBodyIdForFeature(item.id) === body?.id,
      )?.id,
    feature = document.features.find((item) => item.id === ownerId);
  let advice =
    "Repair the affected geometry, rebuild the model, and try exporting again.";
  if (
    /^Project (?:changed|replaced)|^Model changed after validation|selected bodies are no longer available/i.test(
      message,
    )
  )
    advice =
      "Close this task and reopen it after the current model finishes rebuilding. Choose its bodies again.";
  else if (/resource limit|budget|exceeds.*triangle|too many/i.test(message))
    advice =
      "Export fewer bodies at a time, or simplify the model and rebuild before exporting.";
  else if (
    /float32|nonfinite|collapsed|overflow|coordinate (?:range|magnitude|limit)/i.test(
      message,
    )
  )
    advice =
      "Check the affected part's dimensions and coordinates. Very large coordinates can lose detail in STL; move the sketch closer to the origin and rebuild.";
  else if (
    /self[- ]?intersect|open boundary|winding|non.manifold|inward|duplicate|degenerate/i.test(
      message,
    )
  )
    advice =
      "This mesh is not a closed, consistently oriented printable solid. Repair its source feature and rebuild; validation must pass before downloading.";
  else if (
    /intersect|overlap|containment|contained (?:in|by)|touching|touches/i.test(
      message,
    )
  )
    advice =
      "For separate parts, open Advanced STL options and choose Separate files. Joining overlapping parts into one solid requires a successful native union.";
  return {
    message,
    advice,
    bodyName: body?.name,
    featureId: feature?.id,
    featureName: feature?.name,
  };
}
