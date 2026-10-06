import { useSyncExternalStore } from "react";
import { COMPACT_QUERY, compactSnapshot } from "../../state/workbenchViewport";

function subscribe(listener: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(COMPACT_QUERY);
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }
  media.addListener(listener);
  return () => media.removeListener(listener);
}
/** Mirrors the Workbench CSS breakpoint for truthful dock toggle semantics. */
export function useCompactWorkbench() {
  return useSyncExternalStore(subscribe, compactSnapshot, () => false);
}
