import { FASTENER_SIZES, fastenerSize, holePresetDiameter, type HolePreset } from "../../cad/hardware/fastenerCatalog";

export function FastenerSizeOptions() {
  return <>
    <optgroup label="Metric coarse">{FASTENER_SIZES.filter(size => size.unit === "mm").map(size =>
      <option key={size.id} value={size.id}>{size.label}</option>)}</optgroup>
    <optgroup label="Unified inch">{FASTENER_SIZES.filter(size => size.unit === "in").map(size =>
      <option key={size.id} value={size.id}>{size.label}</option>)}</optgroup>
  </>;
}

export function HolePresetControls({ preset, disabled, onChange }: {
  preset?: HolePreset;
  disabled?: boolean;
  onChange: (preset?: HolePreset, diameter?: string) => void;
}) {
  const choose = (value: HolePreset) => onChange(value, holePresetDiameter(value));
  return <>
    <label>
      Hole size preset
      <select value={preset?.size ?? ""} disabled={disabled} onChange={event => {
        const size = fastenerSize(event.target.value);
        if (size) choose({ size: size.id, kind: preset?.kind ?? "clearance" });
        else onChange();
      }}>
        <option value="">Custom diameter</option>
        <FastenerSizeOptions />
      </select>
    </label>
    {preset ? <>
      <label>
        Hole preset type
        <select value={preset.kind} disabled={disabled} onChange={event =>
          choose({ size: preset.size, kind: event.target.value === "tapDrill" ? "tapDrill" : "clearance" })}>
          <option value="clearance">General clearance</option>
          <option value="tapDrill">Tap drill</option>
        </select>
      </label>
      {preset.kind === "tapDrill" ? <p className="muted">Smooth pilot bore for tapping. No modeled threads.</p> : null}
    </> : null}
  </>;
}
