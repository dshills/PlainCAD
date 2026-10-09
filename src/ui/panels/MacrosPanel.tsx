import { useEffect, useState } from "react";
import { executeCommand, isRegisteredCommandAvailable, type JsonValue } from "../../commands/registry";
import { useCadStore } from "../../state/useCadStore";
import { useMacroStore } from "../../commands/macroStore";
import type { ModelingMacro } from "../../commands/macros";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { useCommandPlan } from "../../state/commandPlanState";
import "./MacrosPanel.css";

interface ArgumentChoice { step: number; path: string[]; value: string | number | boolean }
function adjustableArguments(macro: ModelingMacro): ArgumentChoice[] {
  const choices: ArgumentChoice[] = [];
  macro.steps.forEach((step, index) => {
    const walk = (value: JsonValue, path: string[]) => {
      if (path.length && ["string", "number", "boolean"].includes(typeof value)) choices.push({ step: index, path, value: value as ArgumentChoice["value"] });
      else if (value && typeof value === "object" && !Object.hasOwn(value, "$result") && !Object.hasOwn(value, "$variable")) Object.entries(value).forEach(([key, child]) => walk(child, [...path, key]));
    };
    walk(step.arguments, []);
  });
  return choices;
}
export function MacrosPanel() {
  useCommandEnablement();
  useCommandPlan(state => state.status);
  useCadStore(state => state.rebuild);
  const available = (command: string) => isRegisteredCommandAvailable(command, "domain");
  const { saved, recording, draft, message, storageError } = useMacroStore();
  const [selectedId, setSelectedId] = useState(""), [name, setName] = useState(""), [values, setValues] = useState<Record<string, string>>({});
  const [argument, setArgument] = useState("0"), [variableName, setVariableName] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const selected = saved.find(item => item.id === selectedId), editable = draft ?? selected;
  const choices = editable ? adjustableArguments(editable) : [], choice = choices[Number(argument)];
  useEffect(() => { setValues({}); setArgument("0"); setVariableName(""); }, [selectedId, draft?.id]);
  useEffect(() => { if (draft) setName(draft.name); }, [draft?.id, draft?.name]);
  const run = async (command: string, args: JsonValue = {}) => {
    setError(""); setBusy(true);
    try {
      const response = await executeCommand({ command, arguments: args, session: useCadStore.getState().documentSession });
      if (!response.ok) throw new Error(response.error.message);
      return response.value;
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };
  const preview = () => {
    if (!selected) return;
    const input: Record<string, JsonValue> = {};
    for (const variable of selected.variables) {
      const raw = values[variable.name];
      if (raw === undefined) continue;
      if (variable.type === "number" && (!raw.trim() || !Number.isFinite(Number(raw)))) { setError(`${variable.name} needs a finite number.`); return; }
      input[variable.name] = variable.type === "number" ? Number(raw) : variable.type === "boolean" ? raw === "true" : raw;
    }
    void run("macro.preview", { macroId: selected.id, values: input });
  };
  const parameterize = () => {
    if (!choice) return;
    void run("macro.parameterize", { ...(draft ? {} : { macroId: selected!.id }), step: choice.step, path: choice.path, variable: { name: variableName.trim(), type: typeof choice.value, defaultValue: choice.value } }).then(result => { if (result !== undefined) { setArgument("0"); setVariableName(""); } });
  };
  return <section className="macros-panel" aria-label="Modeling workflows">
    <header><h2>Modeling workflows</h2><p>Record modeling intent, give repeated operations adjustable inputs, then inspect a native preview before applying.</p></header>
    <div className="macros-actions"><button type="button" disabled={busy || Boolean(recording) || !available("macro.start")} onClick={() => void run("macro.start")}>Record workflow</button>
      <button type="button" disabled={busy || !recording || !available("macro.stop")} onClick={() => void run("macro.stop")}>Stop recording</button>
      {recording ? <span role="status">Recording · {recording.steps.length} modeling steps</span> : null}</div>
    {draft ? <div className="macros-draft"><label>Workflow name<input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
      <button type="button" disabled={busy || !name.trim() || !available("macro.save")} onClick={() => void run("macro.save", { name })}>Save recorded workflow</button><p>{draft.steps.length} recorded steps</p></div> : null}
    <label>Saved workflow<select value={selected?.id ?? ""} onChange={event => setSelectedId(event.target.value)}><option value="">Choose a workflow</option>{saved.map(macro => <option key={macro.id} value={macro.id}>{macro.name} · {macro.steps.length} steps</option>)}</select></label>
    {selected ? <div className="macros-run"><h3>{selected.name}</h3>{selected.variables.map(variable => <label key={variable.name}>{variable.name}{variable.type === "boolean" ? <select value={values[variable.name] ?? String(variable.defaultValue)} onChange={event => setValues(current => ({ ...current, [variable.name]: event.target.value }))}><option value="true">True</option><option value="false">False</option></select> : <input type={variable.type === "number" ? "number" : "text"} value={values[variable.name] ?? String(variable.defaultValue)} onChange={event => setValues(current => ({ ...current, [variable.name]: event.target.value }))} />}</label>)}
      <div className="macros-actions"><button type="button" disabled={busy || Boolean(recording) || !available("macro.preview")} onClick={preview}>Preview workflow</button>
        <button type="button" disabled={busy || !available("macro.export")} onClick={() => void run("macro.export", { macroId: selected.id, download: true })}>Download workflow JSON</button>
        <button type="button" disabled={busy || Boolean(recording) || !available("macro.delete")} onClick={() => void run("macro.delete", { macroId: selected.id })}>Delete workflow</button></div>
      <p>Preview appears on the main model. Apply accepts all steps as one Undo; Cancel preserves the current project.</p></div> : null}
    {editable && choices.length ? <details><summary>Make an input adjustable</summary><label>Argument<select value={argument} onChange={event => setArgument(event.target.value)}>{choices.map((item, index) => <option key={index} value={index}>Step {item.step + 1} · {item.path.join(".")} = {String(item.value).slice(0, 80)}</option>)}</select></label>
      <label>Input name<input value={variableName} maxLength={40} placeholder="e.g. plateWidth" onChange={event => setVariableName(event.target.value)} /></label><button type="button" disabled={busy || !choice || !variableName.trim() || !available("macro.parameterize")} onClick={parameterize}>Add adjustable input</button></details> : null}
    <label className="macros-import">Import workflow JSON<input type="file" accept=".json,.pcadmacro.json,application/json" disabled={busy || Boolean(recording) || !available("macro.import")} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      if (file.size > 256 * 1024) { setError("Workflow JSON exceeds 256 KiB."); return; }
      void file.text().then(text => run("macro.import", { text })).catch(failure => setError(failure instanceof Error ? failure.message : String(failure)));
    }} /></label>
    {message ? <p role="status">{message}</p> : null}{storageError ? <p role="alert">{storageError}</p> : null}{error ? <p role="alert">{error}</p> : null}
    <p className="macros-note">Camera moves and interface clicks are excluded. Existing project references remain project specific; references created by earlier recorded steps are rebound during replay.</p>
  </section>;
}
