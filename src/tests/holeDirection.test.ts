import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import {
  addCornerRectangle,
  addPoint,
  createSketchOnPlane,
} from "../cad/sketch/SketchModel";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { sketchPlaneChoices } from "../cad/sketch/planePicking";
import type {
  CadDocument,
  HoleFeature,
  OriginPlane,
} from "../cad/document/schema";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { useCadStore } from "../state/useCadStore";
import { documentAtFeature } from "../cad/document/featureStage";
import {
  beginHoleEditing,
  stageHole,
  useHoleDraft,
} from "../ui/commands/holeCommand";
import { buildAiFeatureEdit } from "../ai/featureEditPlan";
import { validateDocument } from "../cad/document/validate";
import { exportMeshesToStl } from "../cad/kernel/stlExport";
// Load the exact installed OpenCascade WASM bindings; geometry is not mocked.
vi.mock("opencascade.js/dist/opencascade.wasm.js", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const root = `${process.cwd()}/node_modules/opencascade.js/dist`;
  const filename = `${root}/opencascade.wasm.js`;
  const factory = new Function(
    "require",
    "__dirname",
    "__filename",
    readFileSync(filename, "utf8").replace(
      "export default opencascade;",
      "return opencascade;",
    ),
  )(createRequire(filename), root, filename);
  return {
    default: () =>
      factory({ wasmBinary: readFileSync(`${root}/opencascade.wasm.wasm`) }),
  };
});
vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });
beforeAll(async () => OpenCascadeKernel.initialize());
afterEach(() => {
  useHoleDraft.setState({ draft: undefined });
  useCadStore.setState(useCadStore.getInitialState(), true);
});
function box(plane: OriginPlane = "XY") {
  const sketch = addCornerRectangle(
    createSketchOnPlane("Outline", plane),
    "20mm",
    "10mm",
  );
  const profile = detectProfiles(solveSketch(sketch, {})).profiles[0];
  const feature = createExtrudeFeature({
    name: "Base",
    sketchId: sketch.id,
    profileId: profile.id,
    operation: "newBody",
    distance: { expression: "10mm", unit: "mm" },
    direction: "positive",
  });
  const document = upsertFeature(
    upsertSketch(createEmptyDocument(), sketch),
    feature,
  );
  const result = rebuildDocument(document);
  expect(result.success).toBe(true);
  expect(result.meshes[0].geometrySource).toBe("opencascade");
  const choice = sketchPlaneChoices(document, result).find(
    (c) => c.id === `extrude:${feature.id}:endCap`,
  )!;
  expect(choice).toBeDefined();
  return { document, result, feature, choice };
}

