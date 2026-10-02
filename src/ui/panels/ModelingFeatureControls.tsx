import { useMemo } from "react";
import { Feature, ExtrudeFeature } from "../../cad/document/schema";
import { upsertFeature } from "../../cad/document/CadDocument";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import {
  faceOwnerModifiedBefore,
  resolveDocumentPlanes,
} from "../../cad/sketch/planes";
import {
  createExtrudeEdgeRef,
  SupportedEdgeRole,
} from "../../cad/features/topologyRefs";
import { useCadStore } from "../../state/useCadStore";
import { CommitInput } from "./CommitInput";

export function ToFaceControl({
  feature,
  pending,
  onCommit,
}: {
  feature: ExtrudeFeature;
  pending: boolean;
  onCommit: () => void;
}) {
  if (!pending && feature.termination?.type !== "toFace") return null;
  return <TargetFaceControl feature={feature} onCommit={onCommit} />;
}
function TargetFaceControl({
  feature,
  onCommit,
}: {
  feature: ExtrudeFeature;
  onCommit: () => void;
}) {
  const document = useCadStore((s) => s.history.present);
  const updateDocument = useCadStore((s) => s.updateDocument);
  const faces = useMemo(
    () =>
      resolveDocumentPlanes(
        document,
        evaluateParameters(document.parameters).values,
      ).faces.filter((face) => {
        const owner = document.features.find((f) => f.id === face.featureId);
        return (
          owner &&
          owner.id !== feature.id &&
          !faceOwnerModifiedBefore(document, owner.id, feature) &&
          (owner.timelineStep === undefined ||
            feature.timelineStep === undefined ||
            owner.timelineStep < feature.timelineStep)
        );
      }),
    [document, feature],
  );
  const ref =
    feature.termination?.type === "toFace"
      ? feature.termination.faceRef
      : undefined;
  return (
    <label>
      Target face
      <select
        value={ref?.stableHint ?? ref?.transientId ?? ""}
        onChange={(event) => {
          const face = faces.find((f) => f.id === event.target.value);
          if (!face) return;
          updateDocument((d) =>
            upsertFeature(d, {
              ...feature,
              termination: {
                type: "toFace",
                faceRef: {
                  featureId: face.featureId,
                  kind: "face",
                  role: "planarFace",
                  transientId: face.id,
                  stableHint: face.id,
                },
              },
            }),
          );
          onCommit();
        }}
      >
        <option value="">Select a covering planar face</option>
        {!faces.some(
          (f) => f.id === (ref?.stableHint ?? ref?.transientId ?? ""),
        ) &&
        (ref?.stableHint ?? ref?.transientId ?? "") ? (
          <option value={ref?.stableHint ?? ref?.transientId ?? ""}>
            Lost face — reselect
          </option>
        ) : null}
        {faces.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ModelingFeatureControls({ feature }: { feature: Feature }) {
  const document = useCadStore((s) => s.history.present);
  const updateDocument = useCadStore((s) => s.updateDocument);
  const result = useCadStore((s) => s.rebuild.result);
  const update = (next: Feature) =>
    updateDocument((d) => upsertFeature(d, next));
  if (feature.type === "revolve") {
    const lines = Object.values(
      document.sketches[feature.sketchId]?.entities ?? {},
    ).filter((e) => e.type === "line");
    const axisValue =
      feature.axis.type === "origin"
        ? `origin:${feature.axis.axis}`
        : `line:${feature.axis.lineId}`;
    return (
      <div className="inspector-form">
        <label>
          Name
          <CommitInput
            value={feature.name}
            onCommit={(name) => update({ ...feature, name })}
          />
        </label>
        <label>
          Angle
          <CommitInput
            value={feature.angle.expression}
            onCommit={(expression) =>
              update({ ...feature, angle: { ...feature.angle, expression } })
            }
          />
        </label>
        <label>
          Revolve axis
          <select
            value={axisValue}
            onChange={(e) => {
              const value = e.target.value;
              if (
                value === "origin:X" ||
                value === "origin:Y" ||
                value === "origin:Z"
              )
                update({
                  ...feature,
                  axis: {
                    type: "origin",
                    axis: value.slice(7) as "X" | "Y" | "Z",
                  },
                });
              else if (lines.some((l) => `line:${l.id}` === value))
                update({
                  ...feature,
                  axis: {
                    type: "sketchLine",
                    sketchId: feature.sketchId,
                    lineId: value.slice(5),
                  },
                });
            }}
          >
            {["X", "Y", "Z"].map((axis) => (
              <option key={axis} value={`origin:${axis}`}>
                Origin {axis}
              </option>
            ))}
            {lines.map((line) => (
              <option key={line.id} value={`line:${line.id}`}>
                {line.construction ? "Construction" : "Sketch"} line {line.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Operation
          <select
            value={feature.operation}
            onChange={(e) => {
              const operation = e.target.value;
              if (
                operation === "newBody" ||
                operation === "join" ||
                operation === "cut"
              )
                update({ ...feature, operation });
            }}
          >
            <option value="newBody">New body</option>
            <option value="join">Join</option>
            <option value="cut">Cut</option>
          </select>
        </label>
        <label>
          Target body
          <select
            value={feature.targetBodyIds?.[0] ?? ""}
            onChange={(e) =>
              update({
                ...feature,
                targetBodyIds: e.target.value ? [e.target.value] : [],
              })
            }
          >
            <option value="">None</option>
            {result?.bodies
              .filter((b) => b.id !== `body:${feature.id}`)
              .map((body) => (
                <option key={body.id} value={body.id}>
                  {body.name}
                </option>
              ))}
          </select>
        </label>
        <p className="muted">
          Use an axis in the sketch plane and an angle greater than 0 through
          360 degrees. The profile must stay on one side of the axis.
        </p>
      </div>
    );
  }
  if (feature.type !== "fillet" && feature.type !== "chamfer") return null;
  const ref = feature.targetEdgeRefs[0];
  const owner = document.features.find((f) => f.id === ref?.featureId);
  const entities =
    owner?.type === "extrude"
      ? Object.values(document.sketches[owner.sketchId]?.entities ?? {}).filter(
          (e) => !e.construction && ["line", "arc"].includes(e.type),
        )
      : [];
  const expression =
    feature.type === "fillet" ? feature.radius : feature.distance;
  const owners = document.features.filter(
    (f) =>
      f.type === "extrude" &&
      !f.suppressed &&
      f.operation === "newBody" &&
      f.direction === "positive" &&
      (!f.termination || f.termination.type === "distance") &&
      (f.timelineStep === undefined ||
        feature.timelineStep === undefined ||
        f.timelineStep < feature.timelineStep),
  );
  const replaceRefs = (role: SupportedEdgeRole, sourceEntityId?: string) => {
    if (!ref) return;
    update({
      ...feature,
      targetEdgeRefs: [
        createExtrudeEdgeRef(ref.featureId, role, sourceEntityId),
      ],
    });
  };
  return (
    <div className="inspector-form">
      <label>
        Name
        <CommitInput
          value={feature.name}
          onCommit={(name) => update({ ...feature, name })}
        />
      </label>
      <label>
        {feature.type === "fillet" ? "Fillet radius" : "Chamfer distance"}
        <CommitInput
          value={expression.expression}
          onCommit={(value) =>
            update(
              feature.type === "fillet"
                ? {
                    ...feature,
                    radius: { ...feature.radius, expression: value },
                  }
                : {
                    ...feature,
                    distance: { ...feature.distance, expression: value },
                  },
            )
          }
        />
      </label>
      <label>
        Extrusion owner
        <select
          value={ref?.featureId ?? ""}
          onChange={(e) => {
            if (owners.some((f) => f.id === e.target.value))
              update({
                ...feature,
                targetEdgeRefs: [
                  createExtrudeEdgeRef(e.target.value, "endCapPerimeter"),
                ],
              });
          }}
        >
          <option value="">Select an upstream extrusion</option>
          {ref && !owners.some((f) => f.id === ref.featureId) ? (
            <option value={ref.featureId}>Lost extrusion — reselect</option>
          ) : null}
          {owners.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Edge role
        <select
          disabled={!ref}
          value={ref?.role ?? "endCapPerimeter"}
          onChange={(e) => {
            const role = e.target.value as SupportedEdgeRole;
            const lineId = entities.find(
              (entity) => entity.type === "line",
            )?.id;
            if (role === "profileEdge" && !lineId) return;
            replaceRefs(role, role === "profileEdge" ? lineId : undefined);
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
          disabled={!ref}
          value={ref?.sourceEntityId ?? ""}
          onChange={(e) =>
            replaceRefs(
              (ref?.role ?? "endCapPerimeter") as SupportedEdgeRole,
              e.target.value || undefined,
            )
          }
        >
          <option value="" disabled={ref?.role === "profileEdge"}>
            Entire perimeter
          </option>
          {entities
            .filter((e) => ref?.role !== "profileEdge" || e.type === "line")
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.type} {e.id}
              </option>
            ))}
        </select>
      </label>
      <p className="muted">
        References belong to {owner?.name ?? "a lost extrusion"}. Missing or
        modified edges require reselection. Invalid sizes block export.
      </p>
    </div>
  );
}
