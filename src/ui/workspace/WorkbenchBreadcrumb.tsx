import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../../state/useCadStore";
import { useWorkbenchState } from "../../state/useWorkbenchState";
import { activeComponentId } from "../commands/projectWorkflowCommand";
import {
  CaretRightIcon,
  FolderOpenIcon,
  SlidersHorizontalIcon,
} from "../design-system/Icons";
export function WorkbenchBreadcrumb() {
  const cadDocument = useCadStore((state) => state.history.present);
  const component = useCadStore(activeComponentId);
  const selection = useCadStore((state) => state.selection.selectedIds[0]);
  const dock = useWorkbenchState(
    useShallow((state) => ({
      leftOpen: state.leftOpen,
      rightOpen: state.rightOpen,
      configure: state.configure,
      persistenceError: state.persistenceError,
    })),
  );
  const sketch =
    selection?.kind === "sketch"
      ? cadDocument.sketches[selection.id]
      : undefined;
  return (
    <div className="workbench-breadcrumb">
      <button
        type="button"
        id="workspace-parts-toggle"
        className="ds-command"
        aria-label="Parts"
        aria-expanded={dock.leftOpen}
        aria-controls="workbench-project"
        onClick={() => {
          dock.configure({ leftOpen: !dock.leftOpen });
          useWorkbenchState.setState({ mobileDock: "left" });
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
        aria-expanded={dock.rightOpen}
        aria-controls="workbench-details"
        onClick={() => {
          dock.configure({ rightOpen: !dock.rightOpen });
          useWorkbenchState.setState({ mobileDock: "right" });
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
