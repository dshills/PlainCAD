import { describe, expect, it } from "vitest";
import { timelineStoryDocuments, timelineFeatureIntent } from "../cad/document/timelineStory";
import { createBoxTemplate } from "../templates/templates";
import { changedStoryBodies, nativeStoryGeometry } from "../ui/timeline/timelineStoryProof";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";

const mesh: RenderMesh = { id: "mesh", bodyId: "body", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], geometrySource: "opencascade", geometryAssertions: { valid: true, volume: 20, solidCount: 1, surfaceArea: 12 }, bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
const result = (meshes: RenderMesh[]): RebuildResult => ({ documentId: "project", success: true, bodies: [], meshes, errors: [], warnings: [], durationMs: 1 });

describe("native timeline story boundaries", () => {
  it("uses canonical timeline order, excluding future sketch dependencies without changing authored data", () => {
    const document = createBoxTemplate();
    const feature = document.features[0];
    document.features[0] = { ...feature, timelineStep: 2 };
    const sketch = document.sketches[(feature as { sketchId: string }).sketchId];
    document.sketches[sketch.id] = { ...sketch, timelineStep: 1 };
    document.sketches.future = { ...sketch, id: "future", timelineStep: 3, plane: { type: "face", featureId: "not-created", stableFaceId: "lost" } };
    const original = JSON.stringify(document);
    const snapshots = timelineStoryDocuments(document, feature.id);
    expect(snapshots.before.features).toEqual([]);
    expect(snapshots.after.features).toEqual([document.features[0]]);
    expect(Object.keys(snapshots.before.sketches)).toEqual([sketch.id]);
    expect(Object.keys(snapshots.after.sketches)).toEqual([sketch.id]);
    expect(JSON.stringify(document)).toBe(original);
    expect(snapshots.after.sketches[sketch.id]).toBe(document.sketches[sketch.id]);
  });
  it("rejects deleted targets and bounds history work", () => {
    const document = createBoxTemplate();
    expect(() => timelineStoryDocuments(document, "deleted")).toThrow(/no longer exists/);
    document.features = Array.from({ length: 162 }, (_, i) => ({ ...document.features[0], id: `feature${i}`, timelineStep: i + 2 }));
    expect(timelineStoryDocuments(document, "feature158").after.timelineCursor).toBe(160);
    expect(() => timelineStoryDocuments(document, "feature159")).toThrow(/160 timeline/);
  });
  it("keeps user names while describing subtractive intent and suppressed geometry honestly", () => {
    const feature = createBoxTemplate().features[0];
    expect(timelineFeatureIntent({ ...feature, name: "My named wall", operation: "cut" } as typeof feature)).toBe("Cut a sketch profile");
    expect(timelineFeatureIntent({ ...feature, suppressed: true })).toMatch(/unchanged/);
  });
  it("rejects failed, fallback, invalid-volume and oversized meshes rather than drawing pretend solids", () => {
    expect(() => nativeStoryGeometry({ ...result([mesh]), success: false, errors: [{ id: "failure", source: "feature", message: "Repair the cut" }] }, "After")).toThrow(/Repair the cut/);
    expect(() => nativeStoryGeometry(result([{ ...mesh, geometrySource: "fallback" }]), "Before")).toThrow(/validated native/);
    expect(() => nativeStoryGeometry(result([{ ...mesh, geometryAssertions: { ...mesh.geometryAssertions!, volume: NaN } }]), "After")).toThrow(/validated native/);
    expect(() => nativeStoryGeometry(result([{ ...mesh, indices: Array(75003).fill(0) }]), "After")).toThrow(/25,000/);
    expect(nativeStoryGeometry(result([]), "Before")).toEqual({ meshes: [], volume: 0, solids: 0 });
  });
  it("compares geometry rather than only feature metadata or volume", () => {
    const before = nativeStoryGeometry(result([mesh]), "Before");
    expect(changedStoryBodies(before, nativeStoryGeometry(result([mesh]), "After")).size).toBe(0);
    expect(changedStoryBodies(before, nativeStoryGeometry(result([{ ...mesh, positions: [0, 0, 0, 0, 1, 0, 1, 0, 0] }]), "After"))).toEqual(new Set(["body"]));
    expect(changedStoryBodies(before, nativeStoryGeometry(result([{ ...mesh, indices: [1, 0, 2] }]), "After"))).toEqual(new Set(["body"]));
    expect(changedStoryBodies(nativeStoryGeometry(result([]), "Before"), before)).toEqual(new Set(["body"]));
  });
});
