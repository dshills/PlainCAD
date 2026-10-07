import * as THREE from "three";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import type { ModelMeasurementTarget } from "../cad/inspection/modelMeasurements";
import { installMeasurementPicking, resolvedMeasurementSelection, addMeasurementOverlays } from "../viewer/measurementPicking";
import { useInspectionState } from "../state/inspectionState";
import { useCadStore } from "../state/useCadStore";

beforeEach(() => useInspectionState.setState(useInspectionState.getInitialState()));
afterEach(() => {
  useInspectionState.setState(useInspectionState.getInitialState());
  useCadStore.setState(useCadStore.getInitialState());
});
it("keeps current ordinary overlays while rejecting stale or partly unavailable selected targets", () => {
  const document = createEmptyDocument(), result = rebuildDocument(document);
  const target: ModelMeasurementTarget = { id: "edge", kind: "curve", label: "Edge", paths: [[{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }]], direction: { x: 3, y: 0, z: 0 }, curve: { length: 3 } };
  expect(resolvedMeasurementSelection(document, result, { document, result, targetIds: [target.id, "hidden"] }, [target])).toEqual([]);
  const selected = resolvedMeasurementSelection(document, result, { document: { ...document }, result, targetIds: [target.id] }, [target]);
  expect(selected).toEqual([]);
  const group = new THREE.Group();
  addMeasurementOverlays(group, [target], selected.map((item) => item.id));
  expect(group.children).toHaveLength(1);
  const line = group.children[0] as THREE.LineSegments, ordinary = new THREE.Color("#32cee0");
  const colors = line.geometry.getAttribute("color");
  expect(colors.getX(0)).toBeCloseTo(ordinary.r, 6);
  expect(colors.getY(0)).toBeCloseTo(ordinary.g, 6);
  expect(colors.getZ(0)).toBeCloseTo(ordinary.b, 6);
  line.geometry.dispose(); (line.material as THREE.Material).dispose();
  const current = resolvedMeasurementSelection(document, result, { document, result, targetIds: [target.id] }, [target]);
  expect(current).toEqual([target]);
  const highlighted = new THREE.Group();
  addMeasurementOverlays(highlighted, [target], current.map((item) => item.id));
  const selectedLine = highlighted.children[0] as THREE.LineSegments, highlight = new THREE.Color("#b52977");
  const selectedColors = selectedLine.geometry.getAttribute("color");
  expect(selectedColors.getX(0)).toBeCloseTo(highlight.r, 6);
  expect(selectedColors.getY(0)).toBeCloseTo(highlight.g, 6);
  expect(selectedColors.getZ(0)).toBeCloseTo(highlight.b, 6);
  selectedLine.geometry.dispose(); (selectedLine.material as THREE.Material).dispose();
});
it("honors prevented Escape and editable focus, and releases picking on an unhandled canvas Escape", () => {
  const canvas = document.createElement("canvas"), input = document.createElement("input");
  document.body.append(canvas, input);
  useCadStore.setState({ documentSession: 41 });
  useInspectionState.getState().setPicking(41, true);
  const remove = installMeasurementPicking(canvas, new THREE.PerspectiveCamera(), new THREE.Group(), () => undefined);
  try {
    const prevented = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); prevented.preventDefault();
    canvas.dispatchEvent(prevented);
    expect(useInspectionState.getState().picking).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(useInspectionState.getState().picking).toBe(true);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(useInspectionState.getState().picking).toBe(false);
  } finally { remove(); canvas.remove(); input.remove(); }
});
