import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import type { Feature } from "../../cad/document/schema";
import { useCadStore } from "../../state/useCadStore";
import { solidDimensionImpact, solidDimensionParameters, solidDimensionRef, type SolidDimensionTarget } from "../../cad/inspection/solidDimensionEdit";
import { applySolidDimensionEdit, cancelSolidDimensionEdit, currentSolidDimensionFrame, previewSolidDimensionEdit, useSolidDimensionEdit, type SolidDimensionPreview, type SolidDimensionEditFrame } from "../commands/solidDimensionCommand";
import { runCommand } from "../commands/commandRegistry";
import "./SolidDimensionEditor.css";

export function SolidDimensionEditor() {
  const frame = useSolidDimensionEdit((state) => state.frame);
  const feature = frame?.document.features.find((item) => item.id === frame.dimension.featureId);
  useEffect(() => { if (frame && !feature) cancelSolidDimensionEdit(); }, [frame, feature]);
  return frame && feature ? <DimensionTask key={`${frame.session}:${frame.dimension.id}`} frame={frame} feature={feature} /> : null;
}
function DimensionTask({ frame, feature }: { frame: SolidDimensionEditFrame; feature: Feature }) {
  const base = useCadStore((state) => state.history.present);
  const session = useCadStore((state) => state.documentSession);
  const component = useCadStore((state) => state.activeComponentId);
  useCadStore((state) => state.rebuild);
  useCadStore((state) => state.fileBusy);
  const ref = solidDimensionRef(feature, frame.field);
  const choices = solidDimensionParameters(frame.document, ref);
  const [choice, setChoice] = useState(choices.length ? "" : "feature");
  const [expression, setExpression] = useState(ref.expression);
  const [preview, setPreview] = useState<SolidDimensionPreview>();
  const [message, setMessage] = useState(choices.length ? "Choose whether to edit a parameter or replace the feature formula." : "Enter a changed value to preview.");
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const target: SolidDimensionTarget | undefined = choice === "feature" ? { kind: "feature" } : choice ? { kind: "parameter", id: choice } : undefined;
  const targetKey = choice;
  useEffect(() => {
    const position = () => {
      const dialog = content.current?.closest("dialog"), anchor = document.querySelector(".solid-dimensions")?.getBoundingClientRect();
      if (dialog && anchor) {
        dialog.style.setProperty("--dimension-left", `${Math.max(8, Math.min(window.innerWidth - dialog.getBoundingClientRect().width - 8, anchor.left))}px`);
        dialog.style.setProperty("--dimension-top", `${Math.max(8, Math.min(window.innerHeight - Math.min(dialog.scrollHeight + 2, window.innerHeight - 16) - 8, anchor.top))}px`);
      }
    };
    position();
    // ResizeObserver notifications run during layout. Defer positioning writes
    // to the next frame so resizing the dialog cannot reenter that delivery loop.
    let pendingFrame: number | undefined;
    const schedulePosition = () => {
      if (pendingFrame !== undefined) return;
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = undefined;
        position();
      });
    };
    const dialog = content.current?.closest("dialog");
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedulePosition);
    if (dialog) observer?.observe(dialog);
    if (content.current) observer?.observe(content.current);
    window.addEventListener("resize", schedulePosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedulePosition);
      if (pendingFrame !== undefined) window.cancelAnimationFrame(pendingFrame);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController(), request = ++generation.current;
    setPreview(undefined); setError(false);
    if (!target) { setMessage("Choose whether to edit a parameter or replace the feature formula."); return () => controller.abort(); }
    setMessage("Checking native geometry…");
    const timer = window.setTimeout(() => {
      void previewSolidDimensionEdit(frame, target, expression, controller.signal).then((result) => {
        if (controller.signal.aborted || generation.current !== request || !currentSolidDimensionFrame(frame)) return;
        setPreview(result); setMessage(`Native preview ready · ${result.result.meshes.length} ${result.result.meshes.length === 1 ? "body" : "bodies"}. Apply saves one undo step.`);
      }).catch((cause: unknown) => {
        if (controller.signal.aborted || generation.current !== request) return;
        setError(true); setMessage(cause instanceof Error ? cause.message : String(cause));
      });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // The target is captured by its stable choice key; replacing input aborts the old worker.
  }, [frame, expression, targetKey]);
  const current = base === frame.document && session === frame.session && component === frame.componentId && currentSolidDimensionFrame(frame);
  const impact = solidDimensionImpact(frame.document, target?.kind === "parameter" ? "parameter" : "feature", target?.kind === "parameter" ? target.id : feature.id);
  return <ModalDialog className="solid-dimension-editor" label={`Edit solid ${frame.dimension.label.toLowerCase()}`} onDismiss={cancelSolidDimensionEdit}>
    <div ref={content} className="solid-dimension-editor-content">
      <h2>{frame.dimension.label} · {feature.name}</h2>
      <p>Current: {frame.dimension.value} {frame.dimension.unit} · {ref.expression}</p>
      {choices.length ? <label>Edit target<select aria-label="Dimension edit target" value={choice} autoFocus onChange={(event) => {
        const value = event.target.value; setPreview(undefined); setChoice(value);
        setExpression(value === "feature" ? ref.expression : choices.find((item) => item.parameter.id === value)?.parameter.expression ?? ref.expression);
      }}><option value="">Choose an edit target…</option>
        {choices.map(({ parameter, reason }) => <option key={parameter.id} value={parameter.id} disabled={Boolean(reason)}>Parameter {parameter.name}{reason ? ` · ${reason}` : " · preserves feature formula"}</option>)}
        <option value="feature">Replace this feature formula</option>
      </select></label> : null}
      <label>Dimension expression<input aria-label="Dimension expression" autoFocus={!choices.length} value={expression} disabled={!choice || !current} onChange={(event) => { setPreview(undefined); setExpression(event.target.value); }} /></label>
      <p className="dimension-impact">Affects {impact.length} {impact.length === 1 ? "item" : "items"}: {impact.join(", ")}. {target?.kind === "parameter" ? "Shared uses of this parameter will also change." : choices.length && choice === "feature" ? "This explicitly replaces the feature formula; parameters keep their values." : ""}</p>
      <div role={error ? "alert" : "status"} aria-live="polite">{current ? message : "Project changed. Cancel and reopen this dimension."}</div>
      {preview && current ? <ExtrudePreview meshes={preview.result.meshes} label="Native dimension preview" /> : null}
      <div className="dimension-actions"><button type="button" onClick={cancelSolidDimensionEdit}>Cancel</button><button type="button" disabled={!current || !preview || preview.expression !== expression || JSON.stringify(preview.target) !== JSON.stringify(target)} onClick={() => {
        if (!preview) return;
        try { applySolidDimensionEdit(preview); } catch (cause) { setPreview(undefined); setError(true); setMessage(cause instanceof Error ? cause.message : String(cause)); }
      }}>Apply dimension</button></div>
      <button type="button" className="dimension-details" onClick={async () => {
        if (!currentSolidDimensionFrame(frame)) return;
        cancelSolidDimensionEdit();
        useCadStore.getState().select({ kind: "feature", id: feature.id, documentId: frame.document.id });
        try { await runCommand("feature.edit"); } catch (cause) { useCadStore.getState().setFileError(`Could not open feature details: ${cause instanceof Error ? cause.message : String(cause)}`); }
      }}>Edit feature details…</button>
    </div>
  </ModalDialog>;
}
