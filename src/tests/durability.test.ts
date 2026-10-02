import { describe, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { serializeProject } from "../persistence/exportProject";
import {
  importProjectFile,
  importProjectText,
} from "../persistence/importProject";
import {
  PROJECT_IMPORT_LIMITS,
  parseProjectJson,
} from "../persistence/importSafety";
import { recoveryCandidates, recoverSnapshot } from "../persistence/autosave";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { createExtrudeEdgeRef } from "../cad/features/topologyRefs";
import { MODEL_RESOURCE_LIMITS } from "../cad/resourceLimits";
import { planFeatureGraph } from "../cad/features/featureGraph";
import { useCadStore } from "../state/useCadStore";
import { runCommand } from "../ui/commands/commandRegistry";

describe("durability and resource boundaries", () => {
  it("rejects malformed known fields before they can crash rendering or modeling", () => {
    const box = createBoxTemplate();
    for (const mutate of [
      (d: any) => {
        Object.values<any>(d.sketches)[0].name = { bad: true };
      },
      (d: any) => {
        d.features[0].name = { bad: true };
      },
      (d: any) => {
        d.parameters.width.expression = {};
      },
      (d: any) => {
        d.parameters.width.locked = "true";
      },
      (d: any) => {
        d.features[0].distance.expression = [];
      },
      (d: any) => {
        d.unitSettings.length = "yard";
      },
      (d: any) => {
        d.viewState = { cameraTarget: [{}, 0, 0] };
      },
      (d: any) => {
        d.features[0].termination = { type: "mystery" };
      },
      (d: any) => {
        d.features[0] = {
          ...d.features[0],
          type: "revolve",
          axis: { type: "mystery" },
          angle: { expression: "360deg", unit: "deg" },
        };
      },
    ]) {
      const malformed = structuredClone(box);
      mutate(malformed);
      expect(() => importProjectText(JSON.stringify(malformed))).toThrow();
    }
  });
  it("checks true UTF8 bytes and nesting before the JSON reviver", () => {
    expect(() =>
      parseProjectJson(
        '"' + "é".repeat(PROJECT_IMPORT_LIMITS.maxBytes / 2) + '"',
      ),
    ).toThrow(/too large/);
    expect(() =>
      parseProjectJson("[".repeat(20000) + "0" + "]".repeat(20000)),
    ).toThrow(/nested too deeply/);
    expect(parseProjectJson(JSON.stringify({ text: '[ { " \\ ] }' }))).toEqual({
      text: '[ { " \\ ] }',
    });
  });
  it("rejects oversized files without reading them and honors cancellation", async () => {
    const text = vi.fn();
    await expect(
      importProjectFile({
        size: PROJECT_IMPORT_LIMITS.maxBytes + 1,
        text,
      } as unknown as File),
    ).rejects.toThrow(/too large/);
    expect(text).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(
      importProjectFile(
        { size: 1, text } as unknown as File,
        controller.signal,
      ),
    ).rejects.toThrow(/cancelled/);
    expect(text).not.toHaveBeenCalled();
  });
  it("never replaces the current document on failed import", async () => {
    const before = useCadStore.getState().history.present;
    await runCommand("file.openProject", {
      file: { size: 4, text: async () => "oops" } as File,
    });
    expect(useCadStore.getState().history.present).toBe(before);
    expect(useCadStore.getState().fileError).toMatch(/not valid JSON/);
  });
  it("limits individual solver intent and feature dependency chains", () => {
    const document = createBoxTemplate(),
      sketch = Object.values(document.sketches)[0];
    const invalid = {
      ...document,
      sketches: {
        [sketch.id]: {
          ...sketch,
          constraints: Array(
            PROJECT_IMPORT_LIMITS.maxConstraintsAndDimensionsPerSketch + 1,
          ).fill({ id: "c", type: "fixed", entityIds: [] }),
        },
      },
    };
    expect(() => importProjectText(JSON.stringify(invalid))).toThrow(
      /too many constraints/,
    );
    const base = document.features[0];
    const features = [
      base,
      ...Array.from(
        { length: MODEL_RESOURCE_LIMITS.maxFeatureDependencyDepth },
        (_, i) => ({
          ...base,
          id: `cut-${i}`,
          operation: "cut" as const,
          targetBodyIds: [`body:${base.id}`],
          timelineStep: 3 + i,
        }),
      ),
    ];
    expect(planFeatureGraph({ ...document, features }).errors).toContainEqual(
      expect.objectContaining({
        sourceId: `cut-${MODEL_RESOURCE_LIMITS.maxFeatureDependencyDepth - 1}`,
        message: expect.stringMatching(/dependency chain/),
      }),
    );
  });
  it("offers only genuinely unsaved newer snapshots and migrates recovery atomically", () => {
    const document = createBoxTemplate(),
      text = serializeProject(document, false),
      manual = { text, savedAt: 2, name: document.name, schemaVersion: 7 },
      edited = {
        ...manual,
        text: serializeProject({ ...document, name: "Edited" }, false),
        savedAt: 3,
      };
    expect(
      recoveryCandidates([{ id: document.id, latest: manual, manual }]),
    ).toEqual([]);
    expect(
      recoveryCandidates([
        { id: document.id, latest: { ...edited, savedAt: 1 }, manual },
      ]),
    ).toEqual([]);
    const record = {
      id: document.id,
      latest: edited,
      previous: manual,
      manual,
    };
    expect(recoveryCandidates([record])).toEqual([record]);
    expect(recoverSnapshot(record).name).toBe("Edited");
    expect(recoverSnapshot(record, true).name).toBe(document.name);
    expect(() => recoverSnapshot({ ...record, id: "different" })).toThrow(
      /identity/,
    );
    expect(() =>
      recoverSnapshot({ ...record, latest: { ...edited, text: "corrupt" } }),
    ).toThrow(/not valid JSON/);
    expect(recoverSnapshot(record, true)).toEqual(importProjectText(text));
  });
  it("strips unknown fields from topology references and rejects malformed termination intent", () => {
    const document = createEmptyDocument(),
      box = createBoxTemplate(),
      feature = box.features[0];
    const imported = importProjectText(
      JSON.stringify({
        ...box,
        features: [
          feature,
          {
            id: "round",
            name: "Round",
            type: "fillet",
            targetEdgeRefs: [
              {
                ...createExtrudeEdgeRef(feature.id, "endCapPerimeter"),
                kernelHandle: { bad: true },
              },
            ],
            radius: { expression: "1mm", unit: "mm" },
          },
        ],
      }),
    );
    expect(JSON.stringify(imported)).not.toMatch(/kernelHandle/);
    expect(() =>
      importProjectText(
        JSON.stringify({
          ...box,
          features: [
            {
              ...feature,
              termination: { type: "toFace", faceRef: { featureId: 123 } },
            },
          ],
        }),
      ),
    ).toThrow(/malformed to-face/);
    const cyclic: Record<string, unknown> = {};
    cyclic.loop = cyclic;
    expect(() => serializeProject({ ...document, metadata: cyclic })).toThrow(
      /nested too deeply/,
    );
  });
  it("bounds live bodies before constructing another solid", () => {
    const document = createBoxTemplate(),
      base = document.features[0];
    const features = Array.from(
      { length: MODEL_RESOURCE_LIMITS.maxBodies + 1 },
      (_, i) => ({ ...base, id: `body-owner-${i}`, timelineStep: 2 + i }),
    );
    const result = rebuildDocument({ ...document, features });
    expect(result.success).toBe(false);
    expect(result.bodies).toHaveLength(MODEL_RESOURCE_LIMITS.maxBodies);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        sourceId: `body-owner-${MODEL_RESOURCE_LIMITS.maxBodies}`,
        message: expect.stringMatching(/body resource limit/),
      }),
    );
  });
});
