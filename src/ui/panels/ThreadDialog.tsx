import { useState } from "react";
import { executeCommand } from "../../commands/registry";
import type { ThreadFeature } from "../../cad/document/schema";
import { fastenerSize } from "../../cad/hardware/fastenerCatalog";
import { resolveThreadDimensions } from "../../cad/hardware/threadSettings";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { useHardwarePreset, type HardwareFrame } from "../../state/hardwarePresetState";
import { useCadStore } from "../../state/useCadStore";
import { ModalDialog } from "../ModalDialog";
import { FastenerSizeOptions } from "./HolePresetControls";

export function ThreadDialog({ frame, thread }: { frame: HardwareFrame; thread: NonNullable<HardwareFrame["thread"]> }) {
  const current = useCadStore(state => state.history.present === frame.document && state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId && !state.fileBusy);
  const original = frame.document.features.find(item => item.type === "thread" && item.id === thread.editId) as ThreadFeature | undefined;
  const bore = [...frame.document.features].reverse().find(item => item.type === "hole" && !item.suppressed &&
    item.preset?.kind === "tapDrill" && item.targetBodyIds?.includes(thread.targetBodyId));
  const preset = bore?.type === "hole" ? bore.preset : undefined;
  const [side, setSide] = useState<ThreadFeature["side"]>(original?.side ?? (preset ? "internal" : "external"));
  const [hand, setHand] = useState<ThreadFeature["hand"]>(original?.hand ?? "right");
  const [size, setSize] = useState(original?.size ?? preset?.size ?? "m3");
  const [length, setLength] = useState(original?.threadLength.expression ?? "3mm");
  const [offset, setOffset] = useState(original?.threadOffset.expression ?? "0mm");
  const [error, setError] = useState("");
  const presetSize = fastenerSize(size)!;
  const source = frame.document.features.find(item => `body:${item.id}` === thread.targetBodyId);
  const close = () => useHardwarePreset.setState({ frame: undefined });
  const label = original ? "Edit Thread" : "Modeled Thread";

  return <ModalDialog label={label} className="file-dialog" onDismiss={close}>
    <form onChange={() => setError("")} onSubmit={event => {
      event.preventDefault();
      const state = useCadStore.getState();
      if (useHardwarePreset.getState().frame !== frame || state.history.present !== frame.document ||
          state.documentSession !== frame.session || state.activeComponentId !== frame.componentId || state.fileBusy) return;
      const ref = (expression: string) => ({ expression, unit: "mm", authoredUnit: frame.document.unitSettings.length });
      try {
        resolveThreadDimensions({ id: original?.id ?? "", type: "thread", name: label, size, side, hand, targetBodyId: thread.targetBodyId,
          threadLength: original?.threadLength.expression === length ? original.threadLength : ref(length),
          threadOffset: original?.threadOffset.expression === offset ? original.threadOffset : ref(offset),
        }, evaluateParameters(frame.document.parameters).values);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return;
      }
      const settings = { size, side, hand, threadLength: length, threadOffset: offset };
      close();
      void executeCommand({ command: "plan.preview", session: frame.session, arguments: {
        label, steps: [original
          ? { command: "cad.feature.update", arguments: { ...settings, featureId: original.id, ...(thread.reactivate ? { suppressed: false } : {}) } }
          : { command: "cad.feature.thread", arguments: { ...settings, targetBodyId: thread.targetBodyId } }],
      } }).then(response => {
        if (!response.ok && useCadStore.getState().documentSession === frame.session) useCadStore.getState().setFileError(response.error.message);
      });
    }}>
      <h2>{label}</h2>
      <p>Target: {source?.name ?? "Lost body"}</p>
      <label>Thread side<select value={side} onChange={event => setSide(event.target.value === "internal" ? "internal" : "external")}>
        <option value="external">External shaft</option><option value="internal">Internal bore</option>
      </select></label>
      <label>Thread size<select value={size} onChange={event => setSize(event.target.value)}><FastenerSizeOptions /></select></label>
      <p>{side === "internal" ? "Tap-drill bore" : "Smooth shaft"} Ø{side === "internal" ? presetSize.tapDrill : presetSize.diameter} {presetSize.unit}. Length must be 1–12 pitches with runout space at both ends.</p>
      {side === "internal" ? <p>The preview includes a short relief at the bore mouth.</p> : null}
      <label>Handedness<select value={hand} onChange={event => setHand(event.target.value === "left" ? "left" : "right")}>
        <option value="right">Right-hand</option><option value="left">Left-hand</option>
      </select></label>
      <label>Thread length<input value={length} onChange={event => setLength(event.target.value)} /></label>
      <label>Additional start offset<input value={offset} onChange={event => setOffset(event.target.value)} /></label>
      {error ? <p role="alert">{error}</p> : null}
      {!current ? <p role="status">Project or component changed. Close and reopen Thread.</p> : null}
      <div className="ai-actions">
        <button type="submit" disabled={!current || !length.trim() || !offset.trim()}>Preview thread</button>
        <button type="button" onClick={close}>Cancel thread</button>
      </div>
    </form>
  </ModalDialog>;
}
