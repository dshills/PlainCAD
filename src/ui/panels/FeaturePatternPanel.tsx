import { useEffect, useMemo, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { PatternControls } from "../../viewer/PatternControls";
import { patternControlModel } from "../../cad/features/patternManipulation";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { useCadStore } from "../../state/useCadStore";
import { documentAtFeature } from "../../cad/document/featureStage";
import { featureComponentId } from "../../cad/document/components";
import { isPatternSource, MAX_FEATURE_PATTERN_COUNT } from "../../cad/features/featurePattern";
import { applyFeaturePattern, cancelFeaturePattern, currentPatternFrame, previewFeaturePattern, useFeaturePattern, type FeaturePatternFrame, type FeaturePatternInput, type FeaturePatternPreview } from "../commands/featurePatternCommand";
import { ModelingTaskActions, ModelingTaskGuide, ModelingTaskStep } from "./ModelingTask";

const EMPTY_MESHES: FeaturePatternPreview["result"]["meshes"] = [];
export function FeaturePatternPanel() {
  const frame = useFeaturePattern(state => state.frame);
  return frame ? <PatternDialog key={`${frame.featureId}:${frame.session}`} frame={frame} /> : null;
}
function PatternDialog({ frame }: { frame: FeaturePatternFrame }) {
  const current = useCadStore(() => currentPatternFrame(frame));
  const settings = frame.feature?.pattern;
  const [input, setInput] = useState<FeaturePatternInput>(() => ({
    name: frame.feature?.name ?? "Feature pattern", sourceFeatureId: frame.sourceFeatureId,
    type: settings?.type ?? "linear", count: settings?.count.expression ?? "3",
    spacing: settings?.type === "linear" ? settings.spacing.expression : "10mm",
    direction: settings?.type === "linear" ? settings.direction : "X",
    angle: settings?.type === "circular" ? settings.angle.expression : "360deg",
    centerX: settings?.type === "circular" ? settings.centerX.expression : "0mm",
    centerY: settings?.type === "circular" ? settings.centerY.expression : "0mm",
  }));
  const patch = (change: Partial<FeaturePatternInput>) => setInput(value => ({ ...value, ...change }));
  const sources = useMemo(() => {
    const context = frame.feature ? documentAtFeature(frame.document, frame.feature.id) : frame.document;
    return context.features.filter(feature => isPatternSource(feature) && featureComponentId(context, feature) === frame.componentId);
  }, [frame]);
  const [preview, setPreview] = useState<{ input: FeaturePatternInput; value?: FeaturePatternPreview; error?: string }>();
  const [applyError, setApplyError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [lastPreview, setLastPreview] = useState<FeaturePatternPreview>();
  const sourceResult = useCadStore(state => state.rebuild.status === "succeeded" && state.rebuild.result?.success ? state.rebuild.result : undefined);
  useEffect(() => {
    setApplyError("");
    if (!current || dragging) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void previewFeaturePattern(frame, input, controller.signal)
        .then(value => { if (!controller.signal.aborted && currentPatternFrame(frame)) setPreview({ input, value }); })
        .catch(error => { if (!controller.signal.aborted && currentPatternFrame(frame)) setPreview({ input, error: error instanceof Error ? error.message : String(error) }); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [frame, input, current, dragging]);
  const shown = current && !dragging && preview?.input === input ? preview : undefined;
  useEffect(() => { if (shown?.value) setLastPreview(shown.value); }, [shown?.value]);
  const retainedPreview = current && lastPreview?.input.sourceFeatureId === input.sourceFeatureId ? lastPreview : undefined;
  const geometry = retainedPreview?.operation ?? (current && input.sourceFeatureId === frame.sourceFeatureId && sourceResult?.documentId === frame.document.id ? sourceResult : undefined);
  const displayedPreview = shown?.value ?? retainedPreview;
  const controls = useMemo(() => {
    try {
      if (!geometry) return { error: "Wait for the selected source geometry." };
      return { model: patternControlModel(frame.document, input, geometry, settings) };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [frame, input, settings, geometry]);
  const source = frame.document.features.find(feature => feature.id === input.sourceFeatureId),
    sketch = source && "sketchId" in source ? frame.document.sketches[source.sketchId] : undefined;
  return <ModalDialog className="file-dialog model-dialog extrude-dialog" label={frame.feature ? "Edit feature pattern" : "Create feature pattern"} onDismiss={cancelFeaturePattern}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!shown?.value) return;
      try { applyFeaturePattern(shown.value, input); } catch (error) { setApplyError(error instanceof Error ? error.message : String(error)); }
    }}>
      <h2>{frame.feature ? "Edit feature pattern" : "Repeat a hole or pocket"}</h2>
      <ModelingTaskGuide action="Choose an existing Hole or distance Cut Extrude, then repeat it along a sketch axis or around a sketch-plane center." />
      <div className="extrude-dialog-layout"><div>
        <ModelingTaskStep number={1}>Source</ModelingTaskStep>
        <label>Source feature<select aria-label="Pattern source feature" value={input.sourceFeatureId} onChange={event => patch({ sourceFeatureId: event.target.value })}>
          {!sources.some(feature => feature.id === input.sourceFeatureId) ? <option value={input.sourceFeatureId}>Lost or unsupported source</option> : null}
          {sources.map(feature => <option key={feature.id} value={feature.id}>{feature.name}</option>)}
        </select></label>
        <p className="muted">Instances stay linked to the source size, profile and depth. Coordinates use {sketch?.name ?? "the source sketch"}; X and Y mean its sketch axes.</p>
        <ModelingTaskStep number={2}>Arrangement</ModelingTaskStep>
        <label>Pattern type<select aria-label="Pattern type" value={input.type} onChange={event => patch({ type: event.target.value === "circular" ? "circular" : "linear" })}>
          <option value="linear">Linear</option><option value="circular">Circular</option>
        </select></label>
        <label>Count (including original)<input aria-label="Pattern count" value={input.count} onChange={event => patch({ count: event.target.value })} /></label>
        {input.type === "linear" ? <>
          <label>Sketch direction<select aria-label="Pattern direction" value={input.direction} onChange={event => patch({ direction: event.target.value === "Y" ? "Y" : "X" })}><option value="X">Sketch X</option><option value="Y">Sketch Y</option></select></label>
          <label>Spacing<input aria-label="Pattern spacing" value={input.spacing} onChange={event => patch({ spacing: event.target.value })} /></label>
        </> : <>
          <label>Sweep angle<input aria-label="Pattern sweep angle" value={input.angle} onChange={event => patch({ angle: event.target.value })} /></label>
          <label>Center X<input aria-label="Pattern center X" value={input.centerX} onChange={event => patch({ centerX: event.target.value })} /></label>
          <label>Center Y<input aria-label="Pattern center Y" value={input.centerY} onChange={event => patch({ centerY: event.target.value })} /></label>
          <p className="muted">360° distributes copies around a full circle without duplicating the original. A smaller sweep includes both endpoints. Negative angles reverse direction.</p>
        </>}
        <details className="ds-advanced"><summary>Advanced options</summary><label>Name<input aria-label="Pattern name" value={input.name} onChange={event => patch({ name: event.target.value })} /></label>
          <p className="muted">Count accepts scalar parameters (2–{MAX_FEATURE_PATTERN_COUNT}). Other settings accept expressions and units. Overlapping instances and copies that miss the body fail explicitly.</p>
        </details>
      </div><div>
        {controls.model ? <PatternControls key={`${input.sourceFeatureId}:${input.type}:${input.direction}`} model={controls.model} input={input} disabled={!current} onChange={patch} onDragging={setDragging} /> : <p className="muted">{controls.error} Use the numeric fields to repair settings or wait for the source preview.</p>}
        <ExtrudePreview meshes={displayedPreview?.result.meshes ?? EMPTY_MESHES} label="Native feature pattern geometry preview" />
        {displayedPreview && !shown?.value ? <p className="muted">Showing the last validated native preview. It does not yet match the current arrangement.</p> : null}
        <p role="status" aria-label="Pattern preview status" className={shown?.value ? "preview-ready" : "preview-pending"}>
          {!current ? "Project or component changed. Close and reopen Pattern." : shown?.error ? "Preview failed" : shown?.value ? `Native preview ready · ${shown.value.result.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0).toFixed(3)} mm³` : dragging ? "Dragging arrangement · native validation waits for release" : "Building native pattern preview…"}
        </p>
        {shown?.error || applyError ? <p role="alert">{applyError || shown?.error}</p> : null}
      </div></div>
      <ModelingTaskActions applyLabel="Apply pattern" cancelLabel="Cancel pattern" disabled={!shown?.value} onCancel={cancelFeaturePattern} />
    </form>
  </ModalDialog>;
}
