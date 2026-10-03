import { useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { useSectionState } from "../../state/sectionState";
import {
  STANDARD_VIEWS,
  MAX_NAMED_VIEWS,
  removeNamedCamera,
  type SectionAxis,
} from "../../cad/inspection/cameraViews";
import { runCommand } from "../commands/commandRegistry";
import { CommitInput } from "./CommitInput";
export function ViewPanel() {
  const session = useCadStore((s) => s.documentSession);
  return <ViewSession key={session} session={session} />;
}
function ViewSession({ session }: { session: number }) {
  const doc = useCadStore((s) => s.history.present),
    section = useSectionState();
  const [name, setName] = useState(""),
    [error, setError] = useState("");
  const axis = section.session === session ? section.axis : undefined;
  const offset = section.session === session ? section.offset : 0;
  const positive = section.session === session ? section.positive : true;
  const views = doc.viewState?.namedViews ?? [];
  return (
    <section className="panel" aria-label="View controls">
      <h2>Views</h2>
      <div className="view-presets">
        {STANDARD_VIEWS.map((view) => (
          <button key={view} onClick={() => void runCommand(`view.${view}`)}>
            {view[0].toUpperCase() + view.slice(1)}
          </button>
        ))}
      </div>
      <label>
        New view name
        <input
          aria-label="New view name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button
        disabled={!name.trim() || views.length >= MAX_NAMED_VIEWS}
        onClick={async () => {
          const count = views.length;
          await runCommand("view.saveNamed", {
            viewName: name.trim(),
            documentSession: session,
          });
          const state = useCadStore.getState();
          if (
            state.documentSession === session &&
            (state.history.present.viewState?.namedViews?.length ?? 0) > count
          )
            setName("");
        }}
      >
        Save current view
      </button>
      <div className="panel-list">
        {views.map((view) => (
          <div key={view.id} className="body-row">
            <button
              onClick={() =>
                void runCommand("view.restoreNamed", {
                  viewId: view.id,
                  documentSession: session,
                })
              }
            >
              Restore view {view.name}
            </button>
            <button
              aria-label={`Delete view ${view.name}`}
              onClick={() => {
                if (useCadStore.getState().documentSession === session)
                  useCadStore
                    .getState()
                    .updateDocument((d) => removeNamedCamera(d, view.id));
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <p className="muted">
        Named views save camera position, target and up direction. Visibility
        and section clipping remain transient.
      </p>
      <h3>Section preview</h3>
      <label>
        Section axis
        <select
          aria-label="Section axis"
          value={axis ?? "off"}
          onChange={(e) => {
            setError("");
            section.setSection(
              session,
              e.target.value === "off"
                ? undefined
                : (e.target.value as SectionAxis),
              offset,
              positive,
            );
          }}
        >
          <option value="off">Off</option>
          <option>X</option>
          <option>Y</option>
          <option>Z</option>
        </select>
      </label>
      <label>
        Section offset (mm)
        <CommitInput
          value={String(offset)}
          onCommit={(value) => {
            try {
              if (!value.trim())
                throw new Error("Enter a section offset in millimeters.");
              section.setSection(session, axis, Number(value), positive);
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          aria-label="Keep positive section side"
          checked={positive}
          disabled={!axis}
          onChange={(e) =>
            section.setSection(session, axis, offset, e.target.checked)
          }
        />
        Keep positive side
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button
        onClick={() => {
          setError("");
          void runCommand("view.clearSection");
        }}
      >
        Clear section
      </button>
      <p className="muted">
        Uncapped visual clipping in the global frame. Hidden sections cannot be
        picked. Measurements and STL export use the full model.
      </p>
    </section>
  );
}
