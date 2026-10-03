import { createElement } from "react";
import { render, screen, act } from "@testing-library/react";
import { CommandPalette } from "../ui/commands/CommandPalette";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { captureRequest } = vi.hoisted(() => ({ captureRequest: vi.fn() }));
vi.mock("../cad/worker/scopeCaptureClient", () => ({
  captureTargetScope: captureRequest,
}));
import { createBoxTemplate } from "../templates/templates";
import { upsertFeature, upsertParameter } from "../cad/document/CadDocument";
import {
  prepareScopeCapture,
  scopeFeatureFromDocument,
} from "../cad/features/targetScopeCapture";
import { OpenCascadeKernel } from "../cad/kernel/OpenCascadeKernel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { useCadStore } from "../state/useCadStore";
import {
  canCaptureTargetScope,
  captureSelectedTargetScope,
  useTargetScopeCapture,
} from "../ui/commands/targetScopeCaptureCommand";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";

function fixture() {
  let document = createBoxTemplate();
  const owner = document.features[0];
  if (owner.type !== "extrude") throw new Error("Expected extrusion");
  document = upsertFeature(document, {
    ...owner,
    id: "second",
    timelineStep: undefined,
  });
  const scope = {
    ...owner,
    id: "scope",
    name: "Scoped cut",
    timelineStep: undefined,
    operation: "cut" as const,
    targetBodyIds: [],
  };
  document = upsertFeature(document, scope);
  document = upsertFeature(document, {
    ...owner,
    id: "downstream",
    timelineStep: undefined,
  });
  return { document, scope, ids: [`body:${owner.id}`, "body:second"] };
}
describe("explicit target scope capture", () => {
  beforeEach(() => {
    captureRequest.mockReset();
    useTargetScopeCapture.setState({
      busy: false,
      progress: undefined,
      error: undefined,
      featureId: undefined,
    });
  });
  it("probes only upstream surviving bodies, replaces lost scopes and does not model or mutate the authored feature", () => {
    const { document, scope, ids } = fixture();
    const authored = { ...scope, targetBodyIds: ["body:lost"] };
    const probe = prepareScopeCapture(document, authored);
    expect(probe.features.map((f) => f.id)).toEqual([
      document.features[0].id,
      "second",
      "scope",
    ]);
    expect(probe.features[2]).toMatchObject({ targetBodyIds: ids });
    const intersection = vi
      .spyOn(OpenCascadeKernel.prototype, "hasCommonVolume")
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    try {
      const result = rebuildDocument(probe, {
        captureTargetScopeFeatureId: scope.id,
      });
      expect(result.success).toBe(true);
      expect(result.capturedTargetBodyIds).toEqual([ids[0]]);
      expect(result.meshes).toHaveLength(2);
      expect(
        result.meshes.every((mesh) => mesh.kernelOperation !== "cut"),
      ).toBe(true);
      expect(document.features.find((f) => f.id === scope.id)).toMatchObject({
        targetBodyIds: [],
      });
    } finally {
      intersection.mockRestore();
    }
  });
  it("looks up the feature in a validated document and rejects malformed scope data before kernel initialization", () => {
    const { document, scope } = fixture();
    expect(scopeFeatureFromDocument(document, scope.id)).toBe(
      document.features.find((f) => f.id === scope.id),
    );
    expect(() => scopeFeatureFromDocument(document, "lost")).toThrow(
      /active cut/,
    );
    expect(() =>
      scopeFeatureFromDocument(document, document.features[0].id),
    ).toThrow(/active cut/);
    const malformed = {
      ...document,
      features: document.features.map((f) =>
        f.id === scope.id ? { ...f, targetBodyIds: Array(65).fill("x") } : f,
      ),
    };
    expect(() => scopeFeatureFromDocument(malformed, scope.id)).toThrow(
      /target body references/,
    );
  });
  it("returns an empty probe when all through-all candidates lie behind the sweep without invoking a boolean", () => {
    const { document, scope } = fixture();
    const feature = {
      ...scope,
      direction: "negative" as const,
      termination: { type: "throughAll" as const },
    };
    const probe = prepareScopeCapture(document, feature);
    const intersection = vi.spyOn(
      OpenCascadeKernel.prototype,
      "hasCommonVolume",
    );
    try {
      const result = rebuildDocument(probe, {
        captureTargetScopeFeatureId: scope.id,
      });
      expect(result.success).toBe(true);
      expect(result.capturedTargetBodyIds).toEqual([]);
      expect(result.meshes).toHaveLength(2);
      expect(intersection).not.toHaveBeenCalled();
    } finally {
      intersection.mockRestore();
    }
  });
  it("preserves a join's existing primary identity in the candidate ordering", () => {
    const { document, scope, ids } = fixture();
    const probe = prepareScopeCapture(document, {
      ...scope,
      operation: "join",
      targetBodyIds: [ids[1], ids[0]],
    });
    expect(probe.features[2]).toMatchObject({
      targetBodyIds: [ids[1], ids[0]],
    });
  });
  it("saves captured IDs as one undoable edit and never expands the scope when another body is inserted", async () => {
    const { document, scope, ids } = fixture();
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "feature", id: scope.id, documentId: document.id });
    useCadStore.setState({
      rebuild: { ...useCadStore.getState().rebuild, kernelReady: true },
    });
    const before = useCadStore.getState().history.present;
    captureRequest.mockResolvedValue(ids);
    expect(canCaptureTargetScope(useCadStore.getState())).toBe(true);
    await captureSelectedTargetScope();
    const captured = useCadStore.getState().history.present;
    expect(captured.features.find((f) => f.id === scope.id)).toMatchObject({
      targetBodyIds: ids,
    });
    expect(
      importProjectText(serializeProject(captured)).features.find(
        (f) => f.id === scope.id,
      ),
    ).toMatchObject({ targetBodyIds: ids });
    useCadStore.getState().undo();
    expect(useCadStore.getState().history.present).toBe(before);
    useCadStore.getState().redo();
    expect(useCadStore.getState().history.present).toBe(captured);
    useCadStore.getState().updateDocument((d) => {
      const step = d.features.find((f) => f.id === scope.id)!.timelineStep!;
      const shifted = {
        ...d,
        timelineCursor: (d.timelineCursor ?? 0) + 1,
        features: d.features.map((f) =>
          f.timelineStep! >= step
            ? { ...f, timelineStep: f.timelineStep! + 1 }
            : f,
        ),
      };
      return upsertFeature(shifted, {
        ...document.features[0],
        id: "newUpstream",
        timelineStep: step,
      });
    });
    expect(
      useCadStore
        .getState()
        .history.present.features.find((f) => f.id === scope.id),
    ).toMatchObject({ targetBodyIds: ids });
  });
  it.each(["edit", "replacement"] as const)(
    "aborts and rejects a stale native result after document %s",
    async (change) => {
      const { document, scope, ids } = fixture();
      useCadStore.getState().setDocument(document);
      useCadStore
        .getState()
        .select({ kind: "feature", id: scope.id, documentId: document.id });
      useCadStore.setState({
        rebuild: { ...useCadStore.getState().rebuild, kernelReady: true },
      });
      let resolve!: (ids: string[]) => void;
      captureRequest.mockReturnValue(
        new Promise<string[]>((r) => {
          resolve = r;
        }),
      );
      const job = captureSelectedTargetScope();
      const signal = captureRequest.mock.calls[0][1] as AbortSignal;
      if (change === "edit")
        useCadStore.getState().updateDocument((d) =>
          upsertParameter(d, {
            id: "extra",
            name: "extra",
            expression: "1mm",
            unit: "mm",
            value: 1,
          }),
        );
      else
        useCadStore.getState().setDocument({ ...document, id: "replacement" });
      const after = useCadStore.getState().history.present;
      expect(signal.aborted).toBe(true);
      resolve(ids);
      await job;
      expect(useCadStore.getState().history.present).toBe(after);
      expect(
        useCadStore
          .getState()
          .history.present.features.find((f) => f.id === scope.id),
      ).toMatchObject({ targetBodyIds: [] });
      expect(useTargetScopeCapture.getState()).toMatchObject({
        busy: false,
        error: expect.stringContaining("Project changed"),
      });
    },
  );
  it("updates palette availability when the separate scope worker starts and finishes", async () => {
    const { document, scope, ids } = fixture();
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "feature", id: scope.id, documentId: document.id });
    useCadStore.setState({
      paletteOpen: true,
      rebuild: { ...useCadStore.getState().rebuild, kernelReady: true },
    });
    render(createElement(CommandPalette, { context: {} }));
    const button = screen.getByRole("button", {
      name: /Capture Intersected Targets/,
    });
    expect(button).toBeEnabled();
    let resolve!: (ids: string[]) => void;
    captureRequest.mockReturnValue(
      new Promise<string[]>((r) => {
        resolve = r;
      }),
    );
    let job!: Promise<void>;
    act(() => {
      job = captureSelectedTargetScope();
    });
    expect(button).toBeDisabled();
    await act(async () => {
      resolve(ids);
      await job;
    });
    expect(button).toBeEnabled();
  });
  it.each([
    { ids: [] },
    { ids: ["body:lost"] },
    { ids: ["body:second", "body:second"] },
    { ids: ["body:downstream"] },
  ])("rejects invalid or non-upstream captured IDs $ids", async ({ ids }) => {
    const { document, scope } = fixture();
    useCadStore.getState().setDocument(document);
    useCadStore
      .getState()
      .select({ kind: "feature", id: scope.id, documentId: document.id });
    useCadStore.setState({
      rebuild: { ...useCadStore.getState().rebuild, kernelReady: true },
    });
    const before = useCadStore.getState().history.present;
    captureRequest.mockResolvedValue(ids);
    await captureSelectedTargetScope();
    expect(useCadStore.getState().history.present).toBe(before);
    expect(useTargetScopeCapture.getState().error).toContain(
      "invalid target IDs",
    );
  });
});
