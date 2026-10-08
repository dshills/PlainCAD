import { create } from "zustand";
import { useCadStore } from "../../state/useCadStore";
import { canvasActionTargetCurrent, selectedCanvasActionTarget, type CanvasActionTarget } from "./canvasActionTarget";
import { selectedCanvasEntities, useSketchCanvas, type CanvasSession } from "./sketchCanvasCommand";
import type { CadDocument } from "../../cad/document/schema";

export type CanvasContextTarget = { kind: "body"; target: CanvasActionTarget } | {
  kind: "sketch"; document: CadDocument; session: number; active: CanvasSession;
  selection: NonNullable<ReturnType<typeof useSketchCanvas.getState>["selection"]>;
};
export const useCanvasContext = create<{ menu?: { x: number; y: number; target: CanvasContextTarget } }>(() => ({}));
export function currentCanvasContextTarget(): CanvasContextTarget | undefined {
  const state = useCadStore.getState(), canvas = useSketchCanvas.getState();
  if (selectedCanvasEntities(state) && canvas.active && canvas.selection)
    return { kind: "sketch", document: state.history.present, session: state.documentSession, active: canvas.active, selection: canvas.selection };
  const target = selectedCanvasActionTarget(state);
  return target ? { kind: "body", target } : undefined;
}
export function canvasContextCurrent(target: CanvasContextTarget): boolean {
  const state = useCadStore.getState();
  if (target.kind === "body") return canvasActionTargetCurrent(target.target, state);
  const canvas = useSketchCanvas.getState();
  return state.history.present === target.document && state.documentSession === target.session &&
    canvas.active === target.active && canvas.selection === target.selection && Boolean(selectedCanvasEntities(state));
}
export function openCanvasContext(x: number, y: number) {
  const target = currentCanvasContextTarget();
  if (target) useCanvasContext.setState({ menu: { x, y, target } });
}
