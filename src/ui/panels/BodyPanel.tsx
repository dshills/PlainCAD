import { useCadStore } from "../../state/useCadStore";
import { useViewerState } from "../../state/viewerState";
import {
  runCommand,
  selectCommandEnablement,
} from "../commands/commandRegistry";

export function BodyPanel() {
  const session = useCadStore((s) => s.documentSession);
  const documentId = useCadStore((s) => s.history.present.id);
  const rebuild = useCadStore((s) => s.rebuild);
  const selection = useCadStore((s) => s.selection.selectedIds[0]);
  const exportSelected = useCadStore(
    (s) => selectCommandEnablement(s).exportSelectedBody,
  );
  const view = useViewerState();
  const bodies =
    rebuild.result?.documentId === documentId ? rebuild.result.bodies : [];
  const hidden = view.session === session ? view.hiddenBodyIds : [];
  return (
    <>
      <div className="browser-folder">
        <span className="folder-label">Bodies</span>
        <span className="muted">{bodies.length} bodies</span>
      </div>
      {bodies.map((body) => (
        <div className="body-row" key={body.id}>
          <button
            className={`item-card ${selection?.kind === "body" && selection.id === body.id ? "selected" : ""}`}
            onClick={() =>
              useCadStore
                .getState()
                .select({ kind: "body", id: body.id, documentId })
            }
          >
            <strong>{body.name}</strong>
          </button>
          <label>
            <input
              type="checkbox"
              aria-label={`Show body ${body.name}`}
              checked={!hidden.includes(body.id)}
              onChange={() =>
                view.toggleBody(
                  session,
                  body.id,
                  bodies.map((body) => body.id),
                )
              }
            />
            Visible
          </label>
        </div>
      ))}
      {bodies.length ? (
        <>
          <button onClick={() => view.showAll(session)}>Show all bodies</button>
          <button
            disabled={!exportSelected}
            onClick={() => void runCommand("file.exportSelectedBody")}
          >
            Export selected body
          </button>
          {rebuild.status !== "succeeded" ? (
            <p className="muted">
              Last available preview; export requires a successful rebuild.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
