import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../state/useCadStore";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import { runCommand, selectCommandEnablement } from "../ui/commands/commandRegistry";
import type { SolidDimension } from "../cad/inspection/solidDimensions";
import "./SolidDimensionOverlay.css";

export interface DimensionProjection { x: number; y: number; depth: number; width: number; height: number }

/** Labels stay associated with authored fields; the ordinary native task owns preview and Apply. */
export function SolidDimensionOverlay({ dimensions, project, subscribeFrames }: {
  dimensions: SolidDimension[];
  project: (point: [number, number, number]) => DimensionProjection | undefined;
  subscribeFrames: (listener: () => void) => () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const base = useCadStore(useShallow((state) => ({
    document: state.history.present, session: state.documentSession, component: state.activeComponentId,
  })));
  const enablement = useCommandEnablement();
  const target = dimensions[0];
  const canEdit = Boolean(target && enablement.editSolidDimension);
  useEffect(() => {
    if (!dimensions.length) return;
    let lastPosition = "";
    let size = { width: 0, height: 0 };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      if (host.current) size = { width: host.current.offsetWidth, height: host.current.offsetHeight };
      lastPosition = "";
      position();
    });
    if (host.current) observer?.observe(host.current);
    function position() {
      const element = host.current, projected = project(dimensions[0].anchor);
      if (element) {
        const visible = projected && projected.depth >= -1 && projected.depth <= 1 &&
          projected.x >= 0 && projected.x <= projected.width && projected.y >= 0 && projected.y <= projected.height;
        if (element.hidden === Boolean(visible)) {
          element.hidden = !visible;
          lastPosition = "";
        }
        if (visible && projected) {
          const key = [projected.x.toFixed(1), projected.y.toFixed(1), projected.width, projected.height].join(":");
          if (key !== lastPosition) {
            if (!size.width || !size.height) size = { width: element.offsetWidth, height: element.offsetHeight };
            element.style.left = `${Math.max(4, Math.min(projected.width - size.width - 4, projected.x + 16))}px`;
            element.style.top = `${Math.max(4, Math.min(projected.height - size.height - 4, projected.y + 16))}px`;
            lastPosition = key;
          }
        }
      }
    }
    position();
    const unsubscribe = subscribeFrames(position);
    return () => { unsubscribe(); observer?.disconnect(); };
  }, [dimensions, project, subscribeFrames]);
  if (!dimensions.length) return null;
  return (
    <div ref={host} className="solid-dimensions" role="group" aria-label="Solid driving dimensions">
      <span className="solid-dimensions-heading">{dimensions[0].featureName} · driving dimensions</span>
      {dimensions.map((dimension) => (
        <button key={dimension.id} type="button"
          disabled={!canEdit}
          aria-label={`Edit solid ${dimension.label.toLowerCase()} for ${dimension.featureName}`}
          title={`${dimension.fieldLabel}: ${dimension.expression}. Affects ${dimension.affectedFeatures.join(", ")}. Choose the feature formula or a referenced parameter, then inspect native geometry before Apply.`}
          onClick={async () => {
            const state = useCadStore.getState();
            if (state.history.present !== base.document || state.documentSession !== base.session || state.activeComponentId !== base.component) return;
            if (!selectCommandEnablement(state).editSolidDimension) return;
            try {
              await runCommand("feature.editSolidDimension", { dimension });
            } catch (error) {
              useCadStore.getState().setFileError(`Could not edit dimension: ${error instanceof Error ? error.message : String(error)}`);
            }
          }}>
          <span>{dimension.label}</span>
          <strong>{Number(dimension.value.toPrecision(6))} {dimension.unit}</strong>
          {dimension.bound ? <small>Formula: {dimension.expression} · preserved on open</small> : null}
        </button>
      ))}
      <span className="solid-dimensions-hint">Affects {dimensions[0].affectedFeatures.length} {dimensions[0].affectedFeatures.length === 1 ? "feature" : "features"}: {dimensions[0].affectedFeatures.slice(0, 3).join(", ")}{dimensions[0].affectedFeatures.length > 3 ? "…" : ""}</span>
      <span className="solid-dimensions-hint">Edit → preview → Apply</span>
    </div>
  );
}
