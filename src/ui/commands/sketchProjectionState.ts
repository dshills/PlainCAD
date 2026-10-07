import { create } from "zustand";
import type { SketchProjectionFrame } from "./sketchProjectionCommand";
/** Runtime task ownership. Durable source links live in Sketch.projections. */
export const useSketchProjection = create<{ frame?: SketchProjectionFrame }>(() => ({}));
