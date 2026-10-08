import { create } from "zustand";
import type { FitFrame } from "./fittedPartCommand";
export const useFittedPart = create<{ frame?: FitFrame }>(() => ({}));
