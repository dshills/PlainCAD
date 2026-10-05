import { afterEach, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { documentAtFeature } from "../cad/document/featureStage";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import {
  beginHoleEditing,
  editableHole,
  stageHole,
  createHole,
  useHoleDraft,
} from "../ui/commands/holeCommand";
import { selectCommandEnablement } from "../ui/commands/commandRegistry";
import { evaluateExpressionRef } from "../cad/parameters/expressionEvaluator";

const previous = useCadStore.getState();
afterEach(() => {
  useCadStore.setState(previous, true);
  useHoleDraft.setState({ draft: undefined });
});
it("edits only a current active Hole, preserves authored units and IDs, and requires separate native operation/downstream proof", () => {
  const centers = addPoint(createXySketch("Centers"), "0mm", "0mm");
  let document = upsertSketch(createBoxTemplate(), centers.sketch);
  document = upsertFeature(document, {
    id: "feature_hole",
    name: "Hole",
    type: "hole",
    sketchId: centers.sketch.id,
    centerPointIds: [centers.pointId],
    targetBodyIds: [`body:${document.features[0].id}`],
    diameter: { expression: "4", authoredUnit: "mm", unit: "mm" },
    depth: { expression: "5", authoredUnit: "mm", unit: "mm" },
  });
  document = { ...document, unitSettings: { length: "in", angle: "deg" } };
  document = upsertFeature(document, {
    ...document.features[0],
    id: "feature_future",
    name: "Future body",
    timelineStep: undefined,
  });
  useCadStore.getState().setDocument(document);
  const current = useCadStore.getState().history.present,
    hole = current.features.find((feature) => feature.type === "hole")!;
  const prefix = documentAtFeature(current, hole.id),
    fallback = rebuildDocument(prefix);
  // Command fixture only. Browser tests prove actual OpenCascade geometry.
  const native = {
    ...fallback,
    meshes: fallback.meshes.map((mesh) => ({
      ...mesh,
      geometrySource: "opencascade" as const,
      geometryAssertions: {
        valid: true as const,
        solidCount: 1,
        volume: 80000,
        surfaceArea: 13200,
      },
    })),
  };
  useCadStore.setState({
    rebuild: {
      status: "failed",
      kernelReady: true,
      result: { ...native, success: false },
    },
  });
  useCadStore
    .getState()
    .select({ kind: "feature", id: hole.id, documentId: current.id });
  expect(editableHole(useCadStore.getState())?.id).toBe(hole.id);
  const active = useCadStore.getState();
  useCadStore.setState({ activeComponentId: "other" });
  expect(editableHole(useCadStore.getState())).toBeUndefined();
  useCadStore.setState(active, true);
  useCadStore.setState({
    history: {
      ...active.history,
      present: {
        ...current,
        features: current.features.map((feature) =>
          feature.id === hole.id ? { ...feature, suppressed: true } : feature,
        ),
      },
    },
  });
  expect(editableHole(useCadStore.getState())).toBeUndefined();
  useCadStore.setState(active, true);
  expect(selectCommandEnablement(useCadStore.getState()).editFeature).toBe(
    true,
  );
  beginHoleEditing();
  const draft = useHoleDraft.getState().draft!;
  const input = {
    name: "Edited",
    targetBodyIds: hole.targetBodyIds,
    centerPointIds: [centers.pointId],
    diameter: "4",
    depth: "5",
    throughAll: false,
  };
  expect(stageHole(input).ok).toBe(false);
  expect(stageHole(input, undefined, draft, fallback).ok).toBe(false);
  expect(
    stageHole(
      { ...input, targetBodyIds: ["body:future"] },
      undefined,
      draft,
      native,
    ).ok,
  ).toBe(false);
  const staged = stageHole(input, undefined, draft, native);
  const withFutureMesh = {
    ...native,
    meshes: [
      ...native.meshes,
      { ...native.meshes[0], bodyId: "body:feature_future" },
    ],
  };
  expect(
    stageHole(
      { ...input, targetBodyIds: ["body:feature_future"] },
      undefined,
      draft,
      withFutureMesh,
    ).ok,
  ).toBe(false);
  const resized = stageHole(
    { ...input, diameter: "0.25", throughAll: true },
    undefined,
    draft,
    native,
  );
  if (!resized.ok) throw new Error(resized.reason);
  expect(resized.feature.depth).toBe("throughAll");
  expect(resized.feature.diameter.authoredUnit).toBe("in");
  expect(
    evaluateExpressionRef(resized.feature.diameter, { parameters: {} }).quantity
      ?.value,
  ).toBeCloseTo(6.35);
  if (!staged.ok) throw new Error(staged.reason);
  expect(staged.feature.id).toBe(hole.id);
  expect(staged.feature.timelineStep).toBe(hole.timelineStep);
  expect(staged.feature.diameter).toEqual(hole.diameter);
  expect(staged.feature.depth).toEqual(hole.depth);
  expect(
    evaluateExpressionRef(staged.feature.diameter, { parameters: {} }).quantity
      ?.value,
  ).toBe(4);
  const operationResult = {
    ...native,
    meshes: native.meshes.map((mesh) => ({
      ...mesh,
      kernelOperation: "cut" as const,
    })),
  };
  const downstream = {
    ...native,
    meshes: native.meshes.map((mesh) => ({
      ...mesh,
      kernelOperation: "chamfer" as const,
    })),
  };
  expect(
    createHole(input, {
      feature: staged.feature,
      result: downstream,
      baseResult: native,
    }).ok,
  ).toBe(false);
  expect(
    createHole(input, {
      feature: staged.feature,
      result: { ...downstream, success: false },
      baseResult: native,
      operationResult,
    }).ok,
  ).toBe(false);
  expect(
    createHole(input, {
      feature: staged.feature,
      result: downstream,
      baseResult: native,
      operationResult,
    }).ok,
  ).toBe(true);
  expect(useCadStore.getState().history.past).toHaveLength(1);
  expect(useCadStore.getState().history.present.features).toHaveLength(
    current.features.length,
  );
  useCadStore.getState().undo();
  expect(useCadStore.getState().history.present).toEqual(current);
  useCadStore.setState({
    rebuild: {
      status: "failed",
      kernelReady: true,
      result: { ...native, success: false },
    },
  });
  beginHoleEditing();
  const late = useHoleDraft.getState().draft;
  expect(late).toBeDefined();
  useCadStore.getState().setDocument(current);
  expect(stageHole(input, undefined, late, native).ok).toBe(false);
  useCadStore.setState({
    rebuild: { status: "succeeded", kernelReady: true, result: fallback },
  });
  expect(editableHole(useCadStore.getState())).toBeUndefined();
});
