import { SketchPlanePickerPanel } from "./SketchPlanePickerPanel";
import { useEffect, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";
import {
  finishProjectWorkflow,
  useProjectWorkflow,
  workflowCurrent,
} from "../commands/projectWorkflowCommand";

export function ProjectWorkflowPanel() {
  const active = useProjectWorkflow((state) => state.active);
  const current = useCadStore((state) =>
    Boolean(active && workflowCurrent(active, state)),
  );
  useEffect(() => {
    if (active && !current) useProjectWorkflow.setState({ active: undefined });
  }, [active, current]);
  if (!active || !current) return null;
  return active.kind === "sketch" ? (
    <SketchPlanePickerPanel />
  ) : (
    <ComponentForm key={`${active.session}:${active.componentId}`} />
  );
}
function ComponentForm() {
  const active = useProjectWorkflow((state) => state.active)!;
  const document = useCadStore((state) => state.history.present);
  const [name, setName] = useState(
      `Component ${Object.keys(document.components).length}`,
    ),
    [error, setError] = useState<string>();
  const close = () => useProjectWorkflow.setState({ active: undefined });
  return (
    <ModalDialog
      label="New Component"
      className="workflow-dialog"
      onDismiss={close}
    >
      <h2>New Component</h2>
      <p>
        Project: <strong>{document.name}</strong>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            finishProjectWorkflow(active, name);
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          }
        }}
      >
        <label>
          Component name
          <input
            autoFocus
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="muted">
          The new component becomes active. Its sketches and bodies are saved
          inside this project.
        </p>
        <button type="submit">Create component</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <button onClick={close}>Cancel</button>
    </ModalDialog>
  );
}
