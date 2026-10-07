import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useViewerState } from "../state/viewerState";
import { useCadStore } from "../state/useCadStore";
import { useInspectionState } from "../state/inspectionState";
import { visibleMeasurementTargets, resolvedMeasurementSelection } from "./measurementPicking";
import { measureModelTargets } from "../cad/inspection/modelMeasurements";
import { formatMeasuredLength } from "../cad/inspection/measurements";
import { displayUnits } from "../cad/parameters/parameterUnits";
import type { DimensionProjection } from "./SolidDimensionOverlay";

export function ModelMeasurementReadout({ project, subscribeFrames }: {
  project: (point: [number, number, number]) => DimensionProjection | undefined;
  subscribeFrames: (listener: () => void) => () => void;
}) {
  const state = useCadStore(useShallow((state) => ({ document: state.history.present, session: state.documentSession, result: state.rebuild.result, status: state.rebuild.status, fileBusy: state.fileBusy })));
  const view = useViewerState(useShallow((view) => ({ session: view.session, presentationMode: view.presentationMode, hiddenBodyIds: view.hiddenBodyIds, hiddenComponentIds: view.hiddenComponentIds, hiddenSketchIds: view.hiddenSketchIds })));
  const inspection = useInspectionState(), host = useRef<HTMLDivElement>(null);
  const current = inspection.session === state.session && inspection.document === state.document && inspection.result === state.result && state.status === "succeeded" && state.result?.success && state.result.documentId === state.document.id && !state.fileBusy;
  const targets = useMemo(() => current && inspection.picking && inspection.targetIds.length > 0 ? resolvedMeasurementSelection(state.document, state.result, inspection, visibleMeasurementTargets()) : [], [current, inspection.picking, inspection.targetIds, inspection.document, inspection.result, state.document, state.result, view]);
  const first = targets.find((target) => target.id === inspection.targetIds[0]), second = targets.find((target) => target.id === inspection.targetIds[1]);
  const { text, label, anchor } = useMemo(() => {
    let text = "", label = "", anchor: [number, number, number] | undefined;
    if (first) try {
      const measurement = measureModelTargets(first, second), point = measurement.paths[0]?.[0] ?? first.plane?.origin;
      const unit = inspection.unit ?? displayUnits(state.document).length;
      label = measurement.label;
      if (point) anchor = [point.x, point.y, point.z];
      text = measurement.length !== undefined ? formatMeasuredLength(measurement.length, unit) : measurement.angle !== undefined ? `${measurement.angle.toFixed(4)} deg` : measurement.curve ? (measurement.curve.diameter !== undefined ? `Ø ${formatMeasuredLength(measurement.curve.diameter, unit)}` : formatMeasuredLength(measurement.curve.length, unit)) : measurement.point ? [measurement.point.x, measurement.point.y, measurement.point.z].map((value) => formatMeasuredLength(value, unit)).join(" / ") : "Choose a second planar face";
    } catch (error) { text = error instanceof Error ? error.message : String(error); }
    return { text, label, anchor };
  }, [first, second, inspection.unit, state.document]);
  useEffect(() => {
    if (!anchor) return;
    const point = anchor;
    const position = () => {
      const element = host.current, p = project(point);
      if (!element) return;
      element.hidden = !p || p.depth < -1 || p.depth > 1 || p.x < 0 || p.y < 0 || p.x > p.width || p.y > p.height;
      if (p) { element.style.left = `${Math.max(4, Math.min(p.width - element.offsetWidth - 4, p.x + 16))}px`; element.style.top = `${Math.max(4, Math.min(p.height - element.offsetHeight - 4, p.y + 16))}px`; }
    };
    position(); return subscribeFrames(position);
  }, [anchor, project, subscribeFrames]);
  if (!current || !inspection.picking || !first) return null;
  return <div ref={host} className="solid-dimensions" style={{ pointerEvents: "none" }} role="status" aria-label="Model measurement"><span className="solid-dimensions-heading">{label}</span><strong>{text}</strong></div>;
}
