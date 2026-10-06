import { create } from "zustand";
import type { SketchReplicationFrame } from "./sketchReplicationCommand";
import type { SketchReplicationMode } from "../../cad/sketch/sketchReplication";

/** Runtime-only ownership, kept separate from command initialization. */
export const useSketchReplication = create<{ frame?: SketchReplicationFrame; mode: SketchReplicationMode }>(() => ({ mode: "mirror" }));
