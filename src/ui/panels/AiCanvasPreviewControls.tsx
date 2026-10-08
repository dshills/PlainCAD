import { useAiCanvasPreview } from "../../state/aiCanvasPreview";

/** The comparison swaps native geometry in the existing viewport. */
export function AiCanvasPreviewControls() {
  const preview = useAiCanvasPreview(state => state.preview);
  const mode = useAiCanvasPreview(state => state.mode);
  const setMode = useAiCanvasPreview(state => state.setMode);
  if (!preview) return null;
  return <div role="group" aria-label="AI model comparison" className="ai-actions">
    <button type="button" aria-pressed={mode === "before"} onClick={() => setMode("before")}>Before model</button>
    <button type="button" aria-pressed={mode === "after"} onClick={() => setMode("after")}>After model</button>
    <span>Proposed geometry is highlighted in the canvas. Apply keeps the change.</span>
  </div>;
}
