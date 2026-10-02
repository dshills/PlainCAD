import { describe, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import {
  bindDocumentExpressions,
  mapDocumentExpressions,
  renameParameter,
} from "../cad/parameters/expressionBindings";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { importProjectText } from "../persistence/projectCodec";
import { serializeProject } from "../persistence/exportProject";
import { useCadStore } from "../state/useCadStore";
import { upsertParameter } from "../cad/document/CadDocument";

describe("stable parameter bindings", () => {
  it("preserves geometry, IDs and dependencies across rename, edit, old-name reuse, and round trip", () => {
    const document = bindDocumentExpressions(createBoxTemplate());
    const before = rebuildDocument(document);
    const id = document.parameters.width.id;
    let renamed = renameParameter(document, id, "span");
    expect(renamed.parameters.span.id).toBe(id);
    expect(renamed.features.map((f) => f.id)).toEqual(
      document.features.map((f) => f.id),
    );
    expect(rebuildDocument(renamed).meshes[0].bounds).toEqual(
      before.meshes[0].bounds,
    );
    renamed = upsertParameter(renamed, {
      id: "replacement",
      name: "width",
      expression: "200mm",
      value: 200,
      unit: "mm",
    });
    expect(rebuildDocument(renamed).meshes[0].bounds).toEqual(
      before.meshes[0].bounds,
    );
    renamed = upsertParameter(renamed, {
      ...renamed.parameters.span,
      expression: "91mm",
    });
    const edited = rebuildDocument(renamed);
    expect(edited.success).toBe(true);
    expect(
      edited.meshes[0].bounds.max[0] - edited.meshes[0].bounds.min[0],
    ).toBe(91);
    const text = serializeProject(renamed);
    expect(serializeProject(importProjectText(text))).toBe(text);
    expect(rebuildDocument(importProjectText(text)).meshes[0].bounds).toEqual(
      edited.meshes[0].bounds,
    );
  });
  it("updates only bound identifier tokens, preserving functions, units, spacing and similar names", () => {
    let document = createBoxTemplate();
    document = upsertParameter(document, {
      id: "related",
      name: "width_extra",
      expression: "width + 2mm",
      value: 0,
      unit: "mm",
    });
    document = upsertParameter(document, {
      id: "dependent",
      name: "result",
      expression: " min(width, 10mm) + width_extra ",
      value: 0,
      unit: "mm",
    });
    const renamed = renameParameter(
      document,
      document.parameters.width.id,
      "mm",
    );
    expect(renamed.parameters.result.expression).toBe(
      " min(mm, 10mm) + width_extra ",
    );
    expect(renamed.parameters.width_extra.expression).toBe("mm + 2mm");
    expect(renamed.parameters.result.parameterRefs).toEqual({
      mm: document.parameters.width.id,
      width_extra: "related",
    });
  });
  it("binds all schema-owned expression fields including offsets, dimensions and feature sizes", () => {
    const document = createBoxTemplate();
    const reference = { expression: "width", unit: "mm" };
    const sketch = Object.values(document.sketches)[0];
    const expanded = {
      ...document,
      sketches: {
        ...document.sketches,
        [sketch.id]: {
          ...sketch,
          plane: {
            type: "offset" as const,
            base: "XY" as const,
            offset: reference,
          },
          dimensions: [
            {
              id: "dimension",
              type: "length" as const,
              entityIds: [],
              expression: reference,
            },
          ],
        },
      },
      features: [
        ...document.features,
        {
          id: "hole",
          name: "Hole",
          type: "hole" as const,
          sketchId: sketch.id,
          centerPointIds: [],
          diameter: reference,
          depth: reference,
        },
        {
          id: "fillet",
          name: "Fillet",
          type: "fillet" as const,
          targetEdgeRefs: [],
          radius: reference,
        },
        {
          id: "chamfer",
          name: "Chamfer",
          type: "chamfer" as const,
          targetEdgeRefs: [],
          distance: reference,
        },
        {
          id: "revolve",
          name: "Revolve",
          type: "revolve" as const,
          sketchId: sketch.id,
          profileId: "profile",
          operation: "newBody" as const,
          axis: { type: "origin" as const, axis: "Y" as const },
          angle: reference,
        },
      ],
    };
    const renamed = renameParameter(
      expanded,
      document.parameters.width.id,
      "span",
    );
    let bound = 0;
    mapDocumentExpressions(renamed, (e) => {
      if (e.parameterRefs?.span) {
        bound++;
        expect(e.expression).toContain("span");
        expect(e.expression).not.toMatch(/\bwidth\b/);
      }
      return e;
    });
    expect(bound).toBeGreaterThan(8);
  });
  it("treats stored ID bindings as authoritative and rejects missing IDs or invalid bindings", () => {
    const document = bindDocumentExpressions(createBoxTemplate());
    const renamed = renameParameter(
      document,
      document.parameters.width.id,
      "span",
    );
    const staleLabels = mapDocumentExpressions(renamed, (e) =>
      e.parameterRefs?.span
        ? {
            ...e,
            expression: e.expression.replace(/\bspan\b/g, "width"),
            parameterRefs: {
              ...e.parameterRefs,
              width: e.parameterRefs.span,
              span: undefined,
            } as any,
          }
        : e,
    );
    // JSON removes undefined stale map entries; import canonicalizes labels from IDs.
    expect(importProjectText(JSON.stringify(staleLabels)).sketches).toEqual(
      renamed.sketches,
    );
    const missing = {
      ...document,
      parameters: {
        ...document.parameters,
        width: { ...document.parameters.width, id: "different-id" },
      },
    };
    expect(
      rebuildDocument(missing).errors.some((e) =>
        e.message.includes("missing parameter binding"),
      ),
    ).toBe(true);
    const reopened = importProjectText(serializeProject(missing));
    expect(rebuildDocument(reopened).success).toBe(false);
    expect(JSON.stringify(reopened)).toContain(document.parameters.width.id);
    const wrong = structuredClone(document);
    wrong.parameters.width.parameterRefs = { mm: document.parameters.width.id };
    expect(() => importProjectText(JSON.stringify(wrong))).toThrow(
      /parameter binding/,
    );
  });
  it("rejects name collisions, unsafe names and unresolved-name capture without modifying history", () => {
    const document = createBoxTemplate();
    useCadStore.getState().setDocument(document);
    for (const name of ["height", "__proto__", "", "bad name"]) {
      useCadStore
        .getState()
        .updateParameter(document.parameters.width.id, { name });
      expect(useCadStore.getState().history.past).toHaveLength(0);
      expect(useCadStore.getState().fileError).toBeTruthy();
    }
    const invalid = upsertParameter(document, {
      id: "unresolved",
      name: "pending",
      expression: "width + span",
      value: 0,
      unit: "mm",
    });
    expect(() =>
      renameParameter(invalid, document.parameters.width.id, "span"),
    ).toThrow(/capture/);
    useCadStore
      .getState()
      .updateParameter(document.parameters.width.id, { name: "span" });
    expect(useCadStore.getState().history.present.parameters.span.id).toBe(
      document.parameters.width.id,
    );
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present.parameters.width.id).toBe(
      document.parameters.width.id,
    );
    useCadStore.getState().redo();
    expect(useCadStore.getState().history.present.parameters.span.id).toBe(
      document.parameters.width.id,
    );
  });
  it("rebinding an edited expression updates IDs rather than retaining stale dependencies", () => {
    const document = createBoxTemplate();
    useCadStore.getState().setDocument(
      upsertParameter(document, {
        id: "related",
        name: "related",
        expression: "width",
        value: 0,
        unit: "mm",
      }),
    );
    useCadStore
      .getState()
      .updateParameter("related", { expression: "height + 2mm" });
    expect(
      useCadStore.getState().history.present.parameters.related.parameterRefs,
    ).toEqual({ height: document.parameters.height.id });
  });
});
