import {
  ExtrudeFeature,
  RevolveFeature,
  HoleFeature,
} from "../../cad/document/schema";
import { upsertFeature } from "../../cad/document/CadDocument";
import {
  upstreamBodyOwners,
  upstreamSketches,
} from "../../cad/document/timelineEditing";
import { stableBodyIdForFeature } from "../../cad/features/featureGraph";
import { useCadStore } from "../../state/useCadStore";

type SketchFeature = ExtrudeFeature | RevolveFeature | HoleFeature;

export function FeatureReferenceControls({
  feature,
}: {
  feature: SketchFeature;
}) {
  const document = useCadStore((s) => s.history.present);
  const rebuild = useCadStore((s) => s.rebuild);
  const updateDocument = useCadStore((s) => s.updateDocument);
  const sketches = upstreamSketches(document, feature);
  const current =
    (rebuild.status === "succeeded" || rebuild.status === "failed") &&
    rebuild.result?.documentId === document.id;
  const profiles = current
    ? (rebuild.result?.profiles?.[feature.sketchId] ?? [])
    : [];
  const profileId = feature.type !== "hole" ? feature.profileId : undefined;
  const profile = profiles.find(
    (p) => p.id === profileId || p.alternateIds?.includes(profileId ?? ""),
  );
  return (
    <div className="inspector-form">
      <label>
        Source sketch
        <select
          value={feature.sketchId}
          onChange={(e) => {
            const sketchId = e.target.value;
            if (!sketches.some((s) => s.id === sketchId)) return;
            // Keep the authored profile/point references until the user explicitly repairs them.
            updateDocument((d) => {
              const stored = d.features.find((f) => f.id === feature.id);
              if (
                d.id !== document.id ||
                !stored ||
                !("sketchId" in stored) ||
                !upstreamSketches(d, stored).some((s) => s.id === sketchId)
              )
                return d;
              return upsertFeature(d, { ...stored, sketchId });
            });
          }}
        >
          {!sketches.some((s) => s.id === feature.sketchId) ? (
            <option value={feature.sketchId}>
              Lost or downstream sketch — reselect
            </option>
          ) : null}
          {sketches.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {feature.type !== "hole" ? (
        <label>
          Profile
          <select
            disabled={!current}
            value={profile?.id ?? profileId ?? ""}
            onChange={(e) => {
              const nextProfileId = e.target.value;
              if (!profiles.some((p) => p.id === nextProfileId)) return;
              updateDocument((d) => {
                const stored = d.features.find((f) => f.id === feature.id);
                const status = useCadStore.getState().rebuild.status;
                if (
                  d !== document ||
                  (status !== "succeeded" && status !== "failed") ||
                  !stored ||
                  !("profileId" in stored)
                )
                  return d;
                return upsertFeature(d, {
                  ...stored,
                  profileId: nextProfileId,
                });
              });
            }}
          >
            {!profile ? (
              <option value={profileId ?? ""}>
                {current
                  ? "Lost profile — reselect"
                  : "Waiting for current sketch profiles"}
              </option>
            ) : null}
            {profiles.map((p, i) => (
              <option key={p.id} value={p.id}>
                Profile {i + 1}: {(p.bounds.maxX - p.bounds.minX).toFixed(3)} ×{" "}
                {(p.bounds.maxY - p.bounds.minY).toFixed(3)} mm,{" "}
                {p.innerLoops.length} inner loop(s)
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <TargetBodyControl feature={feature} />
      {feature.type !== "hole" && (feature.targetBodyIds?.length ?? 0) > 1 ? <p className="warning-text">This feature references {feature.targetBodyIds!.length} bodies. Current modeling supports one target; choosing a body replaces the entire scope.</p> : null}
      <p className="muted">
        Repairs replace only the chosen reference. Missing references stay saved
        until you reselect them.
      </p>
    </div>
  );
}

export function TargetBodyControl({ feature }: { feature: SketchFeature }) {
  const document = useCadStore((s) => s.history.present);
  const updateDocument = useCadStore((s) => s.updateDocument);
  const owners = upstreamBodyOwners(document, feature, true);
  const target =
    feature.type === "hole"
      ? (feature.targetBodyId ??
        (feature.targetFeatureId
          ? stableBodyIdForFeature(feature.targetFeatureId)
          : ""))
      : (feature.targetBodyIds?.[0] ?? "");
  return (
    <label>
      Target body
      <select
        value={target}
        onChange={(e) => {
          const bodyId = e.target.value;
          if (
            bodyId &&
            !owners.some((o) => stableBodyIdForFeature(o.id) === bodyId)
          )
            return;
          updateDocument((d) => {
            const stored = d.features.find((f) => f.id === feature.id);
            if (
              d.id !== document.id ||
              !stored ||
              !("sketchId" in stored) ||
              (bodyId &&
              !upstreamBodyOwners(d, stored, true).some(
                  (o) => stableBodyIdForFeature(o.id) === bodyId,
                ))
            )
              return d;
            return upsertFeature(
              d,
              stored.type === "hole"
                ? {
                    ...stored,
                    targetBodyId: bodyId || undefined,
                    targetFeatureId: undefined,
                  }
                : { ...stored, targetBodyIds: bodyId ? [bodyId] : [] },
            );
          });
        }}
      >
        <option value="">None</option>
        {target &&
        !owners.some((o) => stableBodyIdForFeature(o.id) === target) ? (
          <option value={target}>Lost or downstream body — reselect</option>
        ) : null}
        {owners.map((o) => (
          <option key={o.id} value={stableBodyIdForFeature(o.id)}>
            {o.name} Body{o.suppressed ? " (suppressed — unsuppress to rebuild)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
