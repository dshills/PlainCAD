import { importProjectText } from "../persistence/projectCodec";
import { parseBoundedJson } from "../persistence/importSafety";
import { CAD_COMMAND_SCHEMAS, isCadCommandId, type CadCommandId } from "../commands/cadCommands";
import { validateCommandArguments } from "../commands/commandSchemas";
import { objectArguments, stringArgument } from "../commands/protocol";
import { featureComponentId } from "../cad/document/components";
import { faceReferenceBodyId } from "../cad/document/faceReferences";
import type { CadDocument } from "../cad/document/schema";
import type { JsonValue } from "../commands/registry";

interface CommandAgentFace {
  id: string;
  featureId: string;
  bodyId: string;
  componentId: string;
  label: string;
}
export interface CommandAgentContext {
  session: number;
  document: CadDocument;
  activeComponentId: string;
  selection: JsonValue[];
  native: boolean;
  bodies: Array<{ id: string; volume: number; solidCount: number; valid: boolean }>;
  diagnostics: string[];
  faces?: CommandAgentFace[];
}
export interface CommandAgentProposal {
  kind: "clarification" | "plan";
  label: string;
  summary: string;
  warnings: string[];
  steps: Array<{ command: CadCommandId; arguments: Record<string, JsonValue> }>;
}
export const COMMAND_AGENT_LIMITS = { contextBytes: 20000, steps: 12, proposalBytes: 48000 } as const;
export function validateCommandAgentContext(value: unknown): CommandAgentContext {
  const source = objectArguments(value, ["session", "document", "activeComponentId", "selection", "native", "bodies", "diagnostics", "faces"]);
  if (!Number.isSafeInteger(source.session) || Number(source.session) < 0 || typeof source.native !== "boolean") throw new Error("Invalid project session or native status.");
  if (!source.document || typeof source.document !== "object") throw new Error("Current project context is missing.");
  const document = importProjectText(JSON.stringify(source.document));
  if (document.features.some(feature => feature.type === "stepImport"))
    throw new Error("The provider command agent cannot share projects with embedded STEP sources. Use local commands for this project.");
  const activeComponentId = stringArgument(source.activeComponentId, "Active component", 160);
  if (!document.components[activeComponentId]) throw new Error("The active component is absent from this project.");
  if (!Array.isArray(source.selection) || source.selection.length > 32 || !Array.isArray(source.diagnostics) || source.diagnostics.length > 32) throw new Error("Project context exceeds the supported selection or diagnostic limit.");
  const selection = source.selection.map(value => {
    const selected = objectArguments(value, ["kind", "id", "documentId"]);
    if (selected.documentId !== document.id) throw new Error("Selection belongs to an old project.");
    return { kind: stringArgument(selected.kind, "Selection kind", 40), id: stringArgument(selected.id, "Selection ID", 160), documentId: document.id };
  });
  if (!Array.isArray(source.bodies) || source.bodies.length > 32) throw new Error("Native body context exceeds its supported limit.");
  const bodies = source.bodies.map(value => {
    const body = objectArguments(value, ["id", "volume", "solidCount", "valid"]);
    if (typeof body.volume !== "number" || !Number.isFinite(body.volume) || body.volume < 0 || !Number.isSafeInteger(body.solidCount) || Number(body.solidCount) < 1 || typeof body.valid !== "boolean") throw new Error("Invalid body context.");
    return { id: stringArgument(body.id, "Body ID", 160), volume: body.volume, solidCount: Number(body.solidCount), valid: body.valid };
  });
  let faces: CommandAgentFace[] | undefined;
  if (source.faces !== undefined) {
    if (!Array.isArray(source.faces) || source.faces.length > 32 || (!source.native && source.faces.length))
      throw new Error("Native face context exceeds its supported limit or belongs to an unavailable rebuild.");
    const owners = new Map(document.features.map(feature => [feature.id, feature]));
    const bodyIds = new Set(bodies.map(body => body.id));
    const ids = new Set<string>();
    faces = source.faces.map(value => {
      const face = objectArguments(value, ["id", "featureId", "bodyId", "componentId", "label"]);
      const id = stringArgument(face.id, "Face ID", 300), featureId = stringArgument(face.featureId, "Face feature", 160);
      const bodyId = stringArgument(face.bodyId, "Face body", 160);
      const owner = owners.get(featureId);
      if (ids.has(id) || !owner || featureComponentId(document, owner) !== activeComponentId ||
          faceReferenceBodyId(document, { featureId, stableFaceId: id }) !== bodyId || !bodyIds.has(bodyId) || face.componentId !== activeComponentId)
        throw new Error("Native face context contains a duplicate or unknown owner outside the active component.");
      ids.add(id);
      return { id, featureId, bodyId, componentId: activeComponentId, label: stringArgument(face.label, "Face label", 300) };
    });
  }
  const context = { bodies, ...(faces ? { faces } : {}), session: Number(source.session), document, activeComponentId, selection, native: source.native, diagnostics: source.diagnostics.map(value => stringArgument(value, "Diagnostic", 500)) };
  if (new TextEncoder().encode(JSON.stringify(context)).byteLength > COMMAND_AGENT_LIMITS.contextBytes) throw new Error("This project exceeds the command agent's 20 kB context budget. Use stable commands or an external live agent for this project.");
  return context;
}
export function validateCommandAgentProposal(value: unknown): CommandAgentProposal {
  if (value === undefined) throw new Error("AI returned no command proposal.");
  const source = objectArguments(parseBoundedJson(JSON.stringify(value), COMMAND_AGENT_LIMITS.proposalBytes, "Command proposal"), ["kind", "label", "summary", "warnings", "steps"]);
  if (source.kind !== "clarification" && source.kind !== "plan") throw new Error("AI must clarify or propose a command plan.");
  if (!Array.isArray(source.warnings) || source.warnings.length > 8 || !Array.isArray(source.steps) || source.steps.length > COMMAND_AGENT_LIMITS.steps) throw new Error("AI command proposal exceeds its supported limits.");
  const steps = source.steps.map(value => {
    const step = objectArguments(value, ["command", "arguments"]);
    if (typeof step.command !== "string" || !isCadCommandId(step.command)) throw new Error("AI proposed a command outside the safe modeling catalog.");
    validateCommandArguments(CAD_COMMAND_SCHEMAS[step.command], step.arguments);
    return { command: step.command, arguments: step.arguments };
  });
  if ((source.kind === "clarification") !== (steps.length === 0)) throw new Error("Clarification must have no edits; a plan must contain at least one step.");
  return { kind: source.kind, label: stringArgument(source.label, "Plan label", 120), summary: stringArgument(source.summary, "AI explanation", 2000), warnings: source.warnings.map(value => stringArgument(value, "AI warning", 500)), steps };
}
