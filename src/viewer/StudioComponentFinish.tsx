import { useState } from "react";
import { COMPONENT_APPEARANCES, isComponentAppearance } from "../cad/document/componentAppearance";
import { bodyComponentId } from "../cad/document/components";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import { executeCommand } from "../commands/registry";
import { useCadStore } from "../state/useCadStore";
import { COMPONENT_FINISHES } from "./componentFinishes";

export function StudioComponentFinish() {
  const document = useCadStore(state => state.history.present);
  const session = useCadStore(state => state.documentSession);
  const selection = useCadStore(state => state.selection.selectedIds[0]);
  const active = useCadStore(state => state.activeComponentId);
  const rebuild = useCadStore(state => state.rebuild);
  const { editProject } = useCommandEnablement();
  const [choice, setChoice] = useState<string>();
  const owners = new Set(rebuild.result?.bodies.map(body => bodyComponentId(document, body.id)));
  const components = Object.values(document.components).filter(component => owners.has(component.id));
  const selected = selection?.kind === "body" ? bodyComponentId(document, selection.id) : undefined;
  const id = [choice, selected, active].find(value => value && owners.has(value)) ?? components[0]?.id;
  if (!id) return null;
  const component = document.components[id];
  const disabled = !editProject || rebuild.status !== "succeeded";

  return <fieldset className="studio-component-finish">
    <legend>Component finish</legend>
    <label>Component
      <select aria-label="Finish component" disabled={disabled} value={id} onChange={event => setChoice(event.target.value)}>
        {components.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <label>Appearance
      <select aria-label="Component appearance" disabled={disabled} value={component.appearance ?? "default"} onChange={event => {
        const finish = event.target.value;
        if (finish !== "default" && !isComponentAppearance(finish)) return;
        void executeCommand({ command: "cad.component.appearance", session, arguments: { componentId: id, finish } }).then(result => {
          if (!result.ok && useCadStore.getState().documentSession === session) useCadStore.getState().setFileError(result.error.message);
        });
      }}>
        <option value="default">Use studio finish</option>
        {COMPONENT_APPEARANCES.map(finish => <option key={finish} value={finish}>{COMPONENT_FINISHES[finish].label}</option>)}
      </select>
    </label>
  </fieldset>;
}
