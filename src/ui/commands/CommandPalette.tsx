import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { commands, CommandContext, isCommandEnabledForSnapshot, runCommand, selectCommandEnablement } from "./commandRegistry";
import { useCadStore } from "../../state/useCadStore";

export function CommandPalette({ context }: { context: CommandContext }) {
  const open = useCadStore((state) => state.paletteOpen);
  const setOpen = useCadStore((state) => state.setPaletteOpen);
  const enablement = useCadStore(useShallow(selectCommandEnablement));
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => {
      const normalizedQuery = query.toLowerCase();
      return commands.filter(
        (command) =>
          command.label.toLowerCase().includes(normalizedQuery) ||
          command.id.toLowerCase().includes(normalizedQuery) ||
          (command.description?.toLowerCase().includes(normalizedQuery) ?? false),
      );
    },
    [query],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  if (!open) return null;
  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-heading" onClick={(event) => event.stopPropagation()}>
        <h2 id="command-palette-heading">Command Palette</h2>
        <input autoFocus aria-label="Filter commands" placeholder="Run command..." value={query} onChange={(event) => setQuery(event.target.value)} />
        {filtered.length === 0 ? <p className="palette-empty">No matching commands.</p> : null}
        {filtered.map((command) => {
          const enabled = isCommandEnabledForSnapshot(command.id, enablement);
          return (
            <button
              key={command.id}
              disabled={!enabled}
              onClick={() => {
                if (!enabled) return;
                void runCommand(command.id, context);
                setOpen(false);
              }}
            >
              <strong>{command.label}</strong>
              <span className="muted"> {command.shortcut ?? command.id}</span>
              {!enabled ? <span className="muted"> Unavailable</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
