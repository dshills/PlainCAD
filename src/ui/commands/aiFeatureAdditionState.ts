import { create } from "zustand";
import type { AiFeatureAdditionFrame } from "./aiFeatureAdditionCommand";
export const useAiFeatureAddition = create<{ frame?: AiFeatureAdditionFrame }>(() => ({}));
