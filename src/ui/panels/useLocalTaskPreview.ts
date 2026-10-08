import { useEffect, useLayoutEffect, useRef } from "react";

export const LOCAL_TASK_PREVIEW_DELAY_MS = 250;

/** Avoid announcing unfinished arithmetic while someone is still typing. */
export function localPreviewExpressionReady(value: string) {
  const expression = value.trim();
  if (!expression || /[+*/^,(.-]$/.test(expression)) return false;
  const opened = [...expression].filter((character) => character === "(").length;
  const closed = [...expression].filter((character) => character === ")").length;
  return closed >= opened;
}

/** Schedule only local CAD previews. Input handlers invalidate accepted proofs immediately. */
export function useLocalTaskPreview(scope: object | undefined, revision: string, enabled: boolean, preview: () => void) {
  const latest = useRef(preview);
  useLayoutEffect(() => { latest.current = preview; });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => {
    cancel();
    if (scope && enabled) timer.current = setTimeout(() => {
      timer.current = undefined;
      latest.current();
    }, LOCAL_TASK_PREVIEW_DELAY_MS);
    return cancel;
  }, [scope, revision, enabled]);
  return cancel;
}
