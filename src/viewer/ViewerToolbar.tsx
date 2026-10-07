import { runCommand } from "../ui/commands/commandRegistry";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import "./viewerControls.css";

export function ViewerToolbar({ hasGeometry }: { hasGeometry: boolean }) {
  const enabled = useCommandEnablement();
  return <div className="viewer-controls" role="group" aria-label="Viewport controls">
    <button type="button" aria-label="Fit model in viewport" disabled={!enabled.document || !hasGeometry}
      onClick={() => void runCommand("view.fit")}>Fit model</button>
  </div>;
}
