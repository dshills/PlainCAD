import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useCadStore } from "../../state/useCadStore";
import { runCommand } from "../commands/commandRegistry";
import {
  cancelProjectDrop,
  isCurrentProjectDrop,
  projectDropBlockedReason,
  useProjectDrop,
} from "../commands/projectDropCommand";
import { ModalDialog } from "../ModalDialog";
import "./ProjectFileDrop.css";

function fileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/** A file-open gesture uses the same bounded import pipeline as the file picker. */
export function ProjectFileDrop({ children }: { children: ReactNode }) {
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const saving = useProjectDrop((s) => s.saving);
  const [feedback, setFeedback] = useState<string>();
  const pending = useProjectDrop((s) => s.pending);
  const current = useCadStore((state) =>
    Boolean(pending && isCurrentProjectDrop(pending, state)),
  );
  useEffect(() => {
    const clear = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragend", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);
  const blockedReason = () =>
    projectDropBlockedReason() ??
    (window.document.querySelector("dialog[open]")
      ? "Close the current dialog before opening a dropped project."
      : undefined);
  return (
    <div
      className="project-file-drop"
      onDragEnter={(event) => {
        if (fileDrag(event)) dragDepth.current += 1;
      }}
      onDragOver={(event) => {
        if (!fileDrag(event)) return;
        event.preventDefault();
        const blocked = blockedReason();
        setFeedback(blocked);
        event.dataTransfer.dropEffect = blocked ? "none" : "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!fileDrag(event)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (
          dragDepth.current === 0 &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          setDragging(false);
      }}
      onDrop={async (event) => {
        if (!fileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        const blocked = blockedReason();
        if (blocked) {
          useCadStore.getState().setFileError(blocked);
          return;
        }
        if (files.length !== 1) {
          useCadStore
            .getState()
            .setFileError(
              "Drop exactly one .pcaddoc or .json project file at a time.",
            );
          return;
        }
        try {
          await runCommand("file.dropProject", { file: files[0] });
        } catch (error) {
          useCadStore
            .getState()
            .setFileError(
              error instanceof Error
                ? error.message
                : "Dropped project could not be opened.",
            );
        }
      }}
    >
      {children}
      {dragging ? (
        <div className="project-drop-feedback" role="status">
          <strong>{feedback ?? "Drop to open project"}</strong>
          <span>
            One .pcaddoc or .json file. Open replaces the current project.
          </span>
        </div>
      ) : null}
      {pending ? (
        <ModalDialog
          label="Open dropped project"
          className="project-drop-dialog"
          onDismiss={() => {
            if (!saving) cancelProjectDrop();
          }}
        >
          <h2>Open {pending.document.name}?</h2>
          <p>
            {pending.filename} has been validated. Opening it replaces{" "}
            <strong>{pending.previous.name}</strong> and its undo history.
          </p>
          <p>
            Save the current project first to keep a portable editable copy.
            Local autosave is recovery only.
          </p>
          {!current && !saving ? (
            <p role="alert">
              The current project changed. Keep it and drop the file again.
            </p>
          ) : null}
          <div className="project-drop-actions">
            <button
              type="button"
              autoFocus
              disabled={saving}
              onClick={cancelProjectDrop}
            >
              Keep current project
            </button>
            <button
              type="button"
              disabled={!current || saving}
              onClick={async () => {
                try {
                  await runCommand("file.saveAndReplaceDroppedProject");
                } catch (error) {
                  useCadStore
                    .getState()
                    .setFileError(
                      error instanceof Error
                        ? error.message
                        : "Project could not be saved and opened.",
                    );
                }
              }}
            >
              {saving ? "Saving…" : "Save current and open"}
            </button>
            <button
              type="button"
              disabled={!current || saving}
              onClick={async () => {
                try {
                  await runCommand("file.replaceDroppedProject");
                } catch (error) {
                  useCadStore
                    .getState()
                    .setFileError(
                      error instanceof Error
                        ? error.message
                        : "Dropped project could not be opened.",
                    );
                }
              }}
            >
              Replace without saving
            </button>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}
