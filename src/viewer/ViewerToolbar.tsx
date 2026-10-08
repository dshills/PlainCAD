import { lazy, Suspense } from "react";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";
import { runCommand } from "../ui/commands/commandRegistry";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import "./viewerControls.css";
import { LazyPanelBoundary } from "../ui/design-system/LazyPanelBoundary";

const StudioPanel = lazy(() => import("./StudioPanel").then((module) => ({ default: module.StudioPanel })));

export function ViewerToolbar({ hasGeometry }: { hasGeometry: boolean }) {
  const enabled = useCommandEnablement();
  const session = useCadStore((state) => state.documentSession);
  const mode = useViewerState((view) => view.session === session ? view.presentationMode : "model");
  return <>
    {mode === "render" ? (
      <LazyPanelBoundary label="Photo studio" className="studio-controls">
        <Suspense fallback={null}><StudioPanel hasGeometry={hasGeometry} /></Suspense>
      </LazyPanelBoundary>
    ) : null}
    <div className="viewer-controls" role="group" aria-label="Viewport controls">
    <button type="button" aria-label="Model view" aria-pressed={mode === "model"} disabled={!enabled.document}
      onClick={() => void runCommand("view.model")}>Model</button>
    <button type="button" aria-label="Render view" aria-pressed={mode === "render"} disabled={!enabled.document}
      onClick={() => void runCommand("view.render")}>Render</button>
    <button type="button" aria-label="Fit model in viewport" disabled={!enabled.document || !hasGeometry}
      onClick={() => void runCommand("view.fit")}>Fit model</button>
  </div></>;
}
