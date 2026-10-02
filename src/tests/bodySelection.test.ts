import { describe, expect, it } from "vitest";
import { selectFabricationBodies } from "../fabrication/bodySelection";
import { createBoxMesh } from "../cad/kernel/meshConversion";
import { buildStlExport } from "../fabrication/exportPlan";
import { useViewerState } from "../state/viewerState";
import { createBoxTemplate } from "../templates/templates";
import { rebuildDocument } from "../cad/features/rebuildGraph";

describe("explicit export body scope", () => {
  it("exports only the selected body in global coordinates and rejects stale or ambiguous scope", () => {
    const a = createBoxMesh("a", 4, 4, 4);
    const b = {
      ...a,
      bodyId: "b",
      positions: Array.from(a.positions, (v, i) => v + (i % 3 === 0 ? 100 : 0)),
    };
    const bodies = [
      { id: "a", name: "First" },
      { id: "b", name: "Second" },
    ];
    const selected = selectFabricationBodies([a, b], bodies, ["b"]);
    expect(selected.meshes).toEqual([b]);
    expect(selected.bodies).toEqual([bodies[1]]);
    const bytes = buildStlExport(
      selected.meshes,
      selected.bodies,
      "selected",
      "separate",
    ).file.bytes;
    const view = new DataView(bytes),
      count = view.getUint32(80, true);
    const xs = Array.from({ length: count }, (_, i) =>
      [0, 12, 24].map((offset) => view.getFloat32(96 + i * 50 + offset, true)),
    ).flat();
    expect(count).toBe(12);
    expect(Math.min(...xs)).toBe(98);
    expect(Math.max(...xs)).toBe(102);
    for (const ids of [[], ["a", "a"], ["lost"]])
      expect(() => selectFabricationBodies([a, b], bodies, ids)).toThrow();
    expect(selectFabricationBodies([a, b], bodies).meshes).toHaveLength(2);
  });
  it("rejects unavailable union bodies rather than silently unioning everything", () => {
    const result = rebuildDocument(createBoxTemplate(), {
      exportUnion: true,
      exportBodyIds: ["lost"],
    });
    expect(result.success).toBe(false);
    expect(
      result.errors.some(
        (error) => error.source === "export" && /selection/.test(error.message),
      ),
    ).toBe(true);
  });
  it("keeps runtime visibility isolated by project session even when IDs are reused", () => {
    useViewerState.getState().showAll(1);
    useViewerState.getState().toggleBody(1, "a", ["a"]);
    expect(useViewerState.getState().hiddenBodyIds).toEqual(["a"]);
    useViewerState.getState().toggleBody(2, "b", ["b"]);
    expect(useViewerState.getState().hiddenBodyIds).toEqual(["b"]);
    useViewerState.getState().showAll(2);
    expect(useViewerState.getState().hiddenBodyIds).toEqual([]);
  });
});
