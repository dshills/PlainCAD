import { RenderMesh } from "../kernel/KernelAdapter";

export interface CadBody {
  id: string;
  name: string;
  featureId?: string;
  triangleCount?: number;
  bounds?: RenderMesh["bounds"];
}

export interface RebuildResult {
  documentId: string;
  success: boolean;
  bodies: CadBody[];
  meshes: RenderMesh[];
  errors: RebuildError[];
  warnings: RebuildWarning[];
  durationMs: number;
  metrics?: RebuildMetrics;
}

export interface RebuildMetrics {
  parameterEvaluationMs: number;
  sketchSolveMs: number;
  featureRebuildMs: number;
  operationCount: number;
  cacheSize: number;
  disposalFailures: number;
}

export interface RebuildError {
  id: string;
  source: "parameter" | "sketch" | "feature" | "kernel" | "export";
  sourceId?: string;
  message: string;
  details?: unknown;
}

export interface RebuildWarning {
  id: string;
  source: "parameter" | "sketch" | "feature" | "kernel" | "export";
  sourceId?: string;
  message: string;
}

export type WorkerRequest =
  | { type: "initialize"; requestId: number; epoch: number }
  | { type: "rebuild"; requestId: number; epoch: number; document: unknown }
  | { type: "exportStl"; requestId: number; epoch: number; document: unknown };

export type WorkerResponse =
  | { type: "initialized"; requestId: number; epoch: number }
  | { type: "heartbeat"; requestId: number; epoch: number; stage: string; elapsedMs: number }
  | { type: "skipped"; requestId: number; epoch: number; reason: string }
  | { type: "rebuildResult"; requestId: number; epoch: number; result: RebuildResult }
  | { type: "exportResult"; requestId: number; epoch: number; bytes: ArrayBuffer }
  | { type: "error"; requestId: number; epoch: number; message: string };
