import { useEffect, useMemo } from "react";
import { useFileJobs } from "../../persistence/fileJobs";
import { useShallow } from "zustand/react/shallow";
import { useCadStore } from "../../state/useCadStore";
import { useViewerState } from "../../state/viewerState";
import { showGeometryHighlight } from "../../state/useGeometryHighlight";
import { runCommand } from "../commands/commandRegistry";
import { useCommandEnablement } from "../commands/useCommandEnablement";
import {
  OPERATION_DRAG_TYPE,
  SUPPORTED_OPERATION_DROPS,
  operationDropCurrent,
  operationDropTargets,
  operationTransferValue,
  useOperationDrop,
} from "../commands/operationDropCommand";
import "./OperationDropPanel.css";
import { sketchSolidHandoffCurrent, useSketchSolidHandoff } from "../commands/sketchSolidHandoffCommand";

export function OperationDropPanel() {
  const handoff = useSketchSolidHandoff((state) => state.source);
  const fileDialogOpen = useFileJobs((state) => state.exportOpen);
  const state = useCadStore(
    useShallow((state) => ({
      history: state.history,
      documentSession: state.documentSession,
      activeComponentId: state.activeComponentId,
      rebuild: state.rebuild,
      fileBusy: state.fileBusy,
    })),
  );
  const view = useViewerState(
    useShallow((view) => ({
      session: view.session,
      hiddenBodyIds: view.hiddenBodyIds,
      hiddenComponentIds: view.hiddenComponentIds,
      hiddenSketchIds: view.hiddenSketchIds,
    })),
  );
  const { frame, hoverId, error } = useOperationDrop();
  const enablement = useCommandEnablement();
  // Target visibility and export currency are read by the shared resolver, so
  // subscribed viewer/file changes also invalidate this bounded target cache.
  const choices = useMemo(
    () =>
      SUPPORTED_OPERATION_DROPS.map((operation) => ({
        ...operation,
        targets: operationDropTargets(operation.id, state),
      })),
    [state, view, fileDialogOpen],
  );
  const targets =
    choices.find((choice) => choice.id === frame?.operation)?.targets ?? [];
  const current = Boolean(frame && operationDropCurrent(frame, state));
  useEffect(() => {
    if (!frame || !current) return;
    const hovered = targets.find((target) => target.id === hoverId);
    const focused = hovered ? [hovered] : targets;
    return showGeometryHighlight({
      document: frame.document,
      session: frame.session,
      componentId: frame.componentId,
      result: frame.result,
      source: "operation",
      bodyIds: focused.flatMap((target) =>
        target.kind === "edge" ? [target.bodyId] : [],
      ),
      ...(hovered?.kind === "profile"
        ? {
            sketchId: hovered.sketchId,
            sketchEntityIds:
              frame.result.profiles?.[hovered.sketchId]?.find(
                (profile) => profile.id === hovered.profileId,
              )?.outerLoop.entityIds ?? [],
          }
        : {}),
    });
  }, [frame, current, hoverId, targets]);
  if ((handoff && sketchSolidHandoffCurrent(handoff, state)) || (!frame && !error && !choices.some((choice) => choice.targets.length)))
    return null;
  const start = (
    operation: (typeof SUPPORTED_OPERATION_DROPS)[number]["id"],
  ) => {
    try {
      if (!frame) runCommand("feature.operationTargets", { operation });
      const active = useOperationDrop.getState().frame;
      if (
        !active ||
        active.operation !== operation ||
        !operationDropCurrent(active)
      )
        throw new Error(
          "Finish the current modeling or file task, then choose a visible supported target.",
        );
      return true;
    } catch (err) {
      useOperationDrop.setState({
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  };
  const perform = (targetId: string) => {
    try {
      runCommand("feature.operationTarget", {
        operationFrame: frame,
        operationTargetId: targetId,
      });
    } catch (err) {
      useOperationDrop.setState({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  return (
    <section className="operation-drop-panel" aria-label="Operation tools">
      <div role="toolbar" aria-label="Draggable modeling operations">
        {choices.map((operation) => (
          <button
            key={operation.id}
            type="button"
            aria-label={`Use ${operation.label} on geometry`}
            title={`Drag ${operation.label} onto a highlighted ${operation.target}, or click to choose a target.`}
            draggable={
              (enablement.createOperationDrop ||
                (current && frame?.operation === operation.id)) &&
              operation.targets.length > 0
            }
            disabled={
              (!enablement.createOperationDrop &&
                !(current && frame?.operation === operation.id)) ||
              !operation.targets.length
            }
            onClick={() => {
              start(operation.id);
            }}
            onDragEnd={() => useOperationDrop.setState({ hoverId: undefined })}
            onDragStart={(event) => {
              if (!start(operation.id)) {
                event.preventDefault();
                return;
              }
              const active = useOperationDrop.getState().frame;
              if (
                !active ||
                active.operation !== operation.id ||
                !operationDropCurrent(active)
              ) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(
                OPERATION_DRAG_TYPE,
                operationTransferValue(active),
              );
            }}
          >
            {operation.label}
          </button>
        ))}
      </div>
      {frame ? (
        <div role="region" aria-label="Choose operation target">
          <p>
            {
              SUPPORTED_OPERATION_DROPS.find((op) => op.id === frame.operation)
                ?.label
            }
            : drop onto a highlighted target, click it in the viewer, or choose
            below. Inspect the native preview, then Apply. Use the cards when
            targets overlap or a detailed target is not drawn.
          </p>
          {frame.operation !== "extrude" ? (
            <p className="muted">
              Untouched distance-extrusion cap groups only. Each target includes
              all original perimeter edges.
            </p>
          ) : null}
          <p
            className="operation-target-feedback"
            role="status"
            aria-label="Operation target feedback"
          >
            {hoverId ? "Target highlighted." : "No target highlighted."} Only
            highlighted geometry can receive this operation.
          </p>
          <div className="operation-target-list">
            {targets.map((target) => (
              <button
                key={target.id}
                type="button"
                data-operation-target={target.id}
                aria-label={`Preview on ${target.label}`}
                disabled={!current}
                data-hovered={hoverId === target.id}
                onPointerEnter={() =>
                  useOperationDrop.setState({ hoverId: target.id })
                }
                onPointerLeave={() =>
                  useOperationDrop.setState({ hoverId: undefined })
                }
                onFocus={() =>
                  useOperationDrop.setState({ hoverId: target.id })
                }
                onBlur={() => useOperationDrop.setState({ hoverId: undefined })}
                onClick={() => perform(target.id)}
                onDragOver={(event) => {
                  if (
                    Array.from(event.dataTransfer.types).includes(
                      OPERATION_DRAG_TYPE,
                    )
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = current ? "copy" : "none";
                    if (useOperationDrop.getState().hoverId !== target.id)
                      useOperationDrop.setState({ hoverId: target.id });
                  }
                }}
                onDragLeave={() =>
                  useOperationDrop.setState({ hoverId: undefined })
                }
                onDrop={(event) => {
                  if (
                    !Array.from(event.dataTransfer.types).includes(
                      OPERATION_DRAG_TYPE,
                    )
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (
                    event.dataTransfer.getData(OPERATION_DRAG_TYPE) !==
                    operationTransferValue(frame)
                  ) {
                    useOperationDrop.setState({
                      error:
                        "This drag belongs to an old operation. Cancel and drag a fresh operation token.",
                    });
                    return;
                  }
                  perform(target.id);
                }}
              >
                {target.label}
              </button>
            ))}
          </div>
          {!current ? (
            <p role="alert">
              Project, component or modeling task changed. Cancel and choose the
              operation target again.
            </p>
          ) : !targets.length ? (
            <p role="alert">
              No visible supported targets remain. Show the source geometry or
              cancel and choose another operation.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => runCommand("feature.cancelOperationDrop")}
          >
            Cancel operation targets
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
