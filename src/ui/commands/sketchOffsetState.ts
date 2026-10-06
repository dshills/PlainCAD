import { create } from "zustand";
import type { SketchOffsetFrame } from "./sketchOffsetCommand";
/** Runtime-only ownership; copied curves and their expressions live in CadDocument. */
export const useSketchOffset = create<{ frame?: SketchOffsetFrame }>(() => ({}));
