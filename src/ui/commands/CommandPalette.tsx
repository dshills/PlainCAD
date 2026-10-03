import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  commands,
  CommandContext,
  isCommandEnabledForSnapshot,
  runCommand,
  selectCommandEnablement,
} from "./commandRegistry";
import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";

export function CommandPalette({ context }: { context: CommandContext }) {
  const open = useCadStore((state) => state.paletteOpen);
  const setOpen = useCadStore((state) => state.setPaletteOpen);
  const enablement = useCadStore(useShallow(selectCommandEnablement));
  const filterRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(normalizedQuery) ||
        command.id.toLowerCase().includes(normalizedQuery) ||
        (command.description?.toLowerCase().includes(normalizedQuery) ?? false),
    );
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.querySelector("dialog[open]")) return;
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  if (!open) return null;
  const execute = (id: string) => {
    // Close the native dialog before commands open their own modal or file chooser.
    filterRef.current?.closest("dialog")?.close();
    setOpen(false);
    void runCommand(id, context);
  };
  const enabledCommands = filtered.filter((command) =>
    isCommandEnabledForSnapshot(command.id, enablement),
  );
  return (
    <ModalDialog
      className="palette"
      dismissOnBackdrop
      label="Command Palette"
      onDismiss={() => setOpen(false)}
    >
      <h2>Command Palette</h2>
      <input
        ref={filterRef}
        autoFocus
        aria-label="Filter commands"
        placeholder="Run command..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            if (enabledCommands[0]) execute(enabledCommands[0].id);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const buttons = event.currentTarget
              .closest("dialog")
              ?.querySelectorAll<HTMLButtonElement>(
                "button[data-command]:not(:disabled)",
              );
            const index =
              event.key === "ArrowDown" ? 0 : (buttons?.length ?? 0) - 1;
            buttons?.[index]?.focus();
          }
        }}
      />
      <p className="palette-help">
        Enter runs the first available result. Arrow keys browse commands;
        Escape closes.
      </p>
      {filtered.length === 0 ? (
        <p className="palette-empty" role="status">
          No matching commands.
        </p>
      ) : null}
      {filtered.length > 0 && enabledCommands.length === 0 ? (
        <p className="palette-empty" role="status">
          No available commands. Select the required geometry or finish the
          current rebuild.
        </p>
      ) : null}
      {filtered.map((command) => {
        const enabled = isCommandEnabledForSnapshot(command.id, enablement);
        return (
          <button
            key={command.id}
            data-command={command.id}
            disabled={!enabled}
            onClick={() => execute(command.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const buttons = Array.from(
                event.currentTarget
                  .closest("dialog")!
                  .querySelectorAll<HTMLButtonElement>(
                    "button[data-command]:not(:disabled)",
                  ),
              );
              const index =
                buttons.indexOf(event.currentTarget) +
                (event.key === "ArrowDown" ? 1 : -1);
              if (index < 0 || index >= buttons.length)
                filterRef.current?.focus();
              else buttons[index].focus();
            }}
          >
            <strong>{command.label}</strong>
            <span className="muted"> {command.shortcut ?? command.id}</span>
            {!enabled ? <span className="muted"> Unavailable</span> : null}
          </button>
        );
      })}
      <button onClick={() => setOpen(false)}>Close command palette</button>
    </ModalDialog>
  );
}
