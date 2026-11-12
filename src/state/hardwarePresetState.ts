import { create } from "zustand";
import type { CadDocument } from "../cad/document/schema";

export const useHardwarePreset = create<{ frame?: { document: CadDocument; session: number; componentId: string } }>(() => ({}));
