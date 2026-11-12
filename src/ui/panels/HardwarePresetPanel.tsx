import { useState } from "react";
import { executeCommand } from "../../commands/registry";
import { useHardwarePreset, type HardwareFrame } from "../../state/hardwarePresetState";
import { useCadStore } from "../../state/useCadStore";
import { ModalDialog } from "../ModalDialog";
import { validateFastenerLength } from "../../cad/hardware/fastenerBlank";
import { FastenerSizeOptions } from "./HolePresetControls";
import { ThreadDialog } from "./ThreadDialog";
import { LeadScrewDialog } from "./LeadScrewDialog";

export function HardwarePresetPanel() {
  const frame = useHardwarePreset(state => state.frame);
  if (!frame) return null;
  if (frame.lead) return <LeadScrewDialog key={frame.session} frame={frame} lead={frame.lead} />;
  return frame.thread ? <ThreadDialog key={frame.session} frame={frame} thread={frame.thread} /> : <FastenerDialog key={frame.session} frame={frame} />;
}

function FastenerDialog({ frame }: { frame: HardwareFrame }) {
  const current = useCadStore(state => state.history.present === frame.document &&
    state.documentSession === frame.session && state.activeComponentId === frame.componentId && !state.fileBusy);
  const [size, setSize] = useState("m3");
  const [length, setLength] = useState("12mm");
  const [error, setError] = useState("");
  const close = () => useHardwarePreset.setState({ frame: undefined });
  return <ModalDialog label="Insert fastener" className="file-dialog" onDismiss={close}>
    <form onSubmit={event => {
      event.preventDefault();
      const state = useCadStore.getState();
      if (useHardwarePreset.getState().frame !== frame || state.history.present !== frame.document ||
          state.documentSession !== frame.session || state.activeComponentId !== frame.componentId || state.fileBusy) return;
      try {
        validateFastenerLength(frame.document, { expression: length, unit: "mm", authoredUnit: frame.document.unitSettings.length });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return;
      }
      close();
      void executeCommand({ command: "plan.preview", session: frame.session, arguments: {
        label: "Insert fastener", steps: [{ command: "cad.hardware.fastener", arguments: { size, length } }],
      } }).then(response => {
        if (!response.ok && useCadStore.getState().documentSession === frame.session)
          useCadStore.getState().setFileError(response.error.message);
      });
    }}>
      <h2>Insert fastener</h2>
      <p>Add a socket-head blank as a separate component with an editable shaft and hex socket.</p>
      <label>Fastener size<select value={size} onChange={event => setSize(event.target.value)}><FastenerSizeOptions /></select></label>
      <label>Length below head<input value={length} onChange={event => { setLength(event.target.value); setError(""); }} /></label>
      {error ? <p role="alert">{error}</p> : null}
      {!current ? <p role="status">Project or component changed. Close and reopen Insert fastener.</p> : null}
      <div className="ai-actions">
        <button type="submit" disabled={!current || !length.trim()}>Preview fastener</button>
        <button type="button" onClick={close}>Cancel fastener</button>
      </div>
    </form>
  </ModalDialog>;
}
