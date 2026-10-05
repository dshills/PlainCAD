import type {
  CadDocument,
  Feature,
  FacePlaneReference,
  ExtrudeTermination,
} from "../cad/document/schema";
import { faceOwnerModifiedBefore, stableFaceId } from "../cad/sketch/planes";
import type { AiFaceReference, AiStep } from "./plan";
/** Only earlier, unmodified recipe-owned distance extrusions publish supported planes. */
export function resolveAiFaceReference(
  document: CadDocument,
  owners: Map<string, Feature>,
  boundaries: Map<string, string[]>,
  liveBodies: Set<string>,
  reference: AiFaceReference,
): FacePlaneReference {
  const owner = owners.get(reference.owner);
  if (
    !owner ||
    owner.type !== "extrude" ||
    owner.operation !== "newBody" ||
    owner.suppressed ||
    (owner.termination && owner.termination.type !== "distance") ||
    !liveBodies.has(reference.owner)
  )
    throw new Error(
      `AI face ${reference.owner} requires an earlier live distance New Body extrusion owner.`,
    );
  if (faceOwnerModifiedBefore(document, owner.id, {}))
    throw new Error(
      `AI face ${reference.owner} was modified by an earlier operation. Select an unmodified extrusion owner.`,
    );
  let sourceId: string | undefined;
  if (reference.role === "side") {
    sourceId = boundaries.get(owner.sketchId)?.[reference.edge];
    if (
      !sourceId ||
      document.sketches[owner.sketchId]?.entities[sourceId]?.type !== "line"
    )
      throw new Error(
        "AI side face requires an existing straight outer-boundary edge index; curved and inner-loop sides are unavailable.",
      );
  }
  return {
    type: "face",
    featureId: owner.id,
    stableFaceId: stableFaceId(owner.id, reference.role, sourceId),
  };
}

export function aiExtrudeTermination(
  step: Extract<AiStep, { type: "extrude" }>,
  resolveFace: (reference: AiFaceReference) => FacePlaneReference,
): ExtrudeTermination {
  if (step.termination !== "toFace") return { type: step.termination };
  if (!step.face) throw new Error("AI To Face requires a target face.");
  const face = resolveFace(step.face);
  // The native kernel verifies positive reach and finite coverage, including holes.
  return {
    type: "toFace",
    faceRef: {
      kind: "face",
      featureId: face.featureId,
      role: "planarFace",
      stableHint: face.stableFaceId,
      transientId: face.stableFaceId,
    },
  };
}
