import { useEffect, useMemo, useRef } from "react";
import { useCadStore } from "../../state/useCadStore";
import {
  finishProjectWorkflow,
  useProjectWorkflow,
} from "../commands/projectWorkflowCommand";
import {
  currentPlaneChoices,
  useSketchPlanePicker,
} from "../commands/sketchPlanePicker";
export function SketchPlanePickerPanel() {
  const active = useProjectWorkflow((state) => state.active)!;
  const document = useCadStore((state) => state.history.present),
    rebuild = useCadStore((state) => state.rebuild);
  const hover = useSketchPlanePicker((state) => state.hover),
    error = useSketchPlanePicker((state) => state.error),
    offset = useSketchPlanePicker((state) => state.offset);
  const choices = useMemo(() => currentPlaneChoices(), [document, rebuild]);
  const ref = useRef<HTMLElement>(null);
  const close = () => useProjectWorkflow.setState({ active: undefined });
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null,
      panel = ref.current;
    panel?.querySelector<HTMLButtonElement>("button")?.focus();
    const cancel = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !window.document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        useProjectWorkflow.setState({ active: undefined });
      }
    };
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("keydown", cancel);
      useSketchPlanePicker.setState({ hover: undefined, error: undefined, offset: undefined });
      if (
        previous?.isConnected &&
        window.document.activeElement === window.document.body
      )
        previous.focus();
    };
  }, []);
  return (
    <section
      ref={ref}
      className="sketch-plane-picker"
      aria-label="Create Sketch"
    >
      <h2>Choose a sketch plane</h2>
      <p>
        Component:{" "}
        <strong>{document.components[active.componentId].name}</strong>
      </p>
      <p>
        Click a colored origin plane or a supported planar face in the viewer.
        Hover highlights the choice. These buttons also support keyboard
        selection.
      </p>
      <label>
        <input type="checkbox" aria-label="Use offset sketch plane" checked={offset !== undefined}
          onChange={event => useSketchPlanePicker.setState({ offset: event.target.checked ? "5mm" : undefined, error: undefined })} />
        Offset from selected plane or face
      </label>
      {offset !== undefined ? <label>Sketch plane offset
        <input value={offset} onChange={event => useSketchPlanePicker.setState({ offset: event.target.value, error: undefined })} />
      </label> : null}
      {offset !== undefined ? <p className="muted">Pick the base plane or face. The signed offset follows its normal and accepts length parameters. The sketch opens aligned to the resulting offset plane.</p> : null}
      <div className="plane-choices">
        {choices.map((choice) => (
          <button
            key={choice.id}
            aria-label={`Sketch on ${choice.label}`}
            onMouseEnter={() =>
              useSketchPlanePicker.setState({ hover: choice })
            }
            onFocus={() => useSketchPlanePicker.setState({ hover: choice })}
            onMouseLeave={() => {
              if (useSketchPlanePicker.getState().hover?.id === choice.id)
                useSketchPlanePicker.setState({ hover: undefined });
            }}
            onBlur={() => {
              if (useSketchPlanePicker.getState().hover?.id === choice.id)
                useSketchPlanePicker.setState({ hover: undefined });
            }}
            onClick={() => {
              try {
                finishProjectWorkflow(active, choice.reference);
              } catch (error) {
                useSketchPlanePicker.setState({
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }}
          >
            <strong>{choice.label}</strong>
          </button>
        ))}
      </div>
      <p role="status">
        {hover ? `Highlighted: ${hover.label}` : "Choose a plane or face."}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <p className="muted">
        Faces require a native-validated extrusion cap or straight side. Retained
        faces after Cut/Join are supported; curved, lost and split faces remain unavailable.
      </p>
      <button onClick={close}>Cancel plane selection</button>
    </section>
  );
}
