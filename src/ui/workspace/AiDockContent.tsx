import { lazy, Suspense, useEffect, useRef } from "react";
import { LazyPanelBoundary } from "../design-system/LazyPanelBoundary";

const AiDrawer = lazy(() => import("../panels/AiDrawer").then(module => ({ default: module.AiDrawer })));

function DockContent({ open }: { open: boolean }) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) Array.from(content.current?.querySelectorAll<HTMLTextAreaElement>("textarea") ?? [])
      .find(input => !input.closest("[hidden]"))?.focus();
  }, [open]);
  return <div ref={content}><AiDrawer embedded /></div>;
}

/** Text and controls stay in the dock; native proposals use the modeling canvas. */
export function AiDockContent({ visible }: { visible: boolean }) {
  return <LazyPanelBoundary label="AI assistant">
    <Suspense fallback={<p role="status">Loading AI assistant…</p>}>
      <DockContent open={visible} />
    </Suspense>
  </LazyPanelBoundary>;
}
