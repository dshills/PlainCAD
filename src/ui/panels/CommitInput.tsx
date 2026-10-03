import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

const DRAFT_HINT =
  "Uncommitted changes — Enter or leave field to apply; Escape cancels.";

export function CommitInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draftState, setDraftState] = useState({ source: value, text: value });
  const draft = draftState.source === value ? draftState.text : value;
  const setDraft = (text: string) => setDraftState({ source: value, text });
  // The blur guard prevents Escape from committing its pre-cancel render.
  const dirty = useRef(false);
  const draftId = useId();
  const hasDraft = draft !== value;
  // Discard externally replaced drafts so switching the value back cannot revive an old draft.
  useEffect(() => {
    setDraftState({ source: value, text: value });
    dirty.current = false;
  }, [value]);
  return (
    <span className="commit-input">
      <input
        data-dirty={hasDraft ? "true" : undefined}
        aria-describedby={hasDraft ? draftId : undefined}
        value={draft}
        onChange={(event) => {
          dirty.current = true;
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            dirty.current = false;
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
        onBlur={() => {
          const shouldCommit = dirty.current && draft !== value;
          dirty.current = false;
          setDraft(value);
          if (shouldCommit) onCommit(draft);
        }}
      />
      {hasDraft
        ? createPortal(
            <span id={draftId} hidden>
              {DRAFT_HINT}
            </span>,
            globalThis.document.body,
          )
        : null}
      {hasDraft ? (
        <span
          className="commit-input-draft"
          aria-hidden="true"
          data-hint={DRAFT_HINT}
        />
      ) : null}
    </span>
  );
}
