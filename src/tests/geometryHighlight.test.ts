import { afterEach, beforeEach, expect, it } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { useCadStore } from "../state/useCadStore";
import {
  currentGeometryHighlight,
  showGeometryHighlight,
  useGeometryHighlight,
} from "../state/useGeometryHighlight";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";
import { PROJECT_IMPORT_LIMITS } from "../persistence/importSafety";

beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.getState().setDocument(createEmptyDocument());
  const document = useCadStore.getState().history.present;
  const result: RebuildResult = {
    documentId: document.id,
    success: true,
    bodies: [{ id: "live", name: "Live body" }],
    errors: [],
    warnings: [],
    durationMs: 0,
    // Lifecycle fixture only; native geometry is established separately in browser acceptance.
    meshes: [{ id: "mesh-live", bodyId: "live", positions: [], normals: [], indices: [], bounds: { min: [0,0,0], max: [0,0,0] } } satisfies RenderMesh],
  };
  useCadStore.setState({
    rebuild: { result, status: "succeeded", kernelReady: true },
  });
});
afterEach(() => {
  useGeometryHighlight.setState({ highlight: undefined });
  useCadStore.setState(useCadStore.getInitialState(), true);
});
function input() {
  const state = useCadStore.getState();
  return {
    document: state.history.present,
    session: state.documentSession,
    source: "ai" as const,
    componentId: state.activeComponentId,
    result: state.rebuild.result,
    bodyIds: ["live", "missing", "live"],
  };
}
it("highlights only current bodies without changing selection, document or history and protects newer owners", () => {
  const state = useCadStore.getState();
  const first = showGeometryHighlight(input());
  expect(currentGeometryHighlight(state)?.bodyIds).toEqual(["live"]);
  expect(useCadStore.getState()).toBe(state);
  const second = showGeometryHighlight({ ...input(), source: "repair" });
  first();
  expect(currentGeometryHighlight(state)?.source).toBe("repair");
  second();
  expect(currentGeometryHighlight(state)).toBeUndefined();
});
it("rejects stale document/session/component/results and pending/file contexts but supports failed upstream repair geometry", () => {
  showGeometryHighlight(input());
  const state = useCadStore.getState();
  expect(
    currentGeometryHighlight({
      ...state,
      history: { ...state.history, present: { ...state.history.present } },
    }),
  ).toBeUndefined();
  expect(
    currentGeometryHighlight({
      ...state,
      documentSession: state.documentSession + 1,
    }),
  ).toBeUndefined();
  expect(
    currentGeometryHighlight({ ...state, activeComponentId: "other" }),
  ).toBeUndefined();
  expect(
    currentGeometryHighlight({ ...state, fileBusy: true }),
  ).toBeUndefined();
  expect(
    currentGeometryHighlight({
      ...state,
      rebuild: { ...state.rebuild, status: "queued" },
    }),
  ).toBeUndefined();
  expect(
    currentGeometryHighlight({
      ...state,
      rebuild: { ...state.rebuild, result: { ...state.rebuild.result! } },
    }),
  ).toBeUndefined();
  expect(
    currentGeometryHighlight({
      ...state,
      rebuild: { ...state.rebuild, status: "failed" },
    })?.bodyIds,
  ).toEqual(["live"]);
});
it("owns its arrays and filters missing sketch entities", () => {
  const state = useCadStore.getState();
  const ids = ["live"];
  showGeometryHighlight({
    ...input(),
    bodyIds: ids,
    sketchId: "missing",
    sketchEntityIds: ["missing"],
  });
  ids.length = 0;
  expect(currentGeometryHighlight(state)?.bodyIds).toEqual(["live"]);
  expect(currentGeometryHighlight(state)?.sketchEntityIds).toEqual([]);
});

it("bounds sketch highlight resources and follows only the live settled result when no result was captured", () => {
  const state = useCadStore.getState();
  showGeometryHighlight({
    ...input(),
    result: undefined,
    sketchEntityIds: Array.from(
      { length: PROJECT_IMPORT_LIMITS.maxSketchEntitiesPerSketch + 10 },
      (_, i) => `entity-${i}`,
    ),
  });
  expect(
    useGeometryHighlight.getState().highlight?.sketchEntityIds,
  ).toHaveLength(PROJECT_IMPORT_LIMITS.maxSketchEntitiesPerSketch);
  expect(currentGeometryHighlight(state)?.bodyIds).toEqual(["live"]);
  expect(
    currentGeometryHighlight({
      ...state,
      rebuild: {
        ...state.rebuild,
        status: "failed",
        result: { ...state.rebuild.result!, meshes: [] },
      },
    })?.bodyIds,
  ).toEqual([]);
});
