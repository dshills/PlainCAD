import { useState } from "react";
import type {
  ChamferFeature,
  ExtrudeFeature,
  FilletFeature,
} from "../../cad/document/schema";
import { featureComponentId } from "../../cad/document/components";
import { stableBodyIdForFeature } from "../../cad/features/featureGraph";
import {
  createExtrudeEdgeRef,
  type SupportedEdgeRole,
} from "../../cad/features/topologyRefs";
import { useCadStore } from "../../state/useCadStore";
import type { ModelingDraft } from "../commands/modelingDraftCommand";

export function EdgeDraftControls({
  draft,
  feature,
  onChange,
}: {
  draft: ModelingDraft;
  feature: FilletFeature | ChamferFeature;
  onChange: (feature: FilletFeature | ChamferFeature) => void;
}) {
  // Snapshot the successful native rebuild used to open this draft. Document,
  // session and component edits invalidate the parent preview rather than
  // refreshing choices against a different project state.
  const [owners] = useState(() => {
    const meshes = useCadStore.getState().rebuild.result?.meshes ?? [];
    return draft.document.features.filter(
      (owner): owner is ExtrudeFeature =>
        owner.type === "extrude" &&
        !owner.suppressed &&
        owner.operation === "newBody" &&
        (!owner.termination || owner.termination.type === "distance") &&
        featureComponentId(draft.document, owner) === draft.componentId &&
        meshes.some(
          (mesh) =>
            mesh.bodyId === stableBodyIdForFeature(owner.id) &&
            mesh.geometrySource === "opencascade" &&
            mesh.geometryAssertions?.valid,
        ),
    );
  });
  const ref = feature.targetEdgeRefs[0],
    owner = owners.find((item) => item.id === ref?.featureId);
  const entities = Object.values(
    draft.document.sketches[owner?.sketchId ?? ""]?.entities ?? {},
  ).filter(
    (entity) =>
      !entity.construction && (entity.type === "line" || entity.type === "arc"),
  );
  const replace = (
    ownerId: string,
    role: SupportedEdgeRole,
    sourceEntityId?: string,
  ) =>
    onChange({
      ...feature,
      targetEdgeRefs: [createExtrudeEdgeRef(ownerId, role, sourceEntityId)],
    });
  const expression =
    feature.type === "fillet" ? feature.radius : feature.distance;
  return (
    <>
      <label>
        {feature.type === "fillet" ? "Fillet radius" : "Chamfer distance"}
        <input
          value={expression.expression}
          onChange={(event) =>
            onChange(
              feature.type === "fillet"
                ? {
                    ...feature,
                    radius: {
                      ...feature.radius,
                      expression: event.target.value,
                    },
                  }
                : {
                    ...feature,
                    distance: {
                      ...feature.distance,
                      expression: event.target.value,
                    },
                  },
            )
          }
        />
      </label>
      <label>
        Extrusion owner
        <select
          aria-label="Extrusion owner"
          value={ref?.featureId ?? ""}
          onChange={(event) => {
            if (owners.some((item) => item.id === event.target.value))
              replace(event.target.value, "endCapPerimeter");
          }}
        >
          <option value="">Choose a native distance extrusion</option>
          {ref && !owner ? (
            <option value={ref.featureId}>Lost owner — reselect</option>
          ) : null}
          {owners.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Edge role
        <select
          aria-label="Edge role"
          disabled={!owner}
          value={ref?.role ?? "endCapPerimeter"}
          onChange={(event) => {
            if (!ref) return;
            const role = event.target.value as SupportedEdgeRole;
            replace(
              ref.featureId,
              role,
              role === "profileEdge"
                ? entities.find((entity) => entity.type === "line")?.id
                : undefined,
            );
          }}
        >
          <option value="endCapPerimeter">End cap perimeter</option>
          <option value="startCapPerimeter">Start cap perimeter</option>
          <option
            value="profileEdge"
            disabled={!entities.some((entity) => entity.type === "line")}
          >
            Side corners of source line
          </option>
        </select>
      </label>
      <label>
        Source edge
        <select
          aria-label="Source edge"
          disabled={!owner}
          value={ref?.sourceEntityId ?? ""}
          onChange={(event) => {
            if (ref)
              replace(
                ref.featureId,
                (ref.role ?? "endCapPerimeter") as SupportedEdgeRole,
                event.target.value || undefined,
              );
          }}
        >
          <option value="" disabled={ref?.role === "profileEdge"}>
            Entire perimeter
          </option>
          {entities
            .filter(
              (entity) => ref?.role !== "profileEdge" || entity.type === "line",
            )
            .map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.type} {entity.id}
              </option>
            ))}
        </select>
      </label>
      <p className="muted">
        Select original feature-owned edges. Retained edges after booleans are
        checked against current native geometry. Trimmed, missing or already
        changed edges and invalid sizes block Apply. Grouped perimeters require
        every original edge.
      </p>
    </>
  );
}
