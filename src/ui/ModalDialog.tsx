import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native modal semantics keep background controls inert and trap keyboard focus. */
export function ModalDialog({
  children,
  label,
  className,
  onDismiss,
  dismissOnBackdrop = false,
}: {
  children: ReactNode;
  label: string;
  className: string;
  onDismiss: () => void;
  dismissOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Capture before descendant autoFocus runs during the commit.
  const [previous] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      // A command can open another modal as this one unmounts.
      if (!document.querySelector("dialog[open]") && previous?.isConnected)
        previous.focus();
    };
  }, [previous]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      tabIndex={-1}
      onClick={(event) => {
        if (!dismissOnBackdrop || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onDismiss();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const dialog = event.currentTarget;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button, input, select, textarea, a[href], [tabindex]",
          ),
        ).filter(
          (node) =>
            node.tabIndex >= 0 &&
            !node.matches(":disabled") &&
            node.getClientRects().length > 0,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (
          !first ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
          if (!first) dialog.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      {children}
    </dialog>
  );
}
