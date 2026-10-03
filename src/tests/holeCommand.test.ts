import { beforeEach, describe, expect, it } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { createEmptyDocument, upsertSketch } from "../cad/document/CadDocument";
import { addPoint, createXySketch } from "../cad/sketch/SketchModel";
import { useCadStore } from "../state/useCadStore";
import { evaluateExpressionRef, evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import {
  beginHoleCreation,
  createHole,
  holeCreationContext,
  useHoleDraft,
} from "../ui/commands/holeCommand";

describe("explicit hole creation guards", () => {
  beforeEach(() => {
    useHoleDraft.setState({ draft: undefined });
  });
  it("requires current native analysis, explicit center/target choices and preserves history on stale or invalid submissions", () => {
    const center = addPoint(createXySketch("Centers"), "0mm", "0mm"),
      document = upsertSketch(createBoxTemplate(), center.sketch);
    useCadStore.getState().setDocument(document);
    useCadStore.getState().select({
      kind: "sketch",
      id: center.sketch.id,
      documentId: document.id,
    });
    expect(holeCreationContext(useCadStore.getState())).toBeUndefined();
    const result = rebuildDocument(useCadStore.getState().history.present);
    // Command-only fixture; browser acceptance proves geometry with the native kernel.
    useCadStore.setState({
      rebuild: {
        kernelReady: true,
        status: "succeeded",
        result: {
          ...result,
          meshes: result.meshes.map((m) => ({
            ...m,
            geometrySource: "opencascade",
            geometryAssertions: {
              valid: true,
              volume: 80000,
              solidCount: 1,
              surfaceArea: 13200,
            },
          })),
        },
      },
    });
    beginHoleCreation();
    expect(useHoleDraft.getState().draft?.centerPointIds).toEqual([]);
    const input = {
      name: "Drill",
      targetBodyId: `body:${document.features[0].id}`,
      centerPointIds: [center.pointId],
      diameter: "4mm",
      depth: "5mm",
      throughAll: true,
    };
    expect(createHole({ ...input, centerPointIds: [] })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("center point"),
    });
    expect(createHole({ ...input, targetBodyId: "body:lost" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("target body"),
    });
    expect(createHole({ ...input, diameter: "-1mm" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("diameter"),
    });
    expect(
      createHole({ ...input, throughAll: false, depth: "3deg" }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("depth") });
    expect(useCadStore.getState().history.past).toHaveLength(0);
    expect(
      createHole({ ...input, diameter: "4", depth: "5", throughAll: false }).ok,
    ).toBe(true);
    const authored = useCadStore.getState().history.present;
    const hole = authored.features.find((f) => f.type === "hole")!;
    expect(hole.diameter).toMatchObject({
      expression: "4",
      authoredUnit: "mm",
    });
    expect(hole.depth).toMatchObject({ expression: "5", authoredUnit: "mm" });
    const changed = importProjectText(
      serializeProject({
        ...authored,
        unitSettings: { length: "in", angle: "rad" },
      }),
    );
    expect(evaluateParameters(changed.parameters).errors).toEqual([]);
    expect(evaluateExpressionRef(hole.diameter, { parameters: {} }).quantity?.value).toBe(4);
    expect(hole.depth !== "throughAll" && evaluateExpressionRef(hole.depth, { parameters: {} }).quantity?.value).toBe(5);
    // The new feature keeps its captured mm sizing after defaults change and save/open.
    expect(changed.features.find((f) => f.type === "hole")).toMatchObject({
      diameter: { authoredUnit: "mm" },
      depth: { authoredUnit: "mm" },
    });
    useCadStore.getState().undo();
    beginHoleCreation();

    useCadStore.setState({
      rebuild: { ...useCadStore.getState().rebuild, status: "queued" },
    });
    expect(holeCreationContext(useCadStore.getState())).toBeUndefined();
    expect(createHole(input).ok).toBe(false);
    useCadStore.getState().setDocument(createEmptyDocument());
    expect(createHole(input).ok).toBe(false);
    expect(useCadStore.getState().history.present.features).toEqual([]);
  });
});
