import { useCadStore } from "../../state/useCadStore";
import { useProjectWorkflow } from "../commands/projectWorkflowCommand";
import { useEffect, useRef, useState } from "react";
import type { CommandContext } from "../commands/commandRegistry";
import { runCommand } from "../commands/commandRegistry";
import "./projectStart.css";
import { useCommandEnablement } from "../commands/useCommandEnablement";

export function ProjectStart({ context }: { context: CommandContext }) {
  const enabled = useCommandEnablement();
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
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
    setOpen(false);
    setError(undefined);
    const saved = useProjectWorkflow.getState().startName;
    setName(
      saved?.documentId === documentId && saved.session === session
        ? saved.name
        : "Part 1",
    );
  }, [session, documentId]);
  useEffect(() => {
    const closeOutside = (event: Event) => {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) {
        setOpen(false);
      }
    };
    window.document.addEventListener("pointerdown", closeOutside);
    window.document.addEventListener("focusin", closeOutside);
    return () => {
      window.document.removeEventListener("pointerdown", closeOutside);
      window.document.removeEventListener("focusin", closeOutside);
    };
  }, []);
  const validName = Boolean(name.trim()) && name.trim().length <= 120;
  async function start(command: string, named = false) {
    try {
      setError(undefined);
      const state = useCadStore.getState();
      if (named) useProjectWorkflow.setState({
        startName: {
          name,
          documentId: state.history.present.id,
          session: state.documentSession,
        },
      });
      await runCommand(command, named ? { ...context, componentName: name } : context);
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  return (
    <details className="new-part-menu" ref={menu} open={open} onKeyDown={(event) => {
      if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        menu.current?.querySelector("summary")?.focus();
      }
    }}>
      <summary onClick={(event) => { event.preventDefault(); setOpen((current) => !current); }}>New part</summary>
      <section className="new-part-options" aria-label="Start a part" hidden={!open}>
      <label className="project-start-name">
        Part name
        <input
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="project-start-actions">
        <button
          type="button"
          disabled={!enabled.newComponent || !validName}
          onClick={() => void start("project.startDrawing", true)}
        >
          Draw a shape
        </button>
        <button
          type="button"
          disabled={!enabled.newComponent || !validName}
          onClick={() => void start("project.startDescribing", true)}
        >
          Describe a part with AI
        </button>
        <details>
          <summary>Start from example</summary>
          <button type="button" disabled={!enabled.outsideGuidedHole} onClick={() => void start("file.projectGallery")}>Browse project gallery</button>
          <button
            type="button"
            aria-label="Load mounting plate template"
            disabled={!enabled.outsideGuidedHole}
            onClick={() => void start("template.createMountingPlate")}
          >
            Mounting plate
          </button>
          <button
            type="button"
            aria-label="Load parametric box template"
            disabled={!enabled.outsideGuidedHole}
            onClick={() => void start("template.createBox")}
          >
            Parametric box
          </button>
        </details>
        <button type="button" disabled={!enabled.partLibrary} onClick={() => void start("partLibrary")}>Local part library</button>
        <button type="button" disabled={!enabled.insertProject} onClick={() => void start("file.insertProject")}>Insert a reusable part</button>
        <button
          type="button"
          disabled={!enabled.outsideGuidedHole}
          onClick={() => void start("file.openProject")}
        >
          Open an existing project
        </button>
      </div>
      </section>
    </details>
  );
}
