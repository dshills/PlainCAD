import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createBoxTemplate } from "../templates/templates";
import type { FilletFeature } from "../cad/document/schema";
import { createExtrudeEdgeRef } from "../cad/features/topologyRefs";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { EdgeDraftControls } from "../ui/panels/EdgeDraftControls";

afterEach(cleanup);
it("edits one explicit edge reference without dropping others and preserves its source when switching caps", () => {
  const document = createBoxTemplate(),
    owner = document.features[0];
  const feature: FilletFeature = {
    id: "fillet_multi",
    name: "Both edges",
    type: "fillet",
    radius: { expression: "1mm", unit: "mm" },
    targetEdgeRefs: [
      createExtrudeEdgeRef(owner.id, "endCapPerimeter", "line_front"),
      createExtrudeEdgeRef(owner.id, "endCapPerimeter", "line_back"),
    ],
  };
  const fallback = rebuildDocument(document);
  // Controls only; Chromium establishes validity for the authored native edges.
  const result = {
    ...fallback,
    meshes: fallback.meshes.map((mesh) => ({
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
  const onChange = vi.fn();
  const { rerender } = render(
    <EdgeDraftControls
      draft={{
        document,
        session: 1,
        componentId: document.rootComponentId,
        feature,
      }}
      baseDocument={document}
      baseResult={result}
      feature={feature}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByLabelText("Edge reference"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("Edges to change"), {
    target: { value: "startCapPerimeter" },
  });
  const changed = onChange.mock.calls[0][0] as FilletFeature;
  expect(changed.targetEdgeRefs).toHaveLength(2);
  expect(changed.targetEdgeRefs[0]).toBe(feature.targetEdgeRefs[0]);
  expect(changed.targetEdgeRefs[1]).toMatchObject({
    featureId: owner.id,
    role: "startCapPerimeter",
    sourceEntityId: "line_back",
  });
  expect(feature.targetEdgeRefs[1].role).toBe("endCapPerimeter");
  const single = {
    ...feature,
    targetEdgeRefs: feature.targetEdgeRefs.slice(0, 1),
  };
  rerender(
    <EdgeDraftControls
      draft={{
        document,
        session: 1,
        componentId: document.rootComponentId,
        feature: single,
      }}
      baseDocument={document}
      baseResult={result}
      feature={single}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByLabelText("Edges to change"), {
    target: { value: "startCapPerimeter" },
  });
  expect(onChange.mock.calls[1][0].targetEdgeRefs).toHaveLength(1);
  expect(onChange.mock.calls[1][0].targetEdgeRefs[0]).toMatchObject({
    role: "startCapPerimeter",
    sourceEntityId: "line_front",
  });
});

it("keeps source controls unavailable when the owner only has fallback geometry", () => {
  const document = createBoxTemplate();
  const feature: FilletFeature = {
    id: "fillet_fallback",
    name: "Unavailable",
    type: "fillet",
    radius: { expression: "1mm", unit: "mm" },
    targetEdgeRefs: [
      createExtrudeEdgeRef(document.features[0].id, "endCapPerimeter"),
    ],
  };
  render(
    <EdgeDraftControls
      draft={{
        document,
        session: 1,
        componentId: document.rootComponentId,
        feature,
      }}
      baseDocument={document}
      baseResult={rebuildDocument(document)}
      feature={feature}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Edges to change")).toBeDisabled();
  expect(screen.getByLabelText("Source edge")).toBeDisabled();
});
