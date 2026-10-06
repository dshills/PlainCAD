import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../../state/useCadStore";
import { useWorkbenchState } from "../../state/useWorkbenchState";
import { useSketchCanvas } from "../commands/sketchCanvasCommand";
import { activeComponentId } from "../commands/projectWorkflowCommand";
import { useCompactWorkbench } from "./useCompactWorkbench";
import {
  CaretRightIcon,
  FolderOpenIcon,
  SlidersHorizontalIcon,
} from "../design-system/Icons";
export function WorkbenchBreadcrumb() {
  const compact = useCompactWorkbench();
  const cadDocument = useCadStore((state) => state.history.present);
  const component = useCadStore(activeComponentId);
  const canvas = useSketchCanvas((state) => state.active);
  const session = useCadStore((state) => state.documentSession);
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const dock = useWorkbenchState(
    useShallow((state) => ({
      leftOpen: state.leftOpen,
      rightOpen: state.rightOpen,
      mobileDock: state.mobileDock,
      configure: state.configure,
      persistenceError: state.persistenceError,
    })),
  );
  const leftVisible = compact ? dock.mobileDock === "left" : dock.leftOpen;
  const rightVisible = compact ? dock.mobileDock === "right" : dock.rightOpen;
  const sketch =
    canvas?.documentId === cadDocument.id && canvas.session === session
      ? cadDocument.sketches[canvas.sketchId]
      : selection?.kind === "sketch"
      ? cadDocument.sketches[selection.id]
      : undefined;
  return (
    <div className="workbench-breadcrumb">
      <button
        type="button"
        id="workspace-parts-toggle"
        className="ds-command"
        aria-label="Parts"
        aria-expanded={leftVisible}
        aria-controls="workbench-project"
        onClick={() => {
          if (compact) useWorkbenchState.setState({ mobileDock: leftVisible ? "none" : "left" });
          else dock.configure({ leftOpen: !leftVisible });
        }}
      >
        <FolderOpenIcon size={18} aria-hidden={true} />
        <span>Project</span>
      </button>
      <nav aria-label="Project location">
        <span>{cadDocument.name}</span>
        <CaretRightIcon size={14} aria-hidden={true} />
        <strong>{cadDocument.components[component]?.name}</strong>
        {sketch ? (
          <>
            <CaretRightIcon size={14} aria-hidden={true} />
            <span>{sketch.name}</span>
          </>
        ) : null}
      </nav>
      <span className="workspace-target">
        Editing: <strong>{cadDocument.components[component]?.name}</strong>
      </span>
      <button
        type="button"
        className="ds-command"
        id="workspace-details-toggle"
        aria-label="Toggle task dock"
        aria-expanded={rightVisible}
        aria-controls="workbench-details"
        onClick={() => {
          if (compact) useWorkbenchState.setState({ mobileDock: rightVisible ? "none" : "right" });
          else dock.configure({ rightOpen: !rightVisible });
        }}
      >
        <SlidersHorizontalIcon size={18} aria-hidden={true} />
        <span>Details</span>
      </button>
      {dock.persistenceError ? (
        <span className="dock-storage-error" role="status">
          {dock.persistenceError}
        </span>
      ) : null}
    </div>
  );
}
