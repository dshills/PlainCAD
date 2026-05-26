import { useEffect, useMemo, useState } from "react";
import { commands, CommandContext, runCommand } from "./commandRegistry";
import { useCadStore } from "../../state/useCadStore";

export function CommandPalette({ context }: { context: CommandContext }) {
  const open = useCadStore((state) => state.paletteOpen);
  const setOpen = useCadStore((state) => state.setPaletteOpen);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => commands.filter((command) => command.label.toLowerCase().includes(query.toLowerCase()) || command.id.includes(query.toLowerCase())),
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
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
        <input autoFocus placeholder="Run command..." value={query} onChange={(event) => setQuery(event.target.value)} />
        {filtered.map((command) => (
          <button
            key={command.id}
            disabled={!command.enabled()}
            onClick={() => {
              void runCommand(command.id, context);
              setOpen(false);
            }}
          >
            <strong>{command.label}</strong>
            <span className="muted"> {command.shortcut ?? command.id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
