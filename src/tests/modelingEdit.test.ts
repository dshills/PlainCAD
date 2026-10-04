import { afterEach, expect, it } from "vitest";
import {
  createEmptyDocument,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import {
  beginModelingEditing,
  editableModelingFeature,
  commitModelingDraft,
  useModelingDraft,
} from "../ui/commands/modelingDraftCommand";

afterEach(() => {
  useModelingDraft.setState({ draft: undefined });
  useCadStore.setState(useCadStore.getInitialState(), true);
});
it("opens the original revolve as a replacement and rejects missing native verification, cancellation and same-ID project replacement", () => {
  const sketch = addCornerRectangle(createXySketch(), "5mm", "10mm");
  const document = upsertFeature(upsertSketch(createEmptyDocument(), sketch), {
    id: "revolve_edit",
    name: "Cylinder",
    type: "revolve",
    sketchId: sketch.id,
    profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
    axis: { type: "origin", axis: "Y" },
    operation: "newBody",
    angle: { expression: "360deg", unit: "deg" },
  });
  useCadStore.getState().setDocument(document);
  useCadStore
    .getState()
    .select({ kind: "feature", id: "revolve_edit", documentId: document.id });
  expect(editableModelingFeature(useCadStore.getState())).toBeUndefined();
  const fallback = rebuildDocument(document);
  // Command lifecycle only. The native replacement and downstream geometry are proved in Chromium.
  const native = {
    ...fallback,
    meshes: fallback.meshes.map((mesh) => ({
      ...mesh,
      geometrySource: "opencascade" as const,
      geometryAssertions: {
        valid: true as const,
        volume: 250 * Math.PI,
        surfaceArea: 150 * Math.PI,
        solidCount: 1,
      },
    })),
  };
  useCadStore.setState({
    rebuild: { kernelReady: true, status: "succeeded", result: native },
  });
  beginModelingEditing();
  const draft = useModelingDraft.getState().draft!;
  expect(draft).toMatchObject({
    editing: true,
    feature: { id: "revolve_edit", angle: { expression: "360deg" } },
  });
  expect(() => commitModelingDraft(draft, document, native)).toThrow(
    /feature and downstream/,
  );
  useModelingDraft.setState({ draft: undefined });
  expect(() => commitModelingDraft(draft, document, native, native)).toThrow(
    /changed/,
  );
  beginModelingEditing();
  const reopened = useModelingDraft.getState().draft!;
  expect(reopened.editId).not.toBe(draft.editId);
  useCadStore.getState().setDocument(document);
  expect(() => commitModelingDraft(reopened, document, native, native)).toThrow(
    /changed/,
  );
  expect(useCadStore.getState().history.past).toEqual([]);
});
