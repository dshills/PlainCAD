import { describe, expect, it } from "vitest";
import { nativeFeatureSignature } from "../cad/features/nativeFeatureSignature";
import { createMountingPlateTemplate } from "../templates/templates";
import { evaluateParameters } from "../cad/parameters/expressionEvaluator";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { resolveDocumentPlanes } from "../cad/sketch/planes";
import type { Feature } from "../cad/document/schema";

function fixture() {
  const document = createMountingPlateTemplate(), parameters = evaluateParameters(document.parameters).values;
  const sketches = new Map(Object.values(document.sketches).map(sketch => [sketch.id, solveSketch(sketch, parameters)]));
  const profiles = new Map([...sketches].map(([id, solved]) => [id, detectProfiles(solved)]));
  const planes = resolveDocumentPlanes(document, parameters, sketches).transforms;
  const versions = new Map([["body:base", 1], ["body:other", 2]]);
  const source = document.features.find(feature => feature.type === "extrude")!;
  const signature = (feature: Feature = source) => nativeFeatureSignature(feature, document, sketches, profiles, planes, parameters, versions);
  return { document, parameters, sketches, profiles, planes, versions, source, signature };
}

describe("exact native feature input signatures", () => {
  it("ignores labels, solver counters, unused parameters, and display metadata", () => {
    const { signature, source, parameters, sketches, document } = fixture(), original = signature();
    expect(original).toBeTypeOf("string");
    parameters.unused = { value: 400, dimension: "length", unit: "mm" };
    document.name = "Renamed project";
    for (const solved of sketches.values()) { solved.iterations += 19; solved.seedUsed = !solved.seedUsed; }
    expect(signature({ ...source, name: "Renamed feature", timelineStep: 900 })).toBe(original);
  });

  it("invalidates on resolved sketch, plane, profile lineage and feature quantities", () => {
    const { signature, source, sketches, planes, parameters } = fixture(), original = signature();
    const solved = sketches.values().next().value!;
    const point = Object.values(solved.points)[0]; point.x += 0.25;
    expect(signature()).not.toBe(original); point.x -= 0.25;
    const plane = planes.values().next().value!; plane.origin.x += 7;
    expect(signature()).not.toBe(original); plane.origin.x -= 7;
    expect(signature({ ...source, profileId: "replacement:identical-shape" } as Feature)).not.toBe(original);
    if (source.type !== "extrude") throw new Error("Expected extrusion fixture");
    expect(signature({ ...source, distance: { expression: "8mm", unit: "mm" }, termination: { type: "distance", distance: { expression: "8mm", unit: "mm" } } })).not.toBe(original);
    parameters.plate_thickness = { value: 11, dimension: "length", unit: "mm" };
    expect(signature()).not.toBe(original);
  });

  it("keys boolean dependency identities exactly and refuses unavailable upstream bodies", () => {
    const { signature, source, versions } = fixture();
    if (source.type !== "extrude") throw new Error("Expected extrusion fixture");
    const cut = { ...source, operation: "cut" as const, targetBodyIds: ["body:base"] };
    const original = signature(cut);
    versions.set("body:other", 33);
    expect(signature(cut)).toBe(original);
    versions.set("body:base", 2);
    expect(signature(cut)).not.toBe(original);
    versions.delete("body:base");
    expect(signature(cut)).toBeUndefined();
  });

  it("includes a to-face owner's current body and refuses unresolved or invalid sketch inputs", () => {
    const { signature, source, versions, sketches } = fixture();
    if (source.type !== "extrude") throw new Error("Expected extrusion fixture");
    const toFace = { ...source, termination: { type: "toFace" as const, faceRef: { kind: "face" as const, featureId: "base", stableHint: "face", transientId: "face" } } };
    const original = signature(toFace);
    versions.set("body:base", 9);
    expect(signature(toFace)).not.toBe(original);
    sketches.delete(source.sketchId);
    expect(signature()).toBeUndefined();
  });
  it("refuses nonfinite resolved geometry, profiles and planes instead of serializing NaN as null", () => {
    const { signature, sketches, profiles, planes } = fixture();
    const point = Object.values(sketches.values().next().value!.points)[0], previous = point.x;
    point.x = NaN; expect(signature()).toBeUndefined(); point.x = previous;
    const profile = profiles.values().next().value!.profiles[0], min = profile.bounds.minX;
    profile.bounds.minX = -Infinity; expect(signature()).toBeUndefined(); profile.bounds.minX = min;
    const plane = planes.values().next().value!, origin = plane.origin.z;
    plane.origin.z = Infinity; expect(signature()).toBeUndefined(); plane.origin.z = origin;
    expect(signature()).toBeTypeOf("string");
  });

});
