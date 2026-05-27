import { describe, expect, it } from "vitest";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import { addCenterRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { buildTimelineItems } from "../ui/panels/FeatureTimeline";

describe("timeline ordering", () => {
  it("assigns monotonic timeline steps when sketches and features enter the document", () => {
    let document = createEmptyDocument();
    const sketch = addCenterRectangle(createXySketch("Base Sketch"), "20mm", "10mm");
    document = upsertSketch(document, sketch);
    const storedSketch = document.sketches[sketch.id];

    const feature = createExtrudeFeature({
      name: "Base Extrude",
      sketchId: sketch.id,
      profileId: "profile_1",
      operation: "newBody",
      distance: { expression: "10mm", unit: "mm" },
      direction: "positive",
    });
    document = upsertFeature(document, feature);
    const storedFeature = document.features[0];

    expect(storedSketch.timelineStep).toBe(1);
    expect(storedFeature.timelineStep).toBe(2);
    expect(document.timelineCursor).toBe(2);
  });

  it("uses explicit timeline steps before timestamps or dependency adjacency", () => {
    const sketch = { ...createXySketch("Second"), timelineStep: 20, createdAt: "2026-01-01T00:00:00.000Z" };
    const feature = createExtrudeFeature({
      name: "First",
      sketchId: sketch.id,
      profileId: "profile_1",
      operation: "newBody",
      distance: { expression: "10mm", unit: "mm" },
      direction: "positive",
    });
    const steppedFeature = { ...feature, timelineStep: 10, createdAt: "2026-02-01T00:00:00.000Z" };

    const items = buildTimelineItems([sketch], [steppedFeature]);

    expect(items.map((item) => (item.kind === "sketch" ? item.sketch.name : item.feature.name))).toEqual(["First", "Second"]);
  });

  it("keeps legacy timestamp fallback deterministic for unused sketches and features", () => {
    const unusedSketch = { ...createXySketch("Unused"), createdAt: undefined, timelineStep: undefined };
    const usedSketch = { ...createXySketch("Used"), createdAt: undefined, timelineStep: undefined };
    const feature = createExtrudeFeature({
      name: "Legacy Extrude",
      sketchId: usedSketch.id,
      profileId: "profile_1",
      operation: "newBody",
      distance: { expression: "10mm", unit: "mm" },
      direction: "positive",
    });
    const legacyFeature = { ...feature, createdAt: "2026-01-01T00:00:00.000Z", timelineStep: undefined };

    const items = buildTimelineItems([unusedSketch, usedSketch], [legacyFeature]);

    expect(items.map((item) => (item.kind === "sketch" ? item.sketch.name : item.feature.name))).toEqual([
      "Used",
      "Legacy Extrude",
      "Unused",
    ]);
  });

  it("keeps legacy timestamp fallback before explicit new steps with a transitive sort", () => {
    const timestampedSketch = { ...createXySketch("Timestamped"), createdAt: "2026-01-01T00:00:00.000Z", timelineStep: undefined };
    const steppedSketch = { ...createXySketch("Updated Legacy"), createdAt: undefined, timelineStep: 3 };

    const items = buildTimelineItems([timestampedSketch, steppedSketch], []);

    expect(items.map((item) => (item.kind === "sketch" ? item.sketch.name : item.feature.name))).toEqual([
      "Timestamped",
      "Updated Legacy",
    ]);
  });

  it("assigns the next step after the maximum legacy step without an extra gap", () => {
    let document = createEmptyDocument();
    const legacySketch = { ...createXySketch("Legacy"), timelineStep: 5 };
    document = {
      ...document,
      timelineCursor: undefined,
      sketches: { [legacySketch.id]: legacySketch },
    };

    const nextSketch = createXySketch("Next");
    document = upsertSketch(document, nextSketch);

    expect(document.sketches[nextSketch.id].timelineStep).toBe(6);
  });

  it("backfills all missing legacy steps before updating one legacy item", () => {
    let document = createEmptyDocument();
    const first = { ...createXySketch("First Legacy"), timelineStep: undefined, createdAt: "2026-01-01T00:00:00.000Z" };
    const second = { ...createXySketch("Second Legacy"), timelineStep: undefined, createdAt: "2026-01-02T00:00:00.000Z" };
    document = {
      ...document,
      timelineCursor: undefined,
      sketches: {
        [first.id]: first,
        [second.id]: second,
      },
    };

    document = upsertSketch(document, { ...second, name: "Second Updated" });

    expect(document.sketches[first.id].timelineStep).toBe(1);
    expect(document.sketches[second.id].timelineStep).toBe(2);
    expect(document.timelineCursor).toBe(2);
  });

  it("normalizes mixed legacy and stepped records into chronological order", () => {
    let document = createEmptyDocument();
    const legacySketch = { ...createXySketch("Legacy Sketch"), timelineStep: undefined, createdAt: "2026-01-01T00:00:00.000Z" };
    const steppedSketch = { ...createXySketch("Stepped Sketch"), timelineStep: 10, createdAt: "2026-01-02T00:00:00.000Z" };
    document = {
      ...document,
      timelineCursor: 10,
      sketches: {
        [legacySketch.id]: legacySketch,
        [steppedSketch.id]: steppedSketch,
      },
    };

    const nextSketch = createXySketch("Next Sketch");
    document = upsertSketch(document, nextSketch);

    expect(document.sketches[legacySketch.id].timelineStep).toBe(1);
    expect(document.sketches[steppedSketch.id].timelineStep).toBe(2);
    expect(document.sketches[nextSketch.id].timelineStep).toBe(3);
    expect(document.timelineCursor).toBe(3);
  });
});
