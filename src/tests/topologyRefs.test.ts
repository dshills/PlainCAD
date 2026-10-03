import { describe, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import {
  createExtrudeEdgeRef,
  resolveSupportedEdgeRef,
} from "../cad/features/topologyRefs";
import { upsertFeature } from "../cad/document/CadDocument";

describe("distance extrusion edge ownership", () => {
  it.each(["positive", "negative", "symmetric"] as const)(
    "preserves stable cap/corner identities on %s owners",
    (direction) => {
      const original = createBoxTemplate();
      const owner = original.features[0];
      if (owner.type !== "extrude") throw new Error("Expected extrusion");
      const document = upsertFeature(original, { ...owner, direction });
      const line = Object.values(
        document.sketches[owner.sketchId].entities,
      ).find((e) => e.type === "line")!;
      for (const role of [
        "profileEdge",
        "startCapPerimeter",
        "endCapPerimeter",
      ] as const) {
        const ref = createExtrudeEdgeRef(owner.id, role, line.id);
        expect(resolveSupportedEdgeRef(document, ref)).toMatchObject({
          stableId: ref.stableHint,
          feature: { direction },
        });
        expect(
          resolveSupportedEdgeRef(
            upsertFeature(document, { ...owner, direction, suppressed: true }),
            ref,
          ),
        ).toHaveProperty("error");
        expect(
          resolveSupportedEdgeRef(
            upsertFeature(document, { ...owner, direction, operation: "cut" }),
            ref,
          ),
        ).toHaveProperty("error");
        expect(
          resolveSupportedEdgeRef(
            upsertFeature(document, {
              ...owner,
              direction,
              termination: { type: "throughAll" },
            }),
            ref,
          ),
        ).toHaveProperty("error");
        expect(
          resolveSupportedEdgeRef(document, { ...ref, repairRequired: true }),
        ).toHaveProperty("error");
      }
    },
  );
});
