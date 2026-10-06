import { create } from "zustand";
import type { SolidDimensionEditFrame } from "./solidDimensionCommand";

/** Runtime-only edit ownership; leaf stores prevent command-module initialization cycles. */
export const useSolidDimensionEdit = create<{ frame?: SolidDimensionEditFrame }>(() => ({}));
