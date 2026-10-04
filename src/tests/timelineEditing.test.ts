import { describe, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { createXySketch } from "../cad/sketch/SketchModel";
import { upsertFeature, upsertSketch } from "../cad/document/CadDocument";
import {
  moveTimelineItem,
  planTimelineMove,
  timelineDependencyErrors,
  upstreamBodyOwners,
} from "../cad/document/timelineEditing";
import {
  documentTimeline,
  timelineItemId,
} from "../cad/document/timelineOrdering";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import {
  runCommand,
  selectCommandEnablement,
} from "../ui/commands/commandRegistry";
import { createExtrudeEdgeRef } from "../cad/features/topologyRefs";
import { validateDocument } from "../cad/document/validate";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/projectCodec";

describe("dependency-validated timeline editing", () => {
  it("uses the displayed ordering for legacy face/body dependencies without raw steps", () => {
    const base = createBoxTemplate();
    const owner = base.features[0];
    const source = Object.values(base.sketches)[0];
    const attached = {
      ...createXySketch("Attached"),
      timelineStep: undefined,
      createdAt: "2026-01-03T00:00:00.000Z",
      plane: {
        type: "face" as const,
        featureId: owner.id,
        stableFaceId: `extrude:${owner.id}:endCap`,
      },
    };
    const legacy = {
      ...base,
      timelineCursor: undefined,
      sketches: {
        [source.id]: {
          ...source,
          timelineStep: undefined,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        [attached.id]: attached,
      },
      features: [
        {
          ...owner,
          timelineStep: undefined,
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    };
    expect(timelineDependencyErrors(legacy)).toEqual([]);
  });

  it.each(["hole", "revolve"] as const)(
    "keeps a well-typed missing-sketch %s editable while rejecting its rebuild",
    (type) => {
      const base = createBoxTemplate();
      const common = { id: "broken", name: "Broken", sketchId: "lost-sketch" };
      const feature =
        type === "hole"
          ? {
              ...common,
              type,
              targetBodyId: `body:${base.features[0].id}`,
              centerPointIds: ["lost-point"],
              diameter: { expression: "2mm", unit: "mm" },
              depth: "throughAll" as const,
            }
          : {
              ...common,
              type,
              profileId: "lost-profile",
              operation: "newBody" as const,
              angle: { expression: "90deg", unit: "deg" },
              axis: { type: "origin" as const, axis: "Y" as const },
            };
      const reopened = importProjectText(
        serializeProject(upsertFeature(base, feature)),
      );
      expect(validateDocument(reopened, "storage")).toEqual([]);
      expect(
        validateDocument(reopened).some((e) =>
          /missing sketch/.test(e.message),
        ),
      ).toBe(true);
      expect(rebuildDocument(reopened).success).toBe(false);
    },
  );
  it("opens and saves broken feature references without accepting malformed fields or allowing exportable modeling", () => {
    const document = createBoxTemplate();
    const feature = document.features[0];
    if (feature.type !== "extrude") throw new Error("Expected box extrusion");
    for (const patch of [
      { sketchId: "lost-sketch" },
      { profileId: "lost-profile" },
      { operation: "cut" as const, targetBodyIds: [] },
      { operation: "cut" as const, targetBodyIds: ["body:lost"] },
    ]) {
      const broken = upsertFeature(document, { ...feature, ...patch });
      const reopened = importProjectText(serializeProject(broken));
      expect(reopened.features).toMatchObject(broken.features);
      expect(rebuildDocument(reopened).success).toBe(false);
    }
    expect(() =>
      importProjectText(
        JSON.stringify({
          ...document,
          features: [{ ...feature, sketchId: 42 }],
        }),
      ),
    ).toThrow(/Sketch reference must be an ID/);
  });
  it("moves across independent items with stable IDs, geometry, timestamps, save/open and undo/redo", () => {
    const base = createBoxTemplate();
    const spare = createXySketch("Independent");
    const document = upsertSketch(base, spare);
    const feature = document.features[0];
    const selection = {
      kind: "feature" as const,
      id: feature.id,
      documentId: document.id,
    };
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select(selection);
    const before = useCadStore.getState().history.present;
    const bounds = rebuildDocument(before).meshes[0].bounds;
    expect(selectCommandEnablement(useCadStore.getState()).moveLater).toBe(
      true,
    );
    runCommand("timeline.moveLater");
    const moved = useCadStore.getState().history.present;
    expect(documentTimeline(moved).map(timelineItemId)).toEqual([
      Object.values(base.sketches)[0].id,
      spare.id,
      feature.id,
    ]);
    expect(moved.features[0].createdAt).toBe(feature.createdAt);
    expect(moved.features[0].id).toBe(feature.id);
    expect(rebuildDocument(moved).meshes[0].bounds).toEqual(bounds);
    expect(importProjectText(serializeProject(moved)).features).toEqual(
      moved.features,
    );
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(before);
    useCadStore.getState().redo();
    expect(useCadStore.getState().history.present).toBe(moved);
  });

  it("blocks crossing a required sketch and leaves command execution/history unchanged", () => {
    const document = createBoxTemplate(),
      feature = document.features[0];
    const selection = {
      kind: "feature" as const,
      id: feature.id,
      documentId: document.id,
    };
    expect(planTimelineMove(document, selection, "earlier").reason).toMatch(
      /required sketch/,
    );
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select(selection);
    const before = useCadStore.getState().history.present;
    expect(selectCommandEnablement(useCadStore.getState()).moveEarlier).toBe(
      false,
    );
    runCommand("timeline.moveEarlier");
    expect(useCadStore.getState().history.present).toBe(before);
    expect(useCadStore.getState().history.past).toHaveLength(0);
  });

  it("checks body, face-plane, termination-face and edge owners, including modified face dependencies", () => {
    const base = createBoxTemplate(),
      owner = base.features[0];
    if (owner.type !== "extrude") throw new Error("Expected box extrusion");
    const consumer = {
      ...owner,
      id: "consumer",
      name: "Consumer",
      operation: "cut" as const,
      targetBodyIds: [`body:${owner.id}`],
      timelineStep: 1.5,
    };
    expect(
      timelineDependencyErrors(upsertFeature(base, consumer)).join(" "),
    ).toMatch(/target body owner/);
    const sketch = {
      ...createXySketch("Attached"),
      timelineStep: 1.5,
      plane: {
        type: "offset" as const,
        base: {
          type: "face" as const,
          featureId: owner.id,
          stableFaceId: `extrude:${owner.id}:endCap`,
        },
        offset: { expression: "1mm", unit: "mm" },
      },
    };
    expect(
      timelineDependencyErrors(upsertSketch(base, sketch)).join(" "),
    ).toMatch(/sketch plane owner/);
    expect(
      timelineDependencyErrors(
        upsertFeature(base, {
          ...consumer,
          operation: "newBody",
          targetBodyIds: [],
          termination: {
            type: "toFace",
            faceRef: { featureId: owner.id, kind: "face", transientId: "end" },
          },
        }),
      ).join(" "),
    ).toMatch(/termination face owner/);
    expect(
      timelineDependencyErrors(
        upsertFeature(base, {
          id: "edge",
          type: "fillet",
          name: "Round",
          timelineStep: 1.5,
          radius: { expression: "1mm", unit: "mm" },
          targetEdgeRefs: [createExtrudeEdgeRef(owner.id, "endCapPerimeter")],
        }),
      ).join(" "),
    ).toMatch(/edge owner/);
    let modified = upsertFeature(base, { ...consumer, timelineStep: 3 });
    modified = upsertSketch(modified, { ...sketch, timelineStep: 4 });
    expect(timelineDependencyErrors(modified)).toEqual([]);
  });

  it("preserves the order of same-body modifiers and rejects missing or future target owners", () => {
    const base = createBoxTemplate(),
      owner = base.features[0];
    if (owner.type !== "extrude") throw new Error("Expected box extrusion");
    let document = upsertFeature(base, {
      ...owner,
      id: "cutA",
      name: "First cut",
      timelineStep: undefined,
      operation: "cut",
      targetBodyIds: [`body:${owner.id}`],
    });
    document = upsertFeature(document, {
      ...owner,
      id: "cutB",
      name: "Second cut",
      operation: "cut",
      targetBodyIds: [`body:${owner.id}`],
      timelineStep: undefined,
    });
    const second = document.features.find((f) => f.id === "cutB")!;
    expect(
      planTimelineMove(
        document,
        { kind: "feature", id: second.id, documentId: document.id },
        "earlier",
      ).reason,
    ).toMatch(/existing order/);
    expect(upstreamBodyOwners(document, second).map((f) => f.id)).toEqual([
      owner.id,
    ]);
    expect(
      timelineDependencyErrors(
        upsertFeature(document, {
          ...owner,
          id: "lost",
          operation: "cut",
          targetBodyIds: ["body:missing"],
          timelineStep: undefined,
        }),
      ).join(" "),
    ).toMatch(/target reference lost/);
    expect(() =>
      moveTimelineItem(
        document,
        { kind: "feature", id: owner.id, documentId: "other" },
        "later",
      ),
    ).toThrow(/Select/);
  });
});
