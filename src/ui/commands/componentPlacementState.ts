import { create } from "zustand";
import type { ComponentPlacementFrame } from "./componentPlacementCommand";
/** Runtime-only gesture ownership; no renderer or worker handles are durable. */
export const useComponentPlacement = create<{ frame?: ComponentPlacementFrame }>(() => ({}));
