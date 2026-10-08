import type { CadDocument, Feature } from "../document/schema";
import type { RebuildResult } from "../worker/workerProtocol";
import type { RenderMesh } from "../kernel/KernelAdapter";
import { targetBodyIds } from "../document/bodyScopes";
import { buildDependencyGraph } from "../document/dependencyGraph";
import { evaluateExpressionRef, evaluateParameters } from "../parameters/expressionEvaluator";
import { upsertFeature } from "../document/CadDocument";
import { bindDocumentExpressions } from "../parameters/expressionBindings";
export type ManufacturingProcess = "fdm" | "cnc" | "laser";
export interface CoachSettings { process: ManufacturingProcess; minimumWall: number; minimumClearance: number; toolDiameter: number; overhangAngle: number }
export const COACH_PRESETS: Record<ManufacturingProcess, CoachSettings> = {
  fdm: { process: "fdm", minimumWall: 1.2, minimumClearance: 0.3, toolDiameter: 2, overhangAngle: 45 },
  cnc: { process: "cnc", minimumWall: 1, minimumClearance: 0.1, toolDiameter: 2, overhangAngle: 45 },
  laser: { process: "laser", minimumWall: 1, minimumClearance: 0.1, toolDiameter: 1, overhangAngle: 45 },
};
export interface CoachCorrection { featureId: string; field: "wallThickness" | "clearance" | "distance" | "diameter"; value: number }
export interface CoachFinding { id: string; title: string; message: string; bodyIds: string[]; featureId?: string; correction?: CoachCorrection }
export interface CoachReport { findings: CoachFinding[]; complete: boolean; trianglesChecked: number; scope: string[] }
export const COACH_TRIANGLE_LIMIT = 250000;
export function validCoachSettings(settings: CoachSettings) {
  return ["fdm", "cnc", "laser"].includes(settings.process) && [settings.minimumWall, settings.toolDiameter].every(value => Number.isFinite(value) && value > 0 && value <= 1e6) &&
    Number.isFinite(settings.minimumClearance) && settings.minimumClearance >= 0 && settings.minimumClearance <= 1e6 && Number.isFinite(settings.overhangAngle) && settings.overhangAngle >= 1 && settings.overhangAngle <= 89;
}
/** Facet slope screen, not a support/strength simulation. The lowest build-plane facets are excluded. */
export function overhangArea(mesh: RenderMesh, angle: number, budget: { visits: number }) {
  let area = 0;
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    if (budget.visits >= COACH_TRIANGLE_LIMIT) return { area, complete: false };
    budget.visits++;
    const vertices = [0, 1, 2].map(vertex => {
      const index = mesh.indices[i + vertex] * 3;
      return [mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]];
    });
    if (!vertices.flat().every(Number.isFinite)) throw new Error("Manufacturing screen encountered invalid mesh coordinates.");
    const u = vertices[1].map((value, axis) => value - vertices[0][axis]), v = vertices[2].map((value, axis) => value - vertices[0][axis]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...cross);
    if (length > 1e-12 && cross[2] / length < -Math.sin(angle * Math.PI / 180) && Math.max(...vertices.map(vertex => vertex[2])) > mesh.bounds.min[2] + 1e-5) area += length / 2;
  }
  return { area, complete: true };
}
export function manufacturingReport(document: CadDocument, result: RebuildResult, settings: CoachSettings): CoachReport {
  if (!validCoachSettings(settings)) throw new Error("Enter finite positive wall/tool sizes, nonnegative clearance and an overhang angle from 1–89 degrees.");
  if (!result.success || result.documentId !== document.id || !result.meshes.length || result.meshes.some(mesh => mesh.geometrySource !== "opencascade" || !mesh.geometryAssertions?.valid)) throw new Error("Manufacturing coach requires a current successful native model.");
  const parameters = evaluateParameters(document.parameters), graph = buildDependencyGraph(document);
  if (parameters.errors.length) throw new Error("Repair parameter expressions before manufacturing analysis.");
  const length = (feature: Feature, field: string) => {
    const ref = (feature as unknown as Record<string, unknown>)[field];
    if (!ref || typeof ref !== "object") return undefined;
    const value = evaluateExpressionRef(ref as Parameters<typeof evaluateExpressionRef>[0], { parameters: parameters.values });
    return value.quantity?.dimension === "length" && !value.error ? value.quantity.value : undefined;
  };
  const findings: CoachFinding[] = [], live = new Set(result.meshes.map(mesh => mesh.bodyId));
  const check = (feature: Feature, field: CoachCorrection["field"], minimum: number, title: string, ids: string[]) => {
    const value = length(feature, field);
    if (value === undefined || value >= minimum || !ids.length) return;
    findings.push({ id: `${feature.id}:${field}`, title, featureId: feature.id, bodyIds: ids, message: `${feature.name}: authored ${field} ${value.toFixed(3)} mm is below your ${minimum.toFixed(3)} mm threshold. Increasing it changes the design; preview before applying.`, correction: { featureId: feature.id, field, value: minimum } });
  };
  for (const feature of document.features) {
    if (feature.suppressed) continue;
    const own = `body:${feature.id}`, ids = targetBodyIds(feature).filter(id => live.has(id));
    if (feature.type === "fit" && live.has(own)) {
      check(feature, "wallThickness", settings.minimumWall, "Fitted wall below threshold", [own]);
      check(feature, "clearance", settings.minimumClearance, "Fit clearance below threshold", [own]);
    }
    if (feature.type === "extrude" && feature.operation === "newBody" && live.has(own) && graph.bodyWriters.get(own) === feature.id && (!feature.termination || feature.termination.type === "distance")) check(feature, "distance", settings.minimumWall, "Extrusion thickness below threshold", [own]);
    if (settings.process === "cnc" && feature.type === "hole" && ids.length) {
      check(feature, "diameter", settings.toolDiameter, "Hole smaller than selected tool", ids);
      const diameter = length(feature, "diameter"), depth = length(feature, "depth");
      if (diameter && depth && depth / diameter > 4) findings.push({ id: `${feature.id}:access`, title: "Deep hole: review tool reach", featureId: feature.id, bodyIds: ids, message: `${feature.name}: authored drilling depth is ${(depth / diameter).toFixed(1)}× its diameter. Review the drill and setup; the 4× screen is a heuristic, not an access proof.` });
    }
  }
  const budget = { visits: 0 }; let complete = true;
  if (settings.process === "fdm") for (const mesh of result.meshes) {
    const screen = overhangArea(mesh, settings.overhangAngle, budget); complete &&= screen.complete;
    if (screen.area > 1e-5) findings.push({ id: `${mesh.bodyId}:overhang`, title: "Downward facets: review supports", bodyIds: [mesh.bodyId], message: `${screen.area.toFixed(2)} mm² of downward-facing facets exceed your ${settings.overhangAngle}° slope screen. Build direction is world +Z, each part starts at its own lowest Z. Review orientation and supports; supported spans are not simulated.` });
  }
  if (settings.process === "laser") for (const mesh of result.meshes) {
    const feature = document.features.find(feature => `body:${feature.id}` === mesh.bodyId);
    const normal = feature && "sketchId" in feature ? result.sketchPlanes?.[feature.sketchId]?.normal : undefined;
    const nonSheetModifier = document.features.some(modifier => {
      if (modifier.suppressed || !targetBodyIds(modifier).includes(mesh.bodyId)) return false;
      const axis = "sketchId" in modifier ? result.sketchPlanes?.[modifier.sketchId]?.normal : undefined;
      return !axis || Math.abs(axis.z) < 1 - 1e-8 || !((modifier.type === "hole" && modifier.depth === "throughAll") || (modifier.type === "extrude" && modifier.operation === "cut" && modifier.termination?.type === "throughAll"));
    });
    if (nonSheetModifier || !feature || feature.type !== "extrude" || !normal || Math.abs(normal.z) < 1 - 1e-8 || !result.availableFaces?.some(face => face.featureId === feature.id && face.id.endsWith(":startCap")) || !result.availableFaces?.some(face => face.featureId === feature.id && face.id.endsWith(":endCap"))) findings.push({ id: `${mesh.bodyId}:stock`, title: "Sheet profile not verified", bodyIds: [mesh.bodyId], message: "This solid is not a retained straight extrusion aligned with world Z. Review a flat sheet orientation and constant stock thickness before laser cutting; CNC/3D solids are not converted to sheet profiles." });
  }
  for (const pair of result.assemblyCollisions ?? []) findings.push({ id: `collision:${pair.join(":")}`, title: "Native solid interference", bodyIds: pair, message: "These parts share actual native solid volume. Adjust assembly placement or clearance before fabrication." });
  if (document.assemblyJoints?.length && result.assemblyCollisionStatus !== "complete") complete = false;
  return { findings, complete, trianglesChecked: budget.visits, scope: ["Editable presets are screening assumptions, not manufacturing certification.", "Thickness checks cover fitted walls and unmodified extrusion depth; general local wall thickness, contoured gaps, strength and tolerance stacks are not measured.", "Tool review covers authored Hole diameter and explicit-depth aspect ratio; through-holes, general pocket/tool access and multi-setup machining require manual review.", "Facet overhangs use the current native tessellation; bridge support and print stability are not simulated.", "Laser screening verifies retained axial extrusions and only axial through-cuts; stock choice, kerf, local web widths and process settings still require review."] };
}
export function correctManufacturingFinding(document: CadDocument, correction: CoachCorrection) {
  const feature = document.features.find(feature => feature.id === correction.featureId);
  if (!feature || feature.suppressed || !Number.isFinite(correction.value) || correction.value <= 0 || correction.value > 1e6) throw new Error("Manufacturing correction is unavailable.");
  const ref = { expression: `${correction.value}mm`, unit: "mm" };
  let updated: Feature;
  if (feature.type === "fit" && (correction.field === "clearance" || correction.field === "wallThickness")) updated = { ...feature, [correction.field]: ref };
  else if (feature.type === "extrude" && correction.field === "distance" && (!feature.termination || feature.termination.type === "distance")) updated = { ...feature, distance: ref, ...(feature.termination?.type === "distance" ? { termination: { type: "distance", distance: ref } } : {}) };
  else if (feature.type === "hole" && correction.field === "diameter") updated = { ...feature, diameter: ref };
  else throw new Error("This finding requires manual repair.");
  return bindDocumentExpressions(upsertFeature(document, updated), document);
}
