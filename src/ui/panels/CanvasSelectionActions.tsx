import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { useViewerState } from "../../state/viewerState";
import { bodyDisplayNames } from "../../cad/document/bodyDisplayNames";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { canvasContextCurrent, currentCanvasContextTarget, openCanvasContext, useCanvasContext, type CanvasContextTarget } from "../commands/canvasContextState";
import { isCommandEnabledForSnapshot, runCommand } from "../commands/commandRegistry";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import { ModalDialog } from "../ModalDialog";
import "./CanvasSelectionActions.css";

export function CanvasSelectionActions() {
  const state = useCadStore(useShallow(s => ({ history: s.history, documentSession: s.documentSession, selection: s.selection, rebuild: s.rebuild, fileBusy: s.fileBusy, setFileError: s.setFileError })));
  const canvas = useSketchCanvas(useShallow(s => ({ active: s.active, selection: s.selection })));
  const view = useViewerState(useShallow(s => ({ session: s.session, hiddenBodyIds: s.hiddenBodyIds, hiddenComponentIds: s.hiddenComponentIds })));
  const enabled = useCommandEnablement();
  const menu = useCanvasContext(s => s.menu);
  const target = useMemo(() => currentCanvasContextTarget(), [state.history.present, state.documentSession, state.selection, state.rebuild, state.fileBusy, canvas.active, canvas.selection, view]);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState<CanvasContextTarget>();
  const close = () => useCanvasContext.setState({ menu: undefined });
  const invoke = async (command: string, captured: CanvasContextTarget) => {
    close();
    if (!canvasContextCurrent(captured)) { state.setFileError("Model or selection changed. Select the current geometry again."); return; }
    try { await runCommand(command, captured.kind === "body" ? { canvasTarget: captured.target } : {}); }
    catch (error) { useCadStore.getState().setFileError(error instanceof Error ? error.message : "Canvas action failed."); }
  };
  useEffect(() => {
    if (!menu) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); if (returnFocus.current?.isConnected) returnFocus.current.focus(); };
  }, [menu]);
  useEffect(() => { if (menu && !canvasContextCurrent(menu.target)) close(); }, [menu, state, target]);
  useEffect(() => {
    if (!target || target.kind !== "sketch") return;
    const fromSketch = (event: Event) => event.target instanceof Element && Boolean(event.target.closest('svg[aria-label="Sketch drawing canvas"]'));
    const context = (event: MouseEvent) => { if (!fromSketch(event) || document.querySelector("dialog[open]")) return; event.preventDefault(); openCanvasContext(event.clientX, event.clientY); };
    const key = (event: KeyboardEvent) => { if (fromSketch(event) && !document.querySelector("dialog[open]") && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) { event.preventDefault(); const rect = (event.target as Element).closest("svg")!.getBoundingClientRect(); openCanvasContext(rect.left + 30, rect.top + 30); } };
    document.addEventListener("contextmenu", context); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("contextmenu", context); document.removeEventListener("keydown", key); };
  }, [target?.kind, canvas.active]);
  useEffect(() => () => useCanvasContext.setState({ menu: undefined }), []);
  const actions = (captured: CanvasContextTarget) => captured.kind === "body"
    ? [["canvas.editBody", "Edit base feature"], ["canvas.hideBody", "Hide part"], ["canvas.isolateBody", "Isolate part"], ["sketch.facePocket", "Draw on face"]]
    : [["sketch.offsetOutline", "Offset"], ["sketch.mirror", "Mirror"], ["sketch.linearPattern", "Pattern"], ["sketch.entity.delete", "Delete selected geometry"]];
  const buttons = (captured: CanvasContextTarget, role?: "menuitem") => actions(captured).map(([id, label]) => <button key={id} type="button" role={role} disabled={!isCommandEnabledForSnapshot(id, enabled)} onClick={() => { void invoke(id, captured); }}>{label}</button>);
  const actionable = target?.kind === "sketch" ? enabled.deleteSketchEntity : enabled.canvasBodyActions;
  const label = target?.kind === "body" ? bodyDisplayNames(state.history.present, target.target.result.bodies)[target.target.bodyId] : `${useSketchCanvas.getState().selection?.entityIds.length ?? 0} sketch items`;
  return <>
    {target && actionable && <div className="canvas-selection-actions" role="toolbar" aria-label="Selected geometry actions">
      <span title={label}>{label}</span>{buttons(target)}
      <button type="button" ref={triggerRef} aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={event => { if (menu) { close(); return; } const rect = event.currentTarget.getBoundingClientRect(); openCanvasContext(rect.left, rect.bottom + 4); }}>More actions</button>
    </div>}
    {menu && canvasContextCurrent(menu.target) && <div className="canvas-context-menu" role="menu" aria-label="Canvas actions" ref={menuRef}
      style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 235)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 300)) }}
      onKeyDown={event => {
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []), index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
        if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); close(); }
      }}>
      {buttons(menu.target, "menuitem")}
      {menu.target.kind === "body" && <button type="button" role="menuitem" disabled={!enabled.canvasDeleteBase} onClick={() => { setDeleting(menu.target); close(); }}>Delete base feature…</button>}
      <button type="button" role="menuitem" onClick={close}>Close menu</button>
    </div>}
    {deleting && <ModalDialog label="Delete base feature" className="canvas-delete-dialog" onDismiss={() => setDeleting(undefined)}>
      <h2>Delete the part’s base feature?</h2><p>The source sketch stays editable. Features that depend on this part may need repair. Undo restores the feature.</p>
      <button type="button" onClick={() => setDeleting(undefined)}>Cancel</button>
      <button type="button" disabled={!canvasContextCurrent(deleting) || !enabled.canvasDeleteBase} onClick={() => { setDeleting(undefined); void invoke("canvas.deleteBody", deleting); }}>Delete base feature</button>
    </ModalDialog>}
  </>;
}
