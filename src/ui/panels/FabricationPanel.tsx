import { useEffect, useState } from "react";
import {
  useFileJobs,
  runFabrication,
  downloadPrepared,
} from "../../persistence/fileJobs";
import type { StlMode } from "../../fabrication/exportPlan";
export function FabricationPanel() {
  const state = useFileJobs();
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
        <section
          className="file-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="STL export options"
        >
          <h2>Export STL</h2>
          <p>Coordinates remain in millimeters in the global model frame.</p>
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
              disabled={state.busy}
              onClick={() =>
                void runFabrication(mode, full || mode === "merged")
              }
            >
              Generate STL
            </button>
          )}
          <button
            onClick={() => {
              state.cancel();
              useFileJobs.setState({ exportOpen: false });
            }}
          >
            Close export
          </button>
        </section>
      ) : null}
    </>
  );
}
