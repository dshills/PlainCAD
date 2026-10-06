/** Keep subscriptions and snapshots aligned with the Workbench CSS breakpoint. */
export const COMPACT_QUERY = "(max-width: 1060px)";
export const compactSnapshot = () =>
  typeof window.matchMedia === "function" && window.matchMedia(COMPACT_QUERY).matches;
