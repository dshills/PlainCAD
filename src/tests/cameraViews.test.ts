import {
  registerCameraController,
  restoreCamera,
  captureCamera,
} from "../viewer/cameraController";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import {
  saveNamedCamera,
  removeNamedCamera,
  validCameraPose,
  sectionPlane,
  MAX_NAMED_VIEWS,
  cameraClipRange,
  unusedViewName,
} from "../cad/inspection/cameraViews";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/projectCodec";
import { useSectionState } from "../state/sectionState";
const pose = {
  cameraPosition: [10, -20, 30] as [number, number, number],
  cameraTarget: [0, 0, 0] as [number, number, number],
  cameraUp: [0, 0, 1] as [number, number, number],
};
describe("durable cameras and transient sections", () => {
  it("does not report a rejected camera pose as restored", () => {
    const unregister = registerCameraController({
      read: () => pose,
      apply: () => false,
      preset: () => {},
    });
    expect(restoreCamera(pose)).toBe(false);
    unregister();
    expect(captureCamera()).toBeUndefined();
    expect(restoreCamera(pose)).toBe(false);
  });
  it("preserves named camera IDs and orientation through save/open and rejects invalid input", () => {
    const original = createEmptyDocument(),
      doc = saveNamedCamera(original, "View", pose),
      view = doc.viewState!.namedViews![0];
    expect(original.viewState).toBeUndefined();
    const clips = cameraClipRange(0.01, 100);
    expect(clips.far / clips.near).toBeLessThanOrEqual(1e6);
    expect(
      unusedViewName({
        ...doc,
        viewState: { namedViews: [{ ...view, name: "View 2" }] },
      }),
    ).toBe("View 1");
    expect(
      importProjectText(serializeProject(doc)).viewState?.namedViews,
    ).toEqual([view]);
    expect(removeNamedCamera(doc, view.id).viewState?.namedViews).toEqual([]);
    expect(removeNamedCamera(doc, "lost")).toBe(doc);
    expect(() => saveNamedCamera(doc, "view", pose)).toThrow(/already exists/);
    for (const invalid of [
      { ...pose, cameraPosition: [0, 0, 0] },
      { ...pose, cameraUp: [0, 0, 0] },
      { ...pose, cameraUp: [0, 0, 2] },
      { ...pose, cameraPosition: [NaN, 0, 0] },
      { ...pose, cameraPosition: [0, 0, 10] },
    ]) {
      expect(validCameraPose(invalid)).toBe(false);
      const raw = {
        ...doc,
        viewState: { namedViews: [{ ...view, ...invalid }] },
      };
      expect(() => importProjectText(JSON.stringify(raw))).toThrow(
        /camera pose/,
      );
    }
    const raw = { ...doc, viewState: { namedViews: [view, view] } };
    expect(() => importProjectText(JSON.stringify(raw))).toThrow(/unique id/);
    expect(() =>
      importProjectText(
        JSON.stringify({ ...doc, viewState: { namedViews: "wrong" } }),
      ),
    ).toThrow(/array/);
    expect(() =>
      saveNamedCamera(
        {
          ...doc,
          viewState: {
            namedViews: Array.from({ length: MAX_NAMED_VIEWS }, (_, i) => ({
              ...view,
              id: `view_${i}`,
              name: `View ${i}`,
            })),
          },
        },
        "Extra",
        pose,
      ),
    ).toThrow(/at most/);
  });
  it.each(["X", "Y", "Z"] as const)(
    "clips the %s axis in model millimeters with reversible side",
    (axis) => {
      const positive = sectionPlane(axis, 7),
        negative = sectionPlane(axis, 7, false);
      const index = { X: 0, Y: 1, Z: 2 }[axis];
      expect(positive.normal[index]).toBe(1);
      expect(positive.constant).toBe(-7);
      expect(negative.normal[index]).toBe(-1);
      expect(negative.constant).toBe(7);
      expect(positive.normal.filter((_, i) => i !== index)).toEqual([0, 0]);
      expect(() => sectionPlane(axis, Infinity)).toThrow(/finite/);
      expect(() =>
        useSectionState.getState().setSection(1, undefined, NaN, true),
      ).toThrow(/finite/);
    },
  );
});
