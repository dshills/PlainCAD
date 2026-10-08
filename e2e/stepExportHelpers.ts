import { expect, type Page } from "@playwright/test";
import { createEmptyDocument, createExtrudeFeature, upsertFeature, upsertParameter, upsertSketch } from "../src/cad/document/CadDocument";
import { addComponent } from "../src/cad/document/components";
import { addArc, addCornerRectangle, addLine, addPoint, createSketchOnPlane } from "../src/cad/sketch/SketchModel";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import type { Sketch } from "../src/cad/document/schema";
import type { StepGeometryProof } from "../src/cad/kernel/nativeStep";
function capsule(sketch: Sketch, radius: number): Sketch {
  const ids: string[] = [];
  for (const [x, y] of [[-10, -radius], [10, -radius], [10, radius], [-10, radius], [10, 0], [-10, 0]]) {
    const added = addPoint(sketch, `${x}mm`, `${y}mm`);
    sketch = added.sketch;
    ids.push(added.pointId);
  }
  sketch = addLine(sketch, ids[0], ids[1]).sketch;
  sketch = addArc(sketch, ids[4], ids[1], ids[2]).sketch;
  sketch = addLine(sketch, ids[2], ids[3]).sketch;
  return addArc(sketch, ids[5], ids[3], ids[0]).sketch;
}
export function stepFixture() {
  let document = upsertParameter(createEmptyDocument("STEP posed assembly"), { id: "step_depth_parameter", name: "depth", expression: "5mm", value: 5, unit: "mm" });
  const added = addComponent(document, "Posed drilled plate");
  document = added.document;
  document = {
    ...document,
    components: {
      ...document.components,
      [document.rootComponentId]: {
        ...document.components[document.rootComponentId],
        placement: { translation: [30, 40, 50], rotation: [Math.PI / 2, 0, Math.PI / 2] },
      },
      [added.component.id]: {
        ...added.component,
        placement: { translation: [-20, -30, 15], rotation: [0, Math.PI / 2, Math.PI / 2] },
      },
    },
  };
  const rimSketch = capsule(capsule(createSketchOnPlane("Exact capsule ring", "XZ"), 6), 5);
  const rim = createExtrudeFeature({ name: "Arc rim", sketchId: rimSketch.id, profileId: detectProfiles(solveSketch(rimSketch, {})).profiles[0].id,
    operation: "newBody", direction: "positive", distance: { expression: "depth", unit: "mm" }, componentId: document.rootComponentId });
  document = upsertFeature(upsertSketch(document, rimSketch), rim);
  const plateSketch = { ...addCornerRectangle(createSketchOnPlane("Plate outline", "XY"), "20mm", "10mm"), componentId: added.component.id };
  const plate = createExtrudeFeature({ name: "Plate base", sketchId: plateSketch.id, profileId: detectProfiles(solveSketch(plateSketch, {})).profiles[0].id,
    operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" }, componentId: added.component.id });
  document = upsertFeature(upsertSketch(document, plateSketch), plate);
  const center = addPoint({ ...createSketchOnPlane("Through-hole center", "XY"), componentId: added.component.id }, "10mm", "5mm");
  document = upsertFeature(upsertSketch(document, center.sketch), { id: "step_through_hole", type: "hole", name: "Native through hole", componentId: added.component.id,
    sketchId: center.sketch.id, centerPointIds: [center.pointId], diameter: { expression: "4mm", unit: "mm" }, depth: "throughAll", targetBodyIds: [`body:${plate.id}`] });
  return { document, rimId: `body:${rim.id}`, plateId: `body:${plate.id}` };
}
export function expectedStepProofs(depth = 5) {
  // Capsule ring area = (40·6 + π·6²) − (40·5 + π·5²).
  // Poses rotate the XZ rim into world XY and the drilled XY plate into world YZ.
  return [
    { volume: (40 + 11 * Math.PI) * depth, bounds: { min: [24, 24, 50 - depth], max: [36, 56, 50] } },
    { volume: (200 - 4 * Math.PI) * 8, bounds: { min: [-30, -30, -5], max: [-20, -22, 15] } },
  ];
}
export interface StepProofTranscript {
  worker: string;
  before: StepGeometryProof[];
  after: StepGeometryProof[];
  units: string;
  requestId: number;
  epoch: number;
  bodyIds: string[];
}
/** Read-only transport observation: never replace worker requests, replies or handlers. */
export async function observeStepProofs(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as {
      plaincadObservedStepProofs: StepProofTranscript[];
    };
    target.plaincadObservedStepProofs = [];
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(factory, args) {
        const worker: Worker = Reflect.construct(factory, args);
        const url = String(args[0]);
        if (url.includes("stepExportWorker")) {
          worker.addEventListener("message", (event: MessageEvent) => {
            const result = event.data?.result, output = result?.output;
            if (output?.before && output?.after) {
              target.plaincadObservedStepProofs.push({
                worker: url,
                before: output.before,
                after: output.after,
                units: output.units,
                requestId: result.requestId,
                epoch: result.epoch,
                bodyIds: result.bodyIds,
              });
            }
          });
        }
        return worker;
      },
    });
  });
}
export async function stepTranscripts(page: Page) {
  return page.evaluate(() => (window as unknown as {
    plaincadObservedStepProofs: StepProofTranscript[];
  }).plaincadObservedStepProofs);
}
export function assertStepProofs(actual: StepProofTranscript, expected = expectedStepProofs()) {
  expect(actual.units).toBe("mm");
  expect(actual.before).toHaveLength(expected.length);
  expect(actual.after).toHaveLength(expected.length);
  expect(actual.bodyIds).toHaveLength(expected.length);
  expect(actual.requestId).toBeGreaterThan(0);
  expect(actual.epoch).toBeGreaterThanOrEqual(0);
  for (const proofs of [actual.before, actual.after])
    proofs.forEach((proof, index) => {
      expect(proof).toMatchObject({ valid: true, solidCount: 1 });
      expect(Math.abs(proof.volume / expected[index].volume - 1)).toBeLessThan(1e-8);
      for (const side of ["min", "max"] as const)
        for (let axis = 0; axis < 3; axis++)
          expect(proof.bounds[side][axis]).toBeCloseTo(expected[index].bounds[side][axis], 6);
    });
}
export async function loadStepFixture(page: Page) {
  const model = stepFixture();
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "step-assembly.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model.document)) });
  await expect(page.getByRole("button", { name: "Export STEP", exact: true })).toBeEnabled();
  return model;
}
export async function generatePublicStep(page: Page) {
  await page.getByRole("button", { name: "Export STEP", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export STEP", exact: true });
  await dialog.getByRole("button", { name: "Generate validated STEP", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Download STEP file", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("status")).toContainText("Exact volume and world bounds match after native STEP reimport");
  return dialog;
}
