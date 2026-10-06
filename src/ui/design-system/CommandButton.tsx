import type { ComponentType } from "react";
import { useCadStore } from "../../state/useCadStore";
import {
  isCommandEnabledForSnapshot,
  runCommand,
  type CommandContext,
} from "../commands/commandRegistry";
import { useCommandEnablement } from "../commands/useCommandEnablement";

export function CommandButton({
  command,
  label,
  accessibleLabel = label,
  title = label,
  icon: Icon,
  context,
  primary = false,
}: {
  command: string;
  label: string;
  accessibleLabel?: string;
  title?: string;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  context?: CommandContext;
  primary?: boolean;
}) {
  const enablement = useCommandEnablement();
  return (
    <button
      type="button"
      className={`ds-command${primary ? " ds-primary" : ""}`}
      aria-label={accessibleLabel}
      title={title}
      disabled={!isCommandEnabledForSnapshot(command, enablement)}
      onClick={async () => {
        try {
          await runCommand(command, context);
        } catch (error) {
          useCadStore
            .getState()
            .setFileError(
              `Command failed: ${accessibleLabel}. ${error instanceof Error ? error.message : "Please try again."}`,
            );
        }
      }}
    >
      {Icon ? <Icon size={18} aria-hidden={true} /> : null}
      {label}
    </button>
  );
}
