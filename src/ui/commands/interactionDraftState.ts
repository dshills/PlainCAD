import { create } from "zustand";
import type { SolidDimensionEditFrame } from "./solidDimensionCommand";
import type { SketchRefinementFrame } from "./sketchRefinementCommand";

/** Runtime-only edit ownership; leaf stores prevent command-module initialization cycles. */
export const useSolidDimensionEdit = create<{ frame?: SolidDimensionEditFrame }>(() => ({}));
export const useSketchRefinement = create<{ frame?: SketchRefinementFrame }>(() => ({}));
