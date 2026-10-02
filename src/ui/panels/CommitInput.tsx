import { useEffect, useRef, useState } from "react";

export function CommitInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  // External changes (including undo) replace a focused draft instead of being overwritten on blur.
  useEffect(() => {
    setDraft(value);
    dirty.current = false;
  }, [value]);
  return (
    <input
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
  );
}
