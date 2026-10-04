import type {
  CadDocument,
  FacePlaneReference,
  OriginPlane,
} from "../document/schema";
import type { RebuildResult } from "../worker/workerProtocol";
import { evaluateParameters } from "../parameters/expressionEvaluator";
import {
  faceOwnerModifiedBefore,
  resolveDocumentPlanes,
  sketchPlaneTransform,
  type Point3,
  type SketchPlaneTransform,
} from "./planes";
import { stableBodyIdForFeature } from "../features/featureGraph";
export interface SketchPlaneChoice {
  id: string;
  label: string;
  reference: OriginPlane | FacePlaneReference;
  transform: SketchPlaneTransform;
  bodyId?: string;
}
const origins: SketchPlaneChoice[] = (["XY", "XZ", "YZ"] as const).map(
  (plane) => ({
    id: plane,
    label: `${plane} plane`,
    reference: plane,
    transform: sketchPlaneTransform(plane),
  }),
);
const cache = new WeakMap<
  CadDocument,
  { result: RebuildResult; choices: SketchPlaneChoice[] }
>();
export function sketchPlaneChoices(
  document: CadDocument,
  result?: RebuildResult,
): SketchPlaneChoice[] {
  if (!result?.success || result.documentId !== document.id) return origins;
  const cached = cache.get(document);
  if (cached?.result === result) return cached.choices;
  const native = new Set(
    result.meshes
      .filter(
        (mesh) =>
          mesh.geometrySource === "opencascade" &&
          mesh.geometryAssertions?.valid,
      )
      .map((mesh) => mesh.bodyId),
  );
  const planes = resolveDocumentPlanes(
    document,
    evaluateParameters(document.parameters).values,
    new Map(Object.entries(result.solvedSketches ?? {})),
  );
  const choices = [
    ...origins,
    ...planes.faces
      .filter(
        (face) =>
          native.has(stableBodyIdForFeature(face.featureId)) &&
          // No consumer step: check modifications through the end of the current timeline.
          !faceOwnerModifiedBefore(document, face.featureId, {}),
      )
      .map((face) => ({
        id: face.id,
        label: face.label,
        reference: {
          type: "face" as const,
          featureId: face.featureId,
          stableFaceId: face.id,
        },
        transform: face.transform,
        bodyId: stableBodyIdForFeature(face.featureId),
      })),
  ];
  cache.set(document, { result, choices });
  return choices;
}
export function faceChoiceAt(
  choices: SketchPlaneChoice[],
  bodyId: string,
  point: Point3,
  normal: Point3,
): SketchPlaneChoice | undefined {
  const matches = choices.filter((choice) => {
    if (choice.bodyId !== bodyId) return false;
    const plane = choice.transform;
    const dot =
      plane.normal.x * normal.x +
      plane.normal.y * normal.y +
      plane.normal.z * normal.z;
    const distance =
      (point.x - plane.origin.x) * plane.normal.x +
      (point.y - plane.origin.y) * plane.normal.y +
      (point.z - plane.origin.z) * plane.normal.z;
    return dot > 1 - 1e-5 && Math.abs(distance) < 1e-5;
  });
  // Do not guess among coplanar authored side roles.
  return matches.length === 1 ? matches[0] : undefined;
}
