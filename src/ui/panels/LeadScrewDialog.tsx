import { useState } from "react";
import { executeCommand } from "../../commands/registry";
import type { TypedCadCommandCall } from "../../commands/cadCommandTypes";
import type { LeadNutFeature, LeadScrewFeature } from "../../cad/document/schema";
import { LEAD_STARTS, leadScrewDimensions, validateLeadScrewEdit } from "../../cad/hardware/leadScrewSettings";
import { evaluateParameters } from "../../cad/parameters/expressionEvaluator";
import { useHardwarePreset, type HardwareFrame } from "../../state/hardwarePresetState";
import { useCadStore } from "../../state/useCadStore";
import { ModalDialog } from "../ModalDialog";

export function LeadScrewDialog({ frame, lead }: { frame: HardwareFrame; lead: NonNullable<HardwareFrame["lead"]> }) {
  const current = useCadStore(state => state.history.present === frame.document && state.documentSession === frame.session &&
    state.activeComponentId === frame.componentId && !state.fileBusy);
  const original = frame.document.features.find(feature => feature.id === lead.editId);
  const originalScrew = original?.type === "leadScrew" ? original : undefined;
  const originalNut = original?.type === "leadNut" ? original : undefined;
  const screwId = originalNut?.screwFeatureId ?? lead.screwId;
  const source = frame.document.features.find(feature => feature.type === "leadScrew" && feature.id === screwId) as LeadScrewFeature | undefined;
  const nutOnly = Boolean(screwId);
  const [form, setForm] = useState<LeadScrewFeature["form"]>(originalScrew?.form ?? "trapezoidal");
  const [hand, setHand] = useState<LeadScrewFeature["hand"]>(originalScrew?.hand ?? "right");
  const [starts, setStarts] = useState<LeadScrewFeature["starts"]>(originalScrew?.starts ?? 1);
  const [diameter, setDiameter] = useState(originalScrew?.diameter.expression ?? "8mm");
  const [pitch, setPitch] = useState(originalScrew?.pitch.expression ?? "2mm");
  const [screwLength, setScrewLength] = useState(originalScrew?.screwLength.expression ?? "18mm");
  const [includeNut, setIncludeNut] = useState(!lead.editId);
  const [nutDefaults] = useState(() => {
    const mm = (value: number) => `${Number(value.toPrecision(12))}mm`;
    if (source) {
      try {
        const dims = leadScrewDimensions(source, undefined, evaluateParameters(frame.document.parameters).values);
        return {
          length: mm(Math.max(4.75 * dims.pitch, Math.min(dims.nutLength, dims.screwLength - dims.pitch))),
          clearance: mm(dims.clearance),
        };
      } catch {
        // Repair remains available through the screw editor.
      }
    }
    return { length: "10mm", clearance: "0.1mm" };
  });
  const [nutLength, setNutLength] = useState(originalNut?.nutLength.expression ?? nutDefaults.length);
  const [clearance, setClearance] = useState(originalNut?.clearance.expression ?? nutDefaults.clearance);
  const [error, setError] = useState("");
  const close = () => useHardwarePreset.setState({ frame: undefined });
  const label = lead.editId ? (nutOnly ? "Edit matching nut" : "Edit lead screw") : nutOnly ? "Add matching nut" : "Lead screw and nut";
  const screwInput = { form, hand, starts, diameter, pitch, screwLength };
  const nutInput = { nutLength, clearance };

  return <ModalDialog label={label} className="file-dialog" onDismiss={close}>
    <form onChange={() => setError("")} onSubmit={event => {
      event.preventDefault();
      const state = useCadStore.getState();
      if (useHardwarePreset.getState().frame !== frame || state.history.present !== frame.document ||
          state.documentSession !== frame.session || state.activeComponentId !== frame.componentId || state.fileBusy) return;
      const ref = (expression: string, original?: LeadScrewFeature["pitch"]) =>
        original?.expression === expression ? original : { expression, unit: "mm", authoredUnit: frame.document.unitSettings.length };
      const parameters = evaluateParameters(frame.document.parameters).values;
      let steps: TypedCadCommandCall[];
      try {
        const screw: LeadScrewFeature = source ?? { id: originalScrew?.id ?? "draft", type: "leadScrew", operation: "newBody", name: "Lead screw",
          form, hand, starts, diameter: ref(diameter, originalScrew?.diameter), pitch: ref(pitch, originalScrew?.pitch),
          screwLength: ref(screwLength, originalScrew?.screwLength) };
        if (nutOnly && (!source || source.suppressed)) throw new Error("Select an active upstream lead screw.");
        const nut: LeadNutFeature | undefined = nutOnly || includeNut ? { id: "draft-nut", type: "leadNut", operation: "newBody",
          name: "Matching nut", screwFeatureId: screw.id, nutLength: ref(nutLength, originalNut?.nutLength),
          clearance: ref(clearance, originalNut?.clearance) } : undefined;
        if (originalScrew) validateLeadScrewEdit(frame.document, screw, parameters);
        else leadScrewDimensions(screw, nut, parameters);
        if (lead.editId) steps = [{ command: "cad.feature.update", arguments: {
          ...(nutOnly ? nutInput : screwInput), featureId: lead.editId, ...(lead.reactivate ? { suppressed: false } : {}),
        } }];
        else if (nutOnly) steps = [{ command: "cad.hardware.leadNut", arguments: { ...nutInput, screwFeatureId: screwId! } }];
        else {
          steps = [{ command: "cad.hardware.leadScrew", arguments: { ...screwInput, as: "screw" } }];
          if (includeNut) steps.push({ command: "cad.hardware.leadNut", arguments: { ...nutInput, screwFeatureId: "$screw" } });
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return;
      }
      close();
      void executeCommand({ command: "plan.preview", session: frame.session, arguments: { label, steps } }).then(response => {
        if (!response.ok && useCadStore.getState().documentSession === frame.session) useCadStore.getState().setFileError(response.error.message);
      });
    }}>
      <h2>{label}</h2>
      {nutOnly ? <p>Matched to {source?.name ?? "lost lead screw"}. The nut follows its pitch, profile, handedness and starts.</p> : <>
        <label>Thread profile<select value={form} onChange={event => setForm(event.target.value === "acme" ? "acme" : "trapezoidal")}>
          <option value="trapezoidal">Trapezoidal · 30°</option><option value="acme">Acme · 29°</option>
        </select></label>
        <label>Handedness<select value={hand} onChange={event => setHand(event.target.value === "left" ? "left" : "right")}>
          <option value="right">Right-hand</option><option value="left">Left-hand</option>
        </select></label>
        <label>Thread starts<select value={starts} onChange={event => setStarts(Number(event.target.value) as LeadScrewFeature["starts"])}>
          {LEAD_STARTS.map(value => <option value={value} key={value}>{value}</option>)}
        </select></label>
        <label>Major diameter<input value={diameter} onChange={event => setDiameter(event.target.value)} /></label>
        <label>Thread pitch<input value={pitch} onChange={event => setPitch(event.target.value)} /></label>
        <label>Screw length<input value={screwLength} onChange={event => setScrewLength(event.target.value)} /></label>
        <p>Travel per revolution equals pitch × starts.</p>
        {!lead.editId ? <label><input type="checkbox" checked={includeNut} onChange={event => setIncludeNut(event.target.checked)} />Include matching nut</label> : null}
      </>}
      {nutOnly || includeNut ? <>
        <label>Nut length<input value={nutLength} onChange={event => setNutLength(event.target.value)} /></label>
        <label>Radial clearance<input value={clearance} onChange={event => setClearance(event.target.value)} /></label>
      </> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!current ? <p role="status">Project or component changed. Reopen the hardware command.</p> : null}
      <div className="ai-actions">
        <button type="submit" disabled={!current}>Preview hardware</button>
        <button type="button" onClick={close}>Cancel</button>
      </div>
    </form>
  </ModalDialog>;
}
