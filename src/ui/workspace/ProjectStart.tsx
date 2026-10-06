import { useCadStore } from "../../state/useCadStore";
import { useProjectWorkflow } from "../commands/projectWorkflowCommand";
import { useEffect, useState } from "react";
import type { CommandContext } from "../commands/commandRegistry";
import { runCommand } from "../commands/commandRegistry";
import "./projectStart.css";
import { useCommandEnablement } from "../commands/useCommandEnablement";

export function ProjectStart({ context }: { context: CommandContext }) {
  const enabled = useCommandEnablement();
  const [name, setName] = useState(() => {
    const saved = useProjectWorkflow.getState().startName;
    const state = useCadStore.getState();
    return saved?.documentId === state.history.present.id &&
      saved.session === state.documentSession
      ? saved.name
      : "Part 1";
  });
  const session = useCadStore((state) => state.documentSession);
  const documentId = useCadStore((state) => state.history.present.id);
  useEffect(() => {
    const saved = useProjectWorkflow.getState().startName;
    setName(
      saved?.documentId === documentId && saved.session === session
        ? saved.name
        : "Part 1",
    );
  }, [session, documentId]);
  const [error, setError] = useState<string>();
  const validName = Boolean(name.trim()) && name.trim().length <= 120;
  async function start(command: string) {
    try {
      setError(undefined);
      const state = useCadStore.getState();
      useProjectWorkflow.setState({
        startName: {
          name,
          documentId: state.history.present.id,
          session: state.documentSession,
        },
      });
      await runCommand(command, { ...context, componentName: name });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  return (
    <section className="project-start" aria-label="Start a part">
      <h1>What would you like to make?</h1>
      <p>Draw a shape, describe a part, or start from an example.</p>
      <label className="project-start-name">
        Part name
        <input
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p className="muted">
        We organize your part and sketches inside this project for you.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="project-start-actions">
        <button
          type="button"
          disabled={!enabled.newComponent || !validName}
          onClick={() => void start("project.startDrawing")}
        >
          Draw a shape
        </button>
        <button
          type="button"
          disabled={!enabled.newComponent || !validName}
          onClick={() => void start("project.startDescribing")}
        >
          Describe a part with AI
        </button>
        <details>
          <summary>Start from example</summary>
          <button
            type="button"
            aria-label="Load mounting plate template"
            onClick={() =>
              void runCommand("template.createMountingPlate", context)
            }
          >
            Mounting plate
          </button>
          <button
            type="button"
            aria-label="Load parametric box template"
            onClick={() => void runCommand("template.createBox", context)}
          >
            Parametric box
          </button>
        </details>
        <button
          type="button"
          onClick={() => void runCommand("file.openProject", context)}
        >
          Open an existing project
        </button>
      </div>
      <p className="muted">
        AI is optional. Your editable project stays local.
      </p>
    </section>
  );
}
