import { useEffect, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import { ModalDialog } from "../ModalDialog";
import { applyShell, cancelShell, currentShell, previewShell, type ShellFrame, type ShellInput, type ShellPreview } from "../commands/shellCommand";
import { useShell } from "../../state/shellDraftState";

export function ShellPanel() {
  const frame = useShell(state => state.frame);
  return frame ? <ShellDialog key={frame.id} frame={frame} /> : null;
}

function ShellDialog({ frame }: { frame: ShellFrame }) {
  const current = useCadStore(state => currentShell(frame, state));
  const [input, setInput] = useState<ShellInput>({
    opening: frame.existing?.opening ?? frame.openings[0],
    wallThickness: frame.existing?.wallThickness.expression ?? "1mm",
  });
  const [checked, setChecked] = useState<{ input: ShellInput; preview?: ShellPreview; error?: string }>();
  const [applyError, setApplyError] = useState("");
  const edit = (patch: Partial<ShellInput>) => {
    setApplyError("");
    setInput(value => ({ ...value, ...patch }));
  };
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void previewShell(frame, input, controller.signal)
      .then(preview => { if (!controller.signal.aborted) setChecked({ input, preview }); })
      .catch(error => { if (!controller.signal.aborted) setChecked({ input, error: error instanceof Error ? error.message : String(error) }); }), 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [frame, input, current]);
  const shown = current && checked?.input === input ? checked : undefined;
  const label = frame.existing ? "Edit Shell" : "Shell";
  return <ModalDialog label={label} className="file-dialog model-dialog extrude-dialog" onDismiss={cancelShell}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!shown?.preview) return;
      try { applyShell(shown.preview, input); }
      catch (error) { setApplyError(error instanceof Error ? error.message : String(error)); }
    }}>
      <h2>{label}</h2>
      <p>Hollow {frame.source.name} inward from the selected cap. The outside size and body stay the same.</p>
      <label>Opening face<select value={input.opening} onChange={event => edit({ opening: event.target.value as ShellInput["opening"] })}>
        {frame.openings.map(opening => <option key={opening} value={opening}>{opening === "endCap" ? "End cap (away from sketch)" : "Start cap (at sketch)"}</option>)}
      </select></label>
      <label>Wall thickness<input value={input.wallThickness} onChange={event => edit({ wallThickness: event.target.value })} /></label>
      <ExtrudePreview meshes={shown?.preview?.result.meshes ?? []} label="Native Shell preview" />
      <p role="status">{!current ? "Project or selection changed. Close and reopen Shell."
        : shown?.error ? "Preview failed" : shown?.preview ? "Native Shell preview ready" : "Building native Shell preview…"}</p>
      {shown?.error || applyError ? <p role="alert">{applyError || shown?.error}</p> : null}
      <button type="submit" disabled={!shown?.preview}>Apply Shell</button>
      <button type="button" onClick={cancelShell}>Cancel Shell</button>
    </form>
  </ModalDialog>;
}
