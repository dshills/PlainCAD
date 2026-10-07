import type { SketchProfile } from "../sketch/profileDetection";
import type { ResolvedSketch } from "../sketch/SketchSolver";
import type { AvailableFace, SketchPlaneTransform } from "../sketch/planes";
import { RenderMesh, type AvailableCapEdge } from "../kernel/KernelAdapter";
import type { Quantity } from "../parameters/units";

export interface CadBody {
  id: string;
  name: string;
  featureId?: string;
  triangleCount?: number;
  bounds?: RenderMesh["bounds"];
}

export interface AvailableEdge extends AvailableCapEdge {
  featureId: string;
  bodyId: string;
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
  /** Runtime-only result of an explicit scope probe, never used by ordinary rebuilds. */
  capturedTargetBodyIds?: string[];
  parameterValues?: Record<string, Quantity>;
  solvedSketches?: Record<string, ResolvedSketch>;
  profiles?: Record<string, SketchProfile[]>;
  sketchPlanes?: Record<string, SketchPlaneTransform>;
  /** Native-validated current faces, without kernel handles. Never persisted. */
  availableFaces?: AvailableFace[];
  /** Native-validated current sharp authored edges, never persisted. */
  availableEdges?: AvailableEdge[];
}

export interface RebuildMetrics {
  parameterEvaluationMs: number;
  sketchSolveMs: number;
  profileDetectionMs: number;
  featureRebuildMs: number;
  nativeEdgeProofMs?: number;
  nativeEdgeProofCacheHits?: number;
  nativeEdgeProofCacheMisses?: number;
  operationCount: number;
  cacheSize: number;
  disposalFailures: number;
  shapeDisposalAttempts: number;
  shapeDisposalFailures: number;
  scopedHandles: { registered: number; disposed: number; released: number; alreadyDeleted: number; failures: number };
  wasmHeapCapacityBytes?: number;
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
  | {
      type: "heartbeat";
      requestId: number;
      epoch: number;
      stage: string;
      elapsedMs: number;
    }
  | { type: "skipped"; requestId: number; epoch: number; reason: string }
  | {
      type: "rebuildResult";
      requestId: number;
      epoch: number;
      result: RebuildResult;
    }
  | {
      type: "exportResult";
      requestId: number;
      epoch: number;
      bytes: ArrayBuffer;
    }
  | { type: "error"; requestId: number; epoch: number; message: string };