function drilled(
  plane: OriginPlane,
  direction: HoleFeature["direction"],
  throughAll: boolean,
) {
  const base = box(plane);
  const point = addPoint(
    createSketchOnPlane("Face centers", base.choice.reference),
    "5mm",
    "5mm",
  );
  const hole: HoleFeature = {
    id: "inward-hole",
    name: "Drill",
    type: "hole",
    sketchId: point.sketch.id,
    centerPointIds: [point.pointId],
    targetBodyIds: [`body:${base.feature.id}`],
    direction,
    diameter: { expression: "2mm", unit: "mm" },
    depth: throughAll ? "throughAll" : { expression: "3mm", unit: "mm" },
  };
  const document = upsertFeature(
    upsertSketch(base.document, point.sketch),
    hole,
  );
  return { ...base, document, hole, result: rebuildDocument(document) };
}
it.each(
  (["XY", "XZ", "YZ"] as const).flatMap((plane) =>
    [false, true].map((throughAll) => ({ plane, throughAll })),
  ),
)(
  "drills inward native solids from the outward $plane end cap (throughAll=$throughAll)",
  ({ plane, throughAll }) => {
    const cut = drilled(plane, "negative", throughAll);
    expect(cut.result.success).toBe(true);
    expect(cut.result.errors).toEqual([]);
    const mesh = cut.result.meshes[0];
    expect(mesh.geometrySource).toBe("opencascade");
    expect(mesh.kernelOperation).toBe("cut");
    expect(mesh.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    const volume = 2000 - Math.PI * (throughAll ? 10 : 3);
    expect(mesh.geometryAssertions!.volume).toBeCloseTo(volume, 5);
    expect(mesh.bodyId).toBe(`body:${cut.feature.id}`);
    // A blind cavity floor must lie 3mm inward along this face's outward
    // normal on every origin-plane orientation; outer body vertices remain intact.
    if (!throughAll) {
      const capTransform = cut.choice.transform;
      const distances = Array.from(
        { length: mesh.positions.length / 3 },
        (_, i) =>
          (mesh.positions[i * 3] - capTransform.origin.x) *
            capTransform.normal.x +
          (mesh.positions[i * 3 + 1] - capTransform.origin.y) *
            capTransform.normal.y +
          (mesh.positions[i * 3 + 2] - capTransform.origin.z) *
            capTransform.normal.z,
      );
      expect(distances.some((d) => Math.abs(d + 3) < 1e-5)).toBe(true);
      expect(Math.max(...distances)).toBeCloseTo(0, 5);
      expect(Math.min(...distances)).toBeCloseTo(-10, 5);
    }

    const imported = importProjectText(serializeProject(cut.document));
    expect(imported.features.find((f) => f.id === cut.hole.id)).toMatchObject({
      direction: "negative",
    });
    expect(
      rebuildDocument(imported).meshes[0].geometryAssertions!.volume,
    ).toBeCloseTo(volume, 5);
    const bytes = new DataView(exportMeshesToStl(cut.result.meshes));
    const count = bytes.getUint32(80, true);
    expect(count).toBeGreaterThan(0);
    let signed = 0;
    for (let i = 0; i < count; i++) {
      const offset = 84 + i * 50 + 12;
      const a = [0, 1, 2].map((j) => bytes.getFloat32(offset + j * 4, true));
      const b = [0, 1, 2].map((j) =>
        bytes.getFloat32(offset + 12 + j * 4, true),
      );
      const c = [0, 1, 2].map((j) =>
        bytes.getFloat32(offset + 24 + j * 4, true),
      );
      signed +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
    }
    expect(signed).toBeGreaterThan(0);
    expect(signed / volume).toBeCloseTo(1, 2);
  },
);
it.each(
  ([undefined, "positive"] as const).flatMap((direction) =>
    [false, true].map((throughAll) => ({ direction, throughAll })),
  ),
)(
  "diagnoses outward drilling without successful unchanged geometry (direction=$direction, throughAll=$throughAll)",
  ({ direction, throughAll }) => {
    const cut = drilled("XY", direction, throughAll);
    expect(cut.result.success).toBe(false);
    expect(cut.result.errors).toContainEqual({
      id: throughAll ? `feature:${cut.hole.id}:depth` : `kernel:${cut.hole.id}`,
      source: throughAll ? "feature" : "kernel",
      sourceId: cut.hole.id,
      message: throughAll
        ? "Hole depth must resolve along the selected sketch normal direction."
        : `Hole center 1: Boolean cut removed no volume. Move the tool into the target body. Center point "${cut.hole.centerPointIds[0]}".`,
    });
  },
);
it("preserves schema-12 positive semantics, round-trips schema-13 negative direction and rejects unsupported directions", () => {
  const current = drilled("XY", "negative", false).document;
  const legacy = importProjectText(
    JSON.stringify({ ...current, schemaVersion: 12 }),
  );
  expect(legacy.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  const hole = legacy.features.find((f) => f.type === "hole")!;
  expect(hole.direction).toBeUndefined();
  expect(rebuildDocument(legacy).success).toBe(false);
  const malformed = {
    ...current,
    features: current.features.map((f) =>
      f.type === "hole" ? { ...f, direction: "symmetric" } : f,
    ),
  };
  expect(
    validateDocument(malformed as CadDocument).some((e) =>
      /Hole direction/.test(e.message),
    ),
  ).toBe(true);
  expect(() => importProjectText(JSON.stringify(malformed))).toThrow(
    /Hole direction/,
  );
});

it("retains inward direction and stable feature identity during bounded AI Hole dimension edits", () => {
  const cut = drilled("XY", "negative", false);
  const feature = cut.document.features.find((f) => f.id === cut.hole.id)!;
  const staged = buildAiFeatureEdit(
    cut.document,
    cut.document.rootComponentId,
    cut.hole.id,
    {
      name: "Wider hole",
      summary: "Change only hole diameter",
      warnings: [],
      steps: [],
      parameters: [{ name: "diameter", value: 3, unit: "mm" }],
    },
  );
  expect(staged.editedFeature).toMatchObject({
    id: cut.hole.id,
    direction: "negative",
    sketchId: cut.hole.sketchId,
    centerPointIds: cut.hole.centerPointIds,
    targetBodyIds: cut.hole.targetBodyIds,
    depth: cut.hole.depth,
  });
  expect(staged.editedFeature.timelineStep).toBe(feature.timelineStep);
  expect(staged.document.parameters).toEqual(cut.document.parameters);
  const result = rebuildDocument(staged.document);
  expect(result.success).toBe(true);
  expect(result.meshes[0].geometrySource).toBe("opencascade");
  expect(result.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    2000 - Math.PI * 1.5 ** 2 * 3,
    5,
  );
});

it("preserves the guided inward direction when staging an ordinary Hole dimension edit", () => {
  const cut = drilled("XY", "negative", false);
  useCadStore.setState(useCadStore.getInitialState(), true);
  useHoleDraft.setState({ draft: undefined });
  useCadStore.getState().setDocument(cut.document);
  const current = useCadStore.getState().history.present;
  const result = rebuildDocument(current);
  useCadStore.setState({
    rebuild: { kernelReady: true, status: "succeeded", result },
  });
  useCadStore
    .getState()
    .select({ kind: "feature", id: cut.hole.id, documentId: current.id });
  beginHoleEditing();
  const draft = useHoleDraft.getState().draft!;
  expect(draft.editing).toBe(true);
  const prefix = rebuildDocument(documentAtFeature(current, cut.hole.id));
  const staged = stageHole(
    {
      name: "Wider drill",
      centerPointIds: cut.hole.centerPointIds,
      targetBodyIds: cut.hole.targetBodyIds,
      diameter: "3mm",
      depth: "3mm",
      throughAll: false,
    },
    undefined,
    draft,
    prefix,
  );
  expect(staged.ok).toBe(true);
  if (!staged.ok) throw new Error(staged.reason);
  expect(staged.feature).toMatchObject({
    id: cut.hole.id,
    direction: "negative",
    sketchId: cut.hole.sketchId,
  });
  const preview = rebuildDocument(staged.document);
  expect(preview.success).toBe(true);
  expect(preview.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    2000 - Math.PI * 1.5 ** 2 * 3,
    5,
  );
  expect(useCadStore.getState().history.present).toBe(current);
  expect(useCadStore.getState().history.past).toHaveLength(0);
  useHoleDraft.setState({ draft: undefined });
});
