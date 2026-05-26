import { RenderMesh } from "../kernel/KernelAdapter";

export interface CadBody {
  id: string;
  name: string;
  featureId?: string;
}

export interface RebuildResult {
  documentId: string;
  success: boolean;
  bodies: CadBody[];
  meshes: RenderMesh[];
  errors: RebuildError[];
  warnings: RebuildWarning[];
  durationMs: number;
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
  | { type: "initialize"; requestId: number }
  | { type: "rebuild"; requestId: number; document: unknown }
  | { type: "exportStl"; requestId: number; document: unknown };

export type WorkerResponse =
  | { type: "initialized"; requestId: number }
  | { type: "rebuildResult"; requestId: number; result: RebuildResult }
  | { type: "exportResult"; requestId: number; bytes: ArrayBuffer }
  | { type: "error"; requestId: number; message: string };
