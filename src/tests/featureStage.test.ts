import { afterEach, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { createXySketch } from "../cad/sketch/SketchModel";
import { upsertSketch } from "../cad/document/CadDocument";
import { documentAtFeature } from "../cad/document/featureStage";
import {
  editableExtrude,
  beginExtrudeEditing,
  commitExtrude,
  useExtrudeDraft,
} from "../ui/commands/extrudeCommand";
import { useCadStore } from "../state/useCadStore";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { runCommand } from "../ui/commands/commandRegistry";

afterEach(() => {
  useExtrudeDraft.setState({ draft: undefined });
  useCadStore.setState(useCadStore.getInitialState(), true);
});

it("uses explicit timeline order for isolated feature stages and preserves the original document", () => {
  const document = upsertSketch(createBoxTemplate(), createXySketch("Later"));
  const feature = document.features[0];
  const before = documentAtFeature(document, feature.id);
  expect(before.features).toEqual([]);
  expect(Object.keys(before.sketches)).toEqual([
    feature.type === "extrude" ? feature.sketchId : "",
  ]);
  expect(documentAtFeature(document, feature.id, true).features).toEqual([
    feature,
  ]);
  expect(Object.keys(document.sketches)).toHaveLength(2);
  expect(() => documentAtFeature(document, "missing")).toThrow(
    /no longer exists/,
  );
});
it("requires a current native feature selection and rejects a stale replacement draft with the same project ID", () => {
  const document = createBoxTemplate(),
    feature = document.features[0];
  useCadStore.getState().setDocument(document);
  useCadStore
    .getState()
    .select({ kind: "feature", id: feature.id, documentId: document.id });
  expect(editableExtrude(useCadStore.getState())).toBeUndefined();
  const result = rebuildDocument(document);
  const native = {
    ...result,
    meshes: result.meshes.map((mesh) => ({
      ...mesh,
      geometrySource: "opencascade" as const,
      geometryAssertions: {
        valid: true as const,
        volume: 80000,
        surfaceArea: 13200,
        solidCount: 1,
      },
    })),
  };
  useCadStore.setState({
    rebuild: { kernelReady: true, status: "succeeded", result: native },
  });
  beginExtrudeEditing();
  const draft = useExtrudeDraft.getState().draft!;
  expect(draft.feature.id).toBe(feature.id);
  expect(() => commitExtrude(draft, document, result)).toThrow(
    /feature and downstream/,
  );
  useCadStore.getState().setDocument(document);
  expect(() => commitExtrude(draft, document, result, result)).toThrow(
    /changed/,
  );
  expect(useCadStore.getState().history.past).toEqual([]);
  useCadStore.setState({
    rebuild: { kernelReady: true, status: "succeeded", result },
  });
  useCadStore
    .getState()
    .select({ kind: "feature", id: feature.id, documentId: document.id });
  runCommand("feature.suppress");
  expect(editableExtrude(useCadStore.getState())).toBeUndefined();
  useExtrudeDraft.setState({ draft: undefined });
});
