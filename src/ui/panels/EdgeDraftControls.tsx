import { useMemo, useState } from "react";
import type {
  CadDocument,
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
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import type { ModelingDraft } from "../commands/modelingDraftCommand";

import { useWorkspaceState } from "../../state/useWorkspaceState";
import { ModelingAdvancedOptions, ModelingTaskStep } from "./ModelingTask";

export function EdgeDraftControls({
  draft,
  feature,
  onChange,
  baseDocument,
  baseResult,
}: {
  draft: ModelingDraft;
  baseDocument: CadDocument;
  baseResult?: RebuildResult;
  feature: FilletFeature | ChamferFeature;
  onChange: (feature: FilletFeature | ChamferFeature) => void;
}) {
  const workbench = useWorkspaceState((state) => state.layout === "workbench");
  // Edit owners are measured immediately before this feature, so future owners
  // and already-absorbed bodies are excluded. Creation uses its current snapshot.
  const owners = useMemo(() => {
    const meshes = baseResult?.meshes ?? [];
    return baseDocument.features.filter(
      (owner): owner is ExtrudeFeature =>
        owner.type === "extrude" &&
        !owner.suppressed &&
        owner.operation === "newBody" &&
        (!owner.termination || owner.termination.type === "distance") &&
        featureComponentId(baseDocument, owner) === draft.componentId &&
        meshes.some(
          (mesh) =>
            mesh.bodyId === stableBodyIdForFeature(owner.id) &&
            mesh.geometrySource === "opencascade" &&
            mesh.geometryAssertions?.valid,
        ),
    );
  }, [baseDocument, baseResult, draft.componentId]);
  const [referenceIndex, setReferenceIndex] = useState(0);
  const selectedIndex = Math.min(
    referenceIndex,
    Math.max(0, feature.targetEdgeRefs.length - 1),
  );
  const ref = feature.targetEdgeRefs[selectedIndex],
    owner = owners.find((item) => item.id === ref?.featureId);
  const entities = Object.values(
    baseDocument.sketches[owner?.sketchId ?? ""]?.entities ?? {},
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
      targetEdgeRefs: feature.targetEdgeRefs.length
        ? feature.targetEdgeRefs.map((existing, index) =>
            index === selectedIndex
              ? createExtrudeEdgeRef(ownerId, role, sourceEntityId)
              : existing,
          )
        : [createExtrudeEdgeRef(ownerId, role, sourceEntityId)],
    });
  const expression =
    feature.type === "fillet" ? feature.radius : feature.distance;
  return (
    <>
      <ModelingTaskStep number={1}>Selection</ModelingTaskStep>
      {feature.targetEdgeRefs.length > 1 ? (
        <label>
          Edge reference
          <select
            aria-label="Edge reference"
            value={selectedIndex}
            onChange={(event) => setReferenceIndex(Number(event.target.value))}
          >
            {feature.targetEdgeRefs.map((edge, index) => (
              <option key={index} value={index}>
                Reference {index + 1} · {edge.role ?? "Lost role"}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Body from extrusion
        <select
          aria-label="Body from extrusion"
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
        Edges to change
        <select
          aria-label="Edges to change"
          disabled={!owner}
          value={ref?.role ?? "endCapPerimeter"}
          onChange={(event) => {
            if (!ref) return;
            const role = event.target.value as SupportedEdgeRole;
            // Preserve a lost source until explicitly reselected; clearing it
            // would silently change an individual edge into an entire perimeter.
            replace(
              ref.featureId,
              role,
              role === "profileEdge"
                ? entities.find((entity) => entity.type === "line")?.id
                : ref?.sourceEntityId,
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
      <p className="modeling-task-selection">
        {!ref
          ? "Choose a body to select edges."
          : !owner
            ? "The extrusion owner is lost or unavailable. Choose a current body."
            : <>
                {feature.targetEdgeRefs.length} edge {feature.targetEdgeRefs.length === 1 ? "group" : "groups"} selected.
                {ref.role === "profileEdge"
                  ? " Choose the source line in Advanced options."
                  : ref.sourceEntityId
                    ? " An individual source edge is selected in Advanced options."
                    : " A perimeter group changes all its original edges."}
              </>}

      </p>
      <ModelingTaskStep number={2}>Settings</ModelingTaskStep>
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
      <ModelingAdvancedOptions
        initiallyOpen={!workbench}
        required={
          ref?.role === "profileEdge" ||
          Boolean(ref?.sourceEntityId) ||
          Boolean(baseResult && ref && !owner)
        }
      >
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
            {ref?.sourceEntityId &&
            !entities.some((entity) => entity.id === ref.sourceEntityId) ? (
              <option value={ref.sourceEntityId}>Lost source — reselect</option>
            ) : null}
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
      </ModelingAdvancedOptions>
    </>
  );
}
