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
const spatialPlanes = {
  XY: {
    name: "Top (XY) plane",
    hint: "X right · Y up · normal +Z",
    path: "M 10 28 L 36 16 L 62 28 L 36 40 Z",
  },
  XZ: {
    name: "Front (XZ) plane",
    hint: "X right · Z up · normal −Y",
    path: "M 10 16 L 50 16 L 50 42 L 10 42 Z",
  },
  YZ: {
    name: "Side (YZ) plane",
    hint: "Y right · Z up · normal +X",
    path: "M 22 10 L 50 22 L 50 48 L 22 36 Z",
  },
} as const;
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
      useSketchPlanePicker.setState({
        hover: undefined,
        error: undefined,
        offset: undefined,
      });
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
        <strong>{active.partName ?? document.components[active.componentId].name}</strong>
      </p>
      {active.partName ? (
        <p className="muted">
          Your part and its first sketch are created together when you choose a plane.
          Cancel leaves the project unchanged.
        </p>
      ) : null}
      <p>
        Click a colored origin plane or a supported planar face in the viewer.
        Hover highlights the choice. These buttons also support keyboard
        selection.
      </p>
      <label>
        <input
          type="checkbox"
          aria-label="Use offset sketch plane"
          checked={offset !== undefined}
          onChange={(event) =>
            useSketchPlanePicker.setState({
              offset: event.target.checked ? "5mm" : undefined,
              error: undefined,
            })
          }
        />
        Offset from selected plane or face
      </label>
      {offset !== undefined ? (
        <label>
          Sketch plane offset
          <input
            value={offset}
            onChange={(event) =>
              useSketchPlanePicker.setState({
                offset: event.target.value,
                error: undefined,
              })
            }
          />
        </label>
      ) : null}
      {offset !== undefined ? (
        <p className="muted">
          Pick the base plane or face. The signed offset follows its normal and
          accepts length parameters. The sketch opens aligned to the resulting
          offset plane.
        </p>
      ) : null}
      <div className="plane-choices">
        {choices.map((choice) => {
          const plane =
            typeof choice.reference === "string"
              ? spatialPlanes[choice.reference]
              : undefined;
          return (
            <button
              key={choice.id}
              aria-label={`Sketch on ${plane?.name ?? choice.label}`}
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
                    error:
                      error instanceof Error ? error.message : String(error),
                  });
                }
              }}
            >
              {plane ? (
                <>
                  <svg
                    viewBox="0 0 72 56"
                    className="plane-choice-preview"
                    aria-hidden="true"
                  >
                    <path d={plane.path} />
                    <path
                      d="M 60 45 L 60 7 M 56 12 L 60 7 L 64 12"
                      className="plane-choice-normal"
                    />
                  </svg>
                  <span>
                    <strong>{plane.name}</strong>
                    <small>
                      {choice.reference === "XY"
                        ? "Recommended for a first sketch. "
                        : ""}
                      {plane.hint}
                    </small>
                  </span>
                </>
              ) : (
                <strong>{choice.label}</strong>
              )}
            </button>
          );
        })}
      </div>
      <p role="status">
        {hover ? `Highlighted: ${hover.label}` : "Choose a plane or face."}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <details>
        <summary>Supported face details</summary>
        <p className="muted">
          Faces require a native-validated extrusion cap or straight side.
          Retained faces after Cut/Join are supported; curved, lost and split
          faces remain unavailable.
        </p>
      </details>
      <button onClick={close}>Cancel plane selection</button>
    </section>
  );
}
