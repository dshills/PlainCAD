import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../state/useCadStore";
import { useViewerState, type StudioBackdrop, type StudioMaterial } from "../state/viewerState";
import { runCommand } from "../ui/commands/commandRegistry";
import { useCommandEnablement } from "../ui/commands/useCommandEnablement";
import type { StudioCommandContext } from "../ui/commands/studioCommand";
import "./studioPanel.css";

export function StudioPanel({ hasGeometry }: { hasGeometry: boolean }) {
  const frame = useCadStore(useShallow((state) => ({ session: state.documentSession, documentId: state.history.present.id, busy: state.fileBusy })));
  const appearance = useViewerState(useShallow((view) => ({ material: view.studioMaterial, backdrop: view.studioBackdrop })));
  const enabled = useCommandEnablement();
  const change = (settings: Omit<StudioCommandContext, "session" | "documentId">) =>
    void runCommand("view.studioAppearance", { studio: { session: frame.session, documentId: frame.documentId, ...settings } });
  return <aside className="studio-controls" aria-label="Product photo studio">
    <details open>
      <summary>Photo studio</summary>
      <div className="studio-options">
        <label>Finish
          <select aria-label="Studio finish" value={appearance.material} disabled={frame.busy}
            onChange={(event) => change({ material: event.target.value as StudioMaterial })}>
            <option value="original">Original part colors</option>
            <option value="metal">Metallic approximation</option>
            <option value="powder">Powder coat approximation</option>
          </select>
        </label>
        <p className="muted">Metal gives parts a neutral metallic finish. Powder coat keeps their colors.</p>
        <label>Backdrop
          <select aria-label="Studio backdrop" value={appearance.backdrop} disabled={frame.busy}
            onChange={(event) => change({ backdrop: event.target.value as StudioBackdrop })}>
            <option value="theme">Current UI theme</option>
            <option value="neutral">Neutral gray</option>
            <option value="warm">Warm paper</option>
            <option value="dark">Midnight</option>
          </select>
        </label>
        <div role="group" aria-label="Studio camera compositions" className="studio-compositions">
          {(["isometric", "top", "front", "right"] as const).map((composition) =>
            <button type="button" key={composition} disabled={frame.busy || !hasGeometry}
              onClick={() => change({ composition })}>{composition === "isometric" ? "Hero" : composition[0].toUpperCase() + composition.slice(1)}</button>)}
        </div>
        <button type="button" className="ds-primary" disabled={!enabled.exportProjectPng}
          onClick={() => void runCommand("file.exportProjectPng")}>Download studio PNG</button>
        <p className="muted">Uses your current camera, visible parts and section.</p>
      </div>
    </details>
  </aside>;
}
