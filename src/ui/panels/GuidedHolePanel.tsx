import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import { MODEL_RESOURCE_LIMITS } from "../../cad/resourceLimits";
import { createId } from "../../cad/document/ids";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import {
  guidedFaceBounds,
  guidedFaceContains,
  guidedFaceTriangles,
} from "../../cad/sketch/guidedHoleGeometry";
import {
  guidedHoleFaces,
  guidedHoleCurrent,
  chooseGuidedHoleFace,
  commitGuidedHole,
  resolveGuidedHoleCenter,
  stageGuidedHole,
  useGuidedHole,
  type GuidedHoleCenter,
  type GuidedHoleDraft,
} from "../commands/guidedHoleCommand";
import { assertNativeHolePreview } from "../commands/holeCommand";
import { useSketchPlanePicker } from "../commands/sketchPlanePicker";
import { runCommand } from "../commands/commandRegistry";
import { ModalDialog } from "../ModalDialog";
import { ExtrudePreview } from "../../viewer/ExtrudePreview";
import "./GuidedHolePanel.css";

const EMPTY_MESHES: RebuildResult["meshes"] = [];
export function GuidedHolePanel() {
  const draft = useGuidedHole((s) => s.draft);
  const current = useCadStore((state) =>
    Boolean(draft && guidedHoleCurrent(draft, state)),
  );
  const choiceContext = useCadStore(
    useShallow(
      (state) =>
        [
          state.history.present,
          state.rebuild,
          state.activeComponentId,
          state.fileBusy,
        ] as const,
    ),
  );
  const choices = useMemo(() => guidedHoleFaces(), [choiceContext]);
  const error = useSketchPlanePicker((s) => s.error);
  useEffect(() => {
    if (!draft || draft.phase !== "face") return;
    const cancel = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !window.document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        void runCommand("feature.cancelGuidedHole");
      }
    };
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("keydown", cancel);
      useSketchPlanePicker.setState({ hover: undefined, error: undefined });
    };
  }, [draft]);
  if (!draft) return null;
  if (
    draft.phase === "centers" &&
    (!draft.choice ||
      !draft.result.meshes.some((mesh) => mesh.bodyId === draft.choice?.bodyId))
  )
    return (
      <section role="alert">
        The selected face is unavailable.{" "}
        <button
          type="button"
          onClick={() => void runCommand("feature.cancelGuidedHole")}
        >
          Cancel guided holes
        </button>
      </section>
    );
  if (draft.phase === "centers")
    return (
      <GuidedHoleCenters
        key={draft.featureId}
        draft={draft}
        current={current}
      />
    );
  return (
    <section className="sketch-plane-picker" aria-label="Choose hole face">
      <h2>Choose a face for holes</h2>
      <p>
        Component:{" "}
        <strong>{draft.document.components[draft.componentId].name}</strong>.
        Click a supported flat face in the viewer or choose it below.
      </p>
      <p>
        The hole centers and feature will be saved together after a valid native
        preview. Curved and ambiguous faces remain unavailable.
      </p>
      {!current ? (
        <p role="alert">
          Project or selection changed. Cancel and start again.
        </p>
      ) : null}
      <div className="plane-choices">
        {choices.map((choice) => (
          <button
            type="button"
            key={choice.id}
            disabled={!current}
            aria-label={`Hole on ${choice.label}`}
            onMouseEnter={() =>
              useSketchPlanePicker.setState({ hover: choice })
            }
            onFocus={() => useSketchPlanePicker.setState({ hover: choice })}
            onMouseLeave={() =>
              useSketchPlanePicker.setState({ hover: undefined })
            }
            onBlur={() => useSketchPlanePicker.setState({ hover: undefined })}
            onClick={() => {
              try {
                chooseGuidedHoleFace(choice.id);
              } catch (error) {
                useSketchPlanePicker.setState({
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        onClick={() => void runCommand("feature.cancelGuidedHole")}
      >
        Cancel guided holes
      </button>
    </section>
  );
}
function GuidedHoleCenters({
  draft,
  current,
}: {
  draft: GuidedHoleDraft;
  current: boolean;
}) {
  const choice = draft.choice!;
  const mesh = draft.result.meshes.find(
    (mesh) => mesh.bodyId === choice.bodyId,
  )!;
  const triangles = useMemo(
    () => guidedFaceTriangles(choice, mesh),
    [choice, mesh],
  );
  const bounds = useMemo(() => guidedFaceBounds(triangles), [triangles]);
  const [centers, setCenters] = useState<GuidedHoleCenter[]>([]),
    [x, setX] = useState("0mm"),
    [y, setY] = useState("0mm"),
    [diameter, setDiameter] = useState("3mm"),
    [depth, setDepth] = useState("5mm"),
    [throughAll, setThroughAll] = useState(true),
    [error, setError] = useState("");
  const input = useMemo(
    () => ({ centers, diameter, depth, throughAll }),
    [centers, diameter, depth, throughAll],
  );
  const staged = useMemo(() => {
    if (!current)
      return { error: "Project or selection changed. Cancel and start again." };
    try {
      return { value: stageGuidedHole(draft, input) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [draft, input, current]);
  const [preview, setPreview] = useState<{
    staged: NonNullable<typeof staged.value>;
    result?: RebuildResult;
    error?: string;
  }>();
  useEffect(() => {
    if (!current || !staged.value) return;
    const controller = new AbortController(),
      value = staged.value;
    const timer = setTimeout(() => {
      void previewModeling(value.document, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          assertNativeHolePreview(result, value.document.id, value.feature);
          setPreview({ staged: value, result });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setPreview({
              staged: value,
              error: error instanceof Error ? error.message : String(error),
            });
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [current, staged.value]);
  const shown =
    current && preview?.staged === staged.value ? preview : undefined;
  const add = (center: GuidedHoleCenter) => {
    if (!current) return;
    try {
      if (centers.length >= MODEL_RESOURCE_LIMITS.maxHoleCenters)
        throw new Error(
          `Place at most ${MODEL_RESOURCE_LIMITS.maxHoleCenters} centers.`,
        );
      const point = resolveGuidedHoleCenter(draft, center);
      if (!guidedFaceContains(triangles, point))
        throw new Error(
          "Choose a center on the selected face, outside existing openings.",
        );
      setCenters((previous) => [...previous, center]);
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const display = useMemo(
    () =>
      centers.map((center) => ({
        center,
        point: resolveGuidedHoleCenter(draft, center),
      })),
    [draft, centers],
  );
  const pointerStart = useRef<{ x: number; y: number } | undefined>(undefined);
  return (
    <ModalDialog
      label="Place holes on face"
      className="guided-hole-dialog"
      onDismiss={() => void runCommand("feature.cancelGuidedHole")}
    >
      <h2>Place holes on face</h2>
      <p>
        Part:{" "}
        <strong>{draft.document.components[draft.componentId].name}</strong> ·
        Face: <strong>{choice.label}</strong>
      </p>
      <p>
        Click the shaded face to place a center, or enter exact local X/Y
        coordinates. Holes drill inward; only the displayed target body is
        changed.
      </p>
      <svg
        className="guided-hole-canvas"
        role="group"
        aria-label="Hole center placement"
        tabIndex={0}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(event) => {
          if (event.button === 0)
            pointerStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => {
          pointerStart.current = undefined;
        }}
        onPointerUp={(event) => {
          const start = pointerStart.current;
          pointerStart.current = undefined;
          if (
            event.button !== 0 ||
            !start ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
          )
            return;
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const point = new DOMPoint(
            event.clientX,
            event.clientY,
          ).matrixTransform(matrix.inverse());
          const localX = Number(point.x.toFixed(3));
          const localY = Number((-point.y).toFixed(3));
          add({
            id: createId("point"),
            x: `${localX}mm`,
            y: `${localY}mm`,
          });
        }}
      >
        {triangles.map((triangle, index) => (
          <polygon
            key={index}
            points={triangle.map((point) => `${point.x},${-point.y}`).join(" ")}
          />
        ))}
        {display.map(({ center, point }) => (
          <g key={center.id} data-hole-center-id={center.id}>
            <circle
              cx={point.x}
              cy={-point.y}
              r={Math.max(bounds.width, bounds.height) / 100}
            />
            <text
              x={point.x + bounds.width / 80}
              y={-point.y}
              fontSize={bounds.width / 40}
            >
              {point.x.toFixed(1)}, {point.y.toFixed(1)}
            </text>
          </g>
        ))}
      </svg>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          add({ id: createId("point"), x, y });
        }}
        className="guided-hole-coordinate-form"
      >
        <label>
          Hole center X
          <input
            value={x}
            disabled={!current}
            onChange={(event) => {
              setX(event.target.value);
              setError("");
            }}
          />
        </label>
        <label>
          Hole center Y
          <input
            value={y}
            disabled={!current}
            onChange={(event) => {
              setY(event.target.value);
              setError("");
            }}
          />
        </label>
        <button type="submit" disabled={!current}>
          Add hole center
        </button>
      </form>
      <ul aria-label="Hole centers">
        {display.map(({ center, point }, index) => (
          <li key={center.id}>
            {index + 1}: {point.x.toFixed(3)}, {point.y.toFixed(3)} mm{" "}
            <button
              type="button"
              disabled={!current}
              aria-label={`Remove hole center ${index + 1}`}
              onClick={() => {
                setCenters((previous) =>
                  previous.filter((c) => c.id !== center.id),
                );
                setError("");
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <label>
        Guided hole diameter
        <input
          value={diameter}
          disabled={!current}
          onChange={(event) => {
            setDiameter(event.target.value);
            setError("");
          }}
        />
      </label>
      <label>
        Guided hole termination
        <select
          aria-label="Guided hole termination"
          value={throughAll ? "throughAll" : "distance"}
          disabled={!current}
          onChange={(event) => {
            setThroughAll(event.target.value === "throughAll");
            setError("");
          }}
        >
          <option value="throughAll">Through all</option>
          <option value="distance">Blind depth</option>
        </select>
      </label>
      {!throughAll ? (
        <label>
          Guided hole depth
          <input
            value={depth}
            disabled={!current}
            onChange={(event) => {
              setDepth(event.target.value);
              setError("");
            }}
          />
        </label>
      ) : null}
      <ExtrudePreview
        meshes={shown?.result?.meshes ?? EMPTY_MESHES}
        label="Native guided hole preview"
      />
      <p role="status" aria-label="Guided hole preview status">
        {staged.error ??
          (shown?.error
            ? "Preview failed"
            : shown?.result
              ? `Native preview ready · ${shown.result.meshes.reduce((sum, mesh) => sum + mesh.geometryAssertions!.volume, 0).toFixed(3)} mm³`
              : "Building native preview…")}
      </p>
      {error || shown?.error ? (
        <p role="alert">{shown?.error || error}</p>
      ) : null}
      <div className="guided-hole-actions">
        <button
          type="button"
          disabled={!shown?.result || !staged.value}
          onClick={() => {
            try {
              if (staged.value && shown?.result)
                commitGuidedHole(draft, staged.value, shown.result);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
            }
          }}
        >
          Apply face holes
        </button>
        <button
          type="button"
          onClick={() => void runCommand("feature.cancelGuidedHole")}
        >
          Cancel guided holes
        </button>
      </div>
    </ModalDialog>
  );
}
