import { create } from "zustand";
import type { CadDocument, SelectionRef } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { JsonValue } from "../commands/registry";

export interface CommandPlanFrame {
  id: string;
  label: string;
  owner?: "ai";
  source: CadDocument;
  session: number;
  componentId: string;
  selection: readonly SelectionRef[];
  beforeResult?: RebuildResult;
  document?: CadDocument;
  result?: RebuildResult;
  results: JsonValue[];
  bodyIds: string[];
  steps: number;
}
/** Disposable plan proofs never enter project JSON, macros or command arguments. */
export const useCommandPlan = create<{
  status: "idle" | "previewing" | "ready" | "failed";
  frame?: CommandPlanFrame;
  progress?: string;
  error?: string;
}>(() => ({ status: "idle" }));
