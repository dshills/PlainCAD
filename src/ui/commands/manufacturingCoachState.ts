import { create } from "zustand";
import type { CoachFrame } from "./manufacturingCoachCommand";
export const useManufacturingCoach = create<{ frame?: CoachFrame }>(() => ({}));
