import { describe, expect, it } from "vitest";
import { addComponent, renameComponent } from "../cad/document/components";
import { bodyDisplayNames } from "../cad/document/bodyDisplayNames";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createBoxTemplate } from "../templates/templates";
import { buildStlExport } from "../fabrication/exportPlan";
import { safeFilename } from "../persistence/filenames";

function componentProject() {
  const added = addComponent(createBoxTemplate(), "Mount bracket");
  const document = {
    ...added.document,
    features: added.document.features.map((feature) => ({ ...feature, componentId: added.component.id })),
    sketches: Object.fromEntries(Object.entries(added.document.sketches).map(([id, sketch]) => [id, {
      ...sketch, componentId: added.component.id,
    }])),
  };
  return { document, componentId: added.component.id, result: rebuildDocument(document) };
}

describe("part display identities", () => {
  it("uses a single body's component name without changing native identities or authored history", () => {
    const { document, componentId, result } = componentProject();
    expect(result.success).toBe(true);
    const original = JSON.stringify({ document, result });
    expect(bodyDisplayNames(document, result.bodies)).toEqual({ [result.bodies[0].id]: "Mount bracket" });
    expect(JSON.stringify({ document, result })).toBe(original);
    expect(bodyDisplayNames(renameComponent(document, componentId, "New bracket"), result.bodies)[result.bodies[0].id]).toBe("New bracket");
    expect(result.bodies[0].name).toBe("Box Extrude");
  });

  it("distinguishes multiple bodies and duplicate component names deterministically, while retaining legacy root names", () => {
    const { document, componentId, result } = componentProject();
    const feature = document.features[0];
    const other = { ...feature, id: "second-feature", componentId };
    const next = { ...document, features: [...document.features, other] };
    const bodies = [...result.bodies, { id: "body:second-feature", name: "Box Extrude" }];
    const labels = bodyDisplayNames(next, bodies);
    expect(new Set(Object.values(labels)).size).toBe(2);
    expect(Object.values(labels).every((label) => label.startsWith("Mount bracket · Box Extrude"))).toBe(true);
    expect(bodyDisplayNames(next, [...bodies].reverse())).toEqual(labels);
    const duplicated = addComponent(document, "Mount bracket");
    const duplicateDocument = { ...duplicated.document, features: [...document.features, { ...other, componentId: duplicated.component.id }] };
    expect(new Set(Object.values(bodyDisplayNames(duplicateDocument, bodies))).size).toBe(2);
    const legacy = createBoxTemplate();
    const legacyResult = rebuildDocument(legacy);
    expect(bodyDisplayNames(legacy, legacyResult.bodies)[legacyResult.bodies[0].id]).toBe("Box Extrude");
  });

  it("exports the chosen component identity as a safe single STL filename with unchanged mesh coordinates", () => {
    const { document, result } = componentProject();
    const names = bodyDisplayNames(document, result.bodies);
    const output = buildStlExport(result.meshes, result.bodies, document.name, "separate", true, names);
    expect(output.file.filename).toBe("Mount_bracket.stl");
    expect(new DataView(output.file.bytes).getUint32(80, true)).toBe(result.meshes[0].indices.length / 3);
    const prior = buildStlExport(result.meshes, result.bodies, document.name, "separate");
    expect(new Uint8Array(output.file.bytes)).toEqual(new Uint8Array(prior.file.bytes));
    const restricted = safeFilename(`${"Very long name ".repeat(50)}CON/../`, ".stl");
    expect(restricted.length).toBeLessThanOrEqual(180);
    expect(restricted).not.toMatch(/[\\/]/);
  });

  it("keeps ZIP and selected-body names consistent when component labels repeat and meshes arrive in another order", () => {
    const { document, result } = componentProject();
    const added = addComponent(document, "Mount bracket");
    const second = { ...document.features[0], id: "second", componentId: added.component.id };
    const next = { ...added.document, features: [...document.features, second] };
    const body = { ...result.bodies[0], id: "body:second" };
    const bodies = [...result.bodies, body];
    const mesh = { ...result.meshes[0], bodyId: body.id,
      positions: Array.from(result.meshes[0].positions, (value, i) => value + (i % 3 === 0 ? 100 : 0)),
    };
    const names = bodyDisplayNames(next, bodies);
    const exportResult = buildStlExport([mesh, ...result.meshes], bodies, next.name, "separate", true, names);
    const view = new DataView(exportResult.file.bytes);
    const filenames: string[] = [];
    for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
      const size = view.getUint32(offset + 18, true);
      const length = view.getUint16(offset + 26, true);
      filenames.push(new TextDecoder().decode(new Uint8Array(exportResult.file.bytes, offset + 30, length)));
      offset += 30 + length + view.getUint16(offset + 28, true) + size;
    }
    expect(filenames).toEqual([safeFilename(names[body.id], ".stl"), safeFilename(names[result.bodies[0].id], ".stl")]);
    expect(new Set(filenames).size).toBe(2);
    const selected = buildStlExport([mesh], [body], next.name, "separate", true, names);
    expect(selected.file.filename).toBe(filenames[0]);
    expect(new DataView(selected.file.bytes).getFloat32(96, true)).toBeCloseTo(result.meshes[0].positions[result.meshes[0].indices[0] * 3] + 100);
    const collidingNames = { [result.bodies[0].id]: "Mount/bracket", [body.id]: "Mount:bracket" };
    const all = buildStlExport([mesh, ...result.meshes], bodies, next.name, "separate", true, collidingNames);
    const one = buildStlExport([mesh], [body], next.name, "separate", true, collidingNames);
    const zipView = new DataView(all.file.bytes);
    expect(one.file.filename).toBe(new TextDecoder().decode(new Uint8Array(all.file.bytes, 30, zipView.getUint16(26, true))));
  });
});
