import { bodyComponentId } from "../../cad/document/components";
import { bodyDisplayNames } from "../../cad/document/bodyDisplayNames";
import { useCadStore } from "../../state/useCadStore";
import { useViewerState } from "../../state/viewerState";
import {
  runCommand,
  selectCommandEnablement,
} from "../commands/commandRegistry";

export function BodyPanel({
  componentId,
  controls = true,
  compact = false,
}: {
  componentId?: string;
  controls?: boolean;
  compact?: boolean;
}) {
  const session = useCadStore((s) => s.documentSession);
  const document = useCadStore((s) => s.history.present);
  const documentId = document.id;
  const rebuild = useCadStore((s) => s.rebuild);
  const selection = useCadStore((s) => s.selection.selectedIds[0]);
  const exportSelected = useCadStore(
    (s) => selectCommandEnablement(s).exportSelectedBody,
  );
  const view = useViewerState();
  const bodies =
    rebuild.result?.documentId === documentId
      ? rebuild.result.bodies.filter(
          (body) =>
            !componentId || bodyComponentId(document, body.id) === componentId,
        )
      : [];
  const hidden = view.session === session ? view.hiddenBodyIds : [];
  const names = bodyDisplayNames(document, rebuild.result?.bodies ?? []);
  return (
    <>
      <div className="browser-folder">
        <span className="folder-label">Bodies</span>
        <span className="muted">{bodies.length} {bodies.length === 1 ? "body" : "bodies"}</span>
      </div>
      {bodies.map((body) => {
        const componentHidden =
          view.session === session &&
          view.hiddenComponentIds.includes(
            bodyComponentId(document, body.id) ?? "",
          );
        return (
          <div className="body-row" key={body.id}>
            <button
              className={`item-card ${selection?.kind === "body" && selection.id === body.id ? "selected" : ""}`}
              onClick={() =>
                useCadStore
                  .getState()
                  .select({ kind: "body", id: body.id, documentId })
              }
            >
              <strong>{names[body.id]}</strong>
            </button>
            <label>
              <input
                type="checkbox"
                aria-label={`Show body ${names[body.id]}`}
                checked={!componentHidden && !hidden.includes(body.id)}
                disabled={componentHidden}
                title={
                  componentHidden
                    ? "Show the component to change body visibility."
                    : undefined
                }
                onChange={() =>
                  view.toggleBody(
                    session,
                    body.id,
                    rebuild.result?.bodies.map((body) => body.id) ?? [],
                  )
                }
              />
              <span className={compact ? "sr-only" : undefined}>Visible</span>
            </label>
          </div>
        );
      })}
      {bodies.length && controls ? (
        <details className="body-actions" open={!compact}>
          <summary>Body actions</summary>
          <button onClick={() => void runCommand("view.showAllBodies")}>
            Show all bodies
          </button>
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
        </details>
      ) : null}
    </>
  );
}
