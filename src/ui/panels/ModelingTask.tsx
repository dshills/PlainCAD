import { useId, useState, type ReactNode } from "react";
import "./modeling-task.css";

/** Common task language; native preview ownership and Apply guards stay with each operation. */
export function ModelingTaskGuide({ action }: { action: string }) {
  return (
    <p className="modeling-task-guide">
      {action} Review the native preview, then Apply. Cancel keeps your project
      unchanged.
    </p>
  );
}

export function ModelingTaskStep({
  number,
  children,
}: {
  number: 1 | 2;
  children: ReactNode;
}) {
  return (
    <h3 className="modeling-task-step">
      <span aria-hidden="true">{number}</span> {children}
    </h3>
  );
}

export function ModelingAdvancedOptions({
  children,
  initiallyOpen = false,
  required = false,
}: {
  children: ReactNode;
  initiallyOpen?: boolean;
  required?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  return (
    <details
      className="ds-advanced modeling-task-advanced"
      open={expanded || required}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Advanced options</summary>
      {children}
    </details>
  );
}

export function ModelingTaskActions({
  applyLabel,
  cancelLabel = "Cancel",
  disabled,
  onCancel,
}: {
  applyLabel: string;
  cancelLabel?: string;
  disabled: boolean;
  onCancel: () => void;
}) {
  const hintId = useId();
  return (
    <div className="dialog-actions modeling-task-actions">
      {disabled ? (
        <span className="sr-only" id={hintId}>
          Apply waits for the latest valid native preview. Check the preview
          status for the next step.
        </span>
      ) : null}
      <button type="button" aria-label={cancelLabel} onClick={onCancel}>
        Cancel
      </button>
      <button
        type="submit"
        aria-label={applyLabel}
        disabled={disabled}
        aria-describedby={disabled ? hintId : undefined}
      >
        Apply
      </button>
    </div>
  );
}
