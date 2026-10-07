import { ModalDialog } from "../ModalDialog";
import { useEffect, useState } from "react";
import {
  useFileJobs,
  runFabrication,
  downloadPrepared,
  type FileJobState,
} from "../../persistence/fileJobs";
import { useCadStore } from "../../state/useCadStore";
import { hiddenViewerBodies, useViewerState } from "../../state/viewerState";
import { canExportStl, runCommand } from "../commands/commandRegistry";
import {
  guidedExportCurrent,
  useGuidedExport,
  type GuidedExportTask,
} from "../commands/guidedExportCommand";
import { bodyDisplayNames } from "../../cad/document/bodyDisplayNames";
import { exportDiagnostic } from "../../fabrication/exportDiagnostic";
import type { StlMode } from "../../fabrication/exportPlan";
import "./FabricationPanel.css";

export function FabricationPanel() {
  const jobs = useFileJobs();
  const task = useGuidedExport((state) => state.task);
  const session = useCadStore((state) => state.documentSession);
  const result = useCadStore((state) => state.rebuild.result);
  const available = useCadStore((state) => canExportStl(state));
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
  return (
    <>
      {jobs.busy ? (
        <div className="kernel-banner file-job-status" role="status">
          <span>{jobs.message}</span>
          <button onClick={jobs.cancel}>Cancel file operation</button>
        </div>
      ) : null}
      {jobs.exportOpen ? (
        <ExportDialog
          key={task?.id ?? `stl:${jobs.exportSession}`}
          jobs={jobs}
          task={task}
        />
      ) : null}
    </>
  );
}
function ExportDialog({
  jobs,
  task,
}: {
  jobs: FileJobState;
  task?: GuidedExportTask;
}) {
  const cadDocument = useCadStore((state) => state.history.present),
    session = useCadStore((state) => state.documentSession),
    result = useCadStore((state) => state.rebuild.result),
    available = useCadStore((state) => canExportStl(state)),
    selection = useCadStore((state) => state.selection.selectedIds[0]),
    fileError = useCadStore((state) => state.fileError);
  const [goal, setGoal] = useState<"project" | "stl">(task ? "project" : "stl"),
    [mode, setMode] = useState<StlMode>("separate"),
    [full, setFull] = useState(true),
    [advanced, setAdvanced] = useState(!task),
    [saving, setSaving] = useState(false);
  const sameProject = jobs.exportSession === session,
    changed = Boolean(task && !guidedExportCurrent(task)),
    bodies = sameProject ? (result?.bodies ?? []) : [],
    selected = jobs.exportBodyIds ?? [],
    lost = sameProject
      ? selected.filter((id) => !bodies.some((body) => body.id === id))
      : [],
    selectedBody =
      selection?.kind === "body" &&
      selection.documentId === cadDocument.id &&
      bodies.some((body) => body.id === selection.id)
        ? selection.id
        : undefined,
    selectedMeshes = sameProject
      ? result?.meshes.filter((mesh) => selected.includes(mesh.bodyId)) ?? []
      : [],
    triangleCount = selectedMeshes.reduce(
      (sum, mesh) => sum + mesh.indices.length / 3,
      0,
    ),
    busy = jobs.busy || saving,
    diagnostic = fileError
      ? exportDiagnostic(fileError, cadDocument, result)
      : undefined,
    diagnosticFeatureId = diagnostic?.featureId;
  const clearPrepared = () =>
    useFileJobs.setState({ prepared: undefined, preparedFor: undefined });
  const names = bodyDisplayNames(cadDocument, bodies);
  const setBodies = (ids: string[]) => {
    clearPrepared();
    useFileJobs.setState({ exportBodyIds: ids });
  };
  const close = () => {
    if (saving) return;
    jobs.cancel();
    useFileJobs.setState({ exportOpen: false });
  };
  const chooseGoal = (next: "project" | "stl") => {
    clearPrepared();
    useCadStore.getState().setFileError(undefined);
    setGoal(next);
  };
  const saveProject = async () => {
    if (busy || !sameProject || changed) return;
    // Use the same save command as the quick toolbar action. A replacement
    // while its recovery marker is being written cannot be reported as saved.
    const before = useCadStore.getState(),
      savedDocument = before.history.present,
      savedSession = before.documentSession;
    setSaving(true);
    before.setFileError(undefined);
    try {
      await runCommand("file.saveProject");
      const current = useCadStore.getState();
      if (
        current.history.present !== savedDocument ||
        current.documentSession !== savedSession
      )
        current.setFileError(
          "Project changed while saving. Save the current editable project again.",
        );
      else if (!current.fileError) useFileJobs.setState({ exportOpen: false });
    } catch (error) {
      before.setFileError(
        error instanceof Error
          ? error.message
          : "Editable project could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalDialog
      className="file-dialog fabrication-dialog"
      label={task ? "Save or export" : "STL export options"}
      onDismiss={close}
    >
      <h2>{task ? "Save or export" : "Export STL"}</h2>
      <div className="fabrication-dialog-content">
        <fieldset disabled={busy}>
          <legend>What do you need?</legend>
          <div className="file-goal-options">
            <label>
              <input
                type="radio"
                name="file-goal"
                value="project"
                checked={goal === "project"}
                onChange={() => chooseGoal("project")}
              />{" "}
              Save editable project (.pcaddoc)
              <small>
                Keep sketches, dimensions, parameters and feature history.
              </small>
            </label>
            <label>
              <input
                type="radio"
                name="file-goal"
                value="stl"
                checked={goal === "stl"}
                onChange={() => chooseGoal("stl")}
              />{" "}
              Export for printing (.stl)
              <small>A mesh for slicers and fabrication tools.</small>
            </label>
          </div>
        </fieldset>
        {!sameProject ? (
          <p role="alert">Project replaced. Close and reopen this file task.</p>
        ) : changed ? (
          <p role="alert">
            Project changed. Close and reopen Save or export to use the current
            model.
          </p>
        ) : null}
        {goal === "project" ? (
          <>
            <p>
              Save <strong>{cadDocument.name}</strong> as a .pcaddoc file. Open it
              in PlainCAD to continue editing. Saving does not require successful
              geometry.
            </p>
            {fileError ? (
              <div
                className="export-diagnostic"
                role="group"
                aria-label="Save diagnostic"
              >
                <p>{fileError}</p>
                <p>
                  Keep this project open and try saving again after resolving the
                  error.
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p>
              STL keeps the shape, but does not keep editable sketches or
              parameters. Coordinates remain in millimeters in the global model
              frame.
            </p>
            <fieldset disabled={busy || !sameProject || changed}>
              <legend>Export bodies ({selected.length} selected)</legend>
              <p>
                Only marked bodies will be exported. Visibility does not change
                export selection.
              </p>
              <div className="export-bodies">
                {bodies.map((body) => {
                  return (
                    <label key={body.id}>
                      <input
                        type="checkbox"
                        aria-label={`Export body ${names[body.id]}`}
                        checked={selected.includes(body.id)}
                        onChange={(event) =>
                          setBodies(
                            event.target.checked
                              ? [...selected, body.id]
                              : selected.filter((id) => id !== body.id),
                          )
                        }
                      />
                      {names[body.id]}
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setBodies(bodies.map((body) => body.id))}
              >
                Select all bodies
              </button>
              <button
                type="button"
                disabled={!selectedBody}
                onClick={() => selectedBody && setBodies([selectedBody])}
              >
                Use selected body
              </button>
              <button
                type="button"
                onClick={() => {
                  const hidden = hiddenViewerBodies(
                    cadDocument,
                    bodies.map((body) => body.id),
                    session,
                    useViewerState.getState(),
                  );
                  setBodies(
                    bodies
                      .filter((body) => !hidden.includes(body.id))
                      .map((body) => body.id),
                  );
                }}
              >
                Select visible bodies
              </button>
              <button type="button" onClick={() => setBodies([])}>
                Clear body selection
              </button>
            </fieldset>
            {lost.length ? (
              <p role="alert">
                {lost.length} selected bodies are no longer available. Select
                export bodies again.
              </p>
            ) : null}
            {!available ? (
              <p>
                STL needs a successful rebuild of the current model. Repair its
                diagnostics or wait for rebuilding to finish, then reopen this
                task.
              </p>
            ) : null}
            <div
              className="export-workflow-summary"
              role="group"
              aria-label="STL output summary"
            >
              <strong>
                {selected.length} {selected.length === 1 ? "body" : "bodies"}{" "}
                selected · {triangleCount.toLocaleString()} input triangles
              </strong>
              <p>{describeStlOutput(mode, selected.length)}</p>
            </div>
            <label>
              Output files
              <select
                aria-label="Output files"
                value={mode}
                disabled={busy || !sameProject || changed}
                onChange={(event) => {
                  setMode(event.target.value as StlMode);
                  clearPrepared();
                }}
              >
                <option value="separate">One file per part (ZIP for multiple parts)</option>
                <option value="shells">One file containing all parts (separate shells)</option>
                <option value="merged">Combine parts with native union</option>
              </select>
            </label>
            <details
              className="export-advanced"
              open={advanced}
              onToggle={(event) => setAdvanced(event.currentTarget.open)}
            >
              <summary>Advanced STL options</summary>
              <label>
                <input
                  type="checkbox"
                  checked={full || mode === "merged"}
                  disabled={busy || mode === "merged" || !sameProject || changed}
                  onChange={(event) => {
                    setFull(event.target.checked);
                    clearPrepared();
                  }}
                />
                {mode === "separate"
                  ? "Check each part for self-intersections"
                  : mode === "shells"
                    ? "Check self-intersections and overlaps between parts"
                    : "Check the union for self-intersections"}
              </label>
              <p>
                Topology, winding, and float32 coordinates are always checked.{" "}
                {mode === "separate"
                  ? "Each part is checked independently; overlaps between separate files are not checked."
                  : mode === "shells"
                    ? "With this option enabled, overlaps and containment between parts are checked before download."
                    : "Native union requires full validation; disconnected solids produce a warning. Union is best-effort and failures preserve your model."}
              </p>
            </details>
            {diagnostic ? (
              <div
                className="export-diagnostic"
                role="group"
                aria-label="Export diagnostic"
                aria-live="polite"
              >
                <p>
                  {diagnostic.bodyName ? `${diagnostic.bodyName}: ` : ""}
                  {diagnostic.message}
                </p>
                <p>{diagnostic.advice}</p>
                {diagnosticFeatureId ? (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      useCadStore.getState().select({
                        kind: "feature",
                        id: diagnosticFeatureId,
                        documentId: cadDocument.id,
                      });
                    }}
                  >
                    Inspect {diagnostic.featureName}
                  </button>
                ) : null}
              </div>
            ) : null}
            {jobs.prepared ? (
              <>
                <p>
                  {jobs.prepared.triangleCount.toLocaleString()} triangles
                  validated. Review these warnings before downloading:
                </p>
                <ul>
                  {jobs.prepared.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                {mode !== "separate" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMode("separate");
                      clearPrepared();
                    }}
                  >
                    Use separate files instead
                  </button>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
      <footer className="fabrication-dialog-actions">
        {goal === "project" ? (
          <button
            type="button"
            disabled={busy || !sameProject || changed}
            onClick={() => void saveProject()}
          >
            Save editable project
          </button>
        ) : jobs.prepared ? (
          <button
            type="button"
            disabled={
              busy || !sameProject || changed || !available || lost.length > 0
            }
            onClick={() => downloadPrepared(jobs.prepared!)}
          >
            Download with warnings
          </button>
        ) : (
          <button
            type="button"
            disabled={
              busy ||
              !available ||
              !sameProject ||
              changed ||
              !selected.length ||
              lost.length > 0
            }
            onClick={() =>
              void runFabrication(
                mode,
                full || mode === "merged",
                selected,
                jobs.exportSession,
              )
            }
          >
            Generate STL
          </button>
        )}
        <button type="button" disabled={saving} onClick={close}>
          {goal === "project" ? "Cancel save" : "Cancel export"}
        </button>
      </footer>
    </ModalDialog>
  );
}

function describeStlOutput(mode: StlMode, count: number) {
  if (count === 0) return "Select at least one body to export.";
  if (mode === "separate")
    return count > 1
      ? "Download a ZIP with one STL per selected body. Each part keeps its world position."
      : "Download one STL for the marked body.";
  if (mode === "shells")
    return "Download one STL containing the marked bodies as separate shells. Overlaps require review.";
  return "Attempt a native union of the marked bodies, then download one validated STL. Separate bodies may remain disconnected.";
}
