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
  return active && current ? (
    <WorkflowForm
      key={`${active.session}:${active.kind}:${active.componentId}`}
    />
  ) : null;
}
function WorkflowForm() {
  const active = useProjectWorkflow((state) => state.active)!;
  const document = useCadStore((state) => state.history.present);
  const [name, setName] = useState(
    `Component ${Object.keys(document.components).length}`,
  );
  const [error, setError] = useState<string>();
  const close = () => useProjectWorkflow.setState({ active: undefined });
  const submit = (value: string) => {
    try {
      finishProjectWorkflow(active, value);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <ModalDialog
      label={active.kind === "component" ? "New Component" : "Create Sketch"}
      className="workflow-dialog"
      onDismiss={close}
    >
      <h2>
        {active.kind === "component"
          ? "New Component"
          : "Choose a sketch plane"}
      </h2>
      <p>
        Project: <strong>{document.name}</strong>
      </p>
      {active.kind === "component" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(name);
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
      ) : (
        <>
          <p>
            Component:{" "}
            <strong>{document.components[active.componentId].name}</strong>
          </p>
          <p className="muted">
            Choose an origin plane to enter sketch editing. Offset and supported
            face planes can be set in Sketch Properties.
          </p>
          <div className="plane-choices">
            {(["XY", "XZ", "YZ"] as const).map((plane, index) => (
              <button
                autoFocus={index === 0}
                key={plane}
                onClick={() => submit(plane)}
                aria-label={`Sketch on ${plane} plane`}
              >
                <strong>{plane}</strong>
                <span>
                  {plane === "XY"
                    ? "Top · normal +Z"
                    : plane === "XZ"
                      ? "Front · normal −Y"
                      : "Right · normal +X"}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <button onClick={close}>Cancel</button>
    </ModalDialog>
  );
}
