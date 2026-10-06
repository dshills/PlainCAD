import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWorkspaceState } from "../state/useWorkspaceState";

function sameModalTabStop(active: Element | null, stop?: HTMLElement) {
  return (
    active === stop ||
    (active instanceof HTMLInputElement &&
      stop instanceof HTMLInputElement &&
      active.type === "radio" &&
      stop.type === "radio" &&
      Boolean(active.name) &&
      active.name === stop.name &&
      active.form === stop.form)
  );
}

function modalTabStops(dialog: HTMLDialogElement, backward: boolean) {
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, summary, a[href], [tabindex]",
    ),
  ).filter(
    (node) =>
      node.tabIndex >= 0 &&
      !node.matches(":disabled") &&
      node.getClientRects().length > 0,
  );
  // A named radio group contributes only its checked (or first enabled) radio
  // to native Tab order. Counting every radio misses the Shift+Tab boundary.
  return controls.filter((node) => {
    if (
      !(node instanceof HTMLInputElement) ||
      node.type !== "radio" ||
      !node.name
    )
      return true;
    const group = controls.filter(
      (candidate): candidate is HTMLInputElement =>
        candidate instanceof HTMLInputElement &&
        candidate.type === "radio" &&
        candidate.name === node.name &&
        candidate.form === node.form,
    );
    return (
      node ===
      (group.find((candidate) => candidate.checked) ??
        group[backward ? group.length - 1 : 0])
    );
  });
}

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
  const workbench = useWorkspaceState((state) => state.layout === "workbench");
  const docked = workbench && className.split(" ").includes("model-dialog");
  useLayoutEffect(() => {
    if (!docked) return;
    const region = document.querySelector<HTMLElement>(".viewer-region");
    const dialog = ref.current;
    if (!region || !dialog) return;
    const position = () => {
      const rect = region.getBoundingClientRect();
      dialog.style.setProperty("--task-top", `${rect.top}px`);
      dialog.style.setProperty("--task-left", `${rect.left}px`);
      dialog.style.setProperty("--task-height", `${rect.height}px`);
    };
    position();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(position);
    observer?.observe(region);
    window.addEventListener("resize", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
      for (const property of ["--task-top", "--task-left", "--task-height"])
        dialog.style.removeProperty(property);
    };
  }, [docked]);
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
      className={`${className}${docked ? " docked-model-dialog" : ""}`}
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
        const controls = modalTabStops(dialog, event.shiftKey);
        const first = controls[0],
          last = controls.at(-1);
        if (
          !first ||
          (event.shiftKey && sameModalTabStop(document.activeElement, first)) ||
          (!event.shiftKey && sameModalTabStop(document.activeElement, last))
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
