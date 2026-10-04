import { useSketchCanvas } from "./sketchCanvasCommand";
import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../../state/useCadStore";
import { selectCommandEnablement } from "./commandRegistry";
import { useTargetScopeCapture } from "./targetScopeCaptureCommand";

export function useCommandEnablement() {
  const canvasActive = useSketchCanvas((state) => state.active);
  const scopeBusy = useTargetScopeCapture((s) => s.busy);
  return useCadStore(
    useShallow((state) =>
      selectCommandEnablement(state, scopeBusy, Boolean(canvasActive)),
    ),
  );
}
