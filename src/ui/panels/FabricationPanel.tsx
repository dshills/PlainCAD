import { ModalDialog } from "../ModalDialog";
import { useEffect, useState } from "react";
import {
  useFileJobs,
  runFabrication,
  downloadPrepared,
} from "../../persistence/fileJobs";
import { useCadStore } from "../../state/useCadStore";
import { useViewerState } from "../../state/viewerState";
import { canExportStl } from "../commands/commandRegistry";
import type { StlMode } from "../../fabrication/exportPlan";
export function FabricationPanel() {
  const state = useFileJobs();
  const session = useCadStore((s) => s.documentSession);
  const result = useCadStore((s) => s.rebuild.result);
  const available = useCadStore((s) => canExportStl(s));
  const view = useViewerState();
  const sameProject = state.exportSession === session;
  const bodies = sameProject ? (result?.bodies ?? []) : [];
  const selected = state.exportBodyIds ?? [];
  const lost = sameProject
    ? selected.filter((id) => !bodies.some((body) => body.id === id))
    : [];
  const clearPrepared = () =>
    useFileJobs.setState({ prepared: undefined, preparedFor: undefined });
  const setBodies = (ids: string[]) => {
    clearPrepared();
    useFileJobs.setState({ exportBodyIds: ids });
  };
  const close = () => {
    state.cancel();
    useFileJobs.setState({ exportOpen: false });
  };
  useEffect(() => {
    const prepared = useFileJobs.getState().preparedFor;
    if (
      prepared &&
      (prepared.session !== session || prepared.result !== result || !available)
    ) {
      useCadStore
        .getState()
        .setFileError(
          "Model changed after validation. Generate STL again before downloading.",
        );
      useFileJobs.setState({ prepared: undefined, preparedFor: undefined });
    }
  }, [session, result, available]);
  const [mode, setMode] = useState<StlMode>("separate"),
    [full, setFull] = useState(true);
  useEffect(() => {
    if (state.exportOpen && !useFileJobs.getState().prepared) {
      setMode("separate");
      setFull(true);
    }
  }, [state.exportOpen]);
  return (
    <>
      {state.busy ? (
        <div className="kernel-banner" role="status">
          <span>{state.message}</span>
          <button onClick={state.cancel}>Cancel file operation</button>
        </div>
      ) : null}
      {state.exportOpen ? (
        <ModalDialog
          className="file-dialog"
          label="STL export options"
          onDismiss={close}
        >
          <h2>Export STL</h2>
          <p>Coordinates remain in millimeters in the global model frame.</p>
          <fieldset disabled={state.busy || !sameProject}>
            <legend>Export bodies ({selected.length} selected)</legend>
            <p>Visibility does not change export selection.</p>
            <div className="export-bodies">
              {bodies.map((body) => (
                <label key={body.id}>
                  <input
                    type="checkbox"
                    aria-label={`Export body ${body.name}`}
                    checked={selected.includes(body.id)}
                    onChange={(event) =>
                      setBodies(
                        event.target.checked
                          ? [...selected, body.id]
                          : selected.filter((id) => id !== body.id),
                      )
                    }
                  />
                  {body.name}
                </label>
              ))}
            </div>
            <button onClick={() => setBodies(bodies.map((body) => body.id))}>
              Select all bodies
            </button>
            <button
              onClick={() =>
                setBodies(
                  bodies
                    .filter(
                      (body) =>
                        view.session !== session ||
                        !view.hiddenBodyIds.includes(body.id),
                    )
                    .map((body) => body.id),
                )
              }
            >
              Select visible bodies
            </button>
            <button onClick={() => setBodies([])}>Clear body selection</button>
          </fieldset>
          {!sameProject ? (
            <p role="alert">Project replaced. Close and reopen STL export.</p>
          ) : null}
          {lost.length ? (
            <p role="alert">
              {lost.length} selected bodies are no longer available. Select
              export bodies again.
            </p>
          ) : null}
          <label>
            STL mode
            <select
              aria-label="STL mode"
              value={mode}
              disabled={state.busy}
              onChange={(e) => {
                setMode(e.target.value as StlMode);
                useFileJobs.setState({
                  prepared: undefined,
                  preparedFor: undefined,
                });
              }}
            >
              <option value="separate">Separate files (ZIP)</option>
              <option value="shells">Single file with separate shells</option>
              <option value="merged">Native union</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={full || mode === "merged"}
              disabled={state.busy || mode === "merged"}
              onChange={(e) => {
                setFull(e.target.checked);
                useFileJobs.setState({
                  prepared: undefined,
                  preparedFor: undefined,
                });
              }}
            />
            Check self-intersections and body overlaps
          </label>
          <p>
            Topology, winding, and float32 coordinates are always checked. Union
            is best-effort; failures preserve your model.
          </p>
          {state.prepared ? (
            <>
              <ul>
                {state.prepared.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <button onClick={() => downloadPrepared(state.prepared!)}>
                Download with warnings
              </button>
            </>
          ) : (
            <button
              disabled={
                state.busy ||
                !available ||
                !sameProject ||
                !selected.length ||
                lost.length > 0
              }
              onClick={() =>
                void runFabrication(
                  mode,
                  full || mode === "merged",
                  selected,
                  state.exportSession,
                )
              }
            >
              Generate STL
            </button>
          )}
          <button onClick={close}>Close export</button>
        </ModalDialog>
      ) : null}
    </>
  );
}
