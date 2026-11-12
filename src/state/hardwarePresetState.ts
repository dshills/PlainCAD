import { create } from "zustand";
import type { CadDocument } from "../cad/document/schema";

export interface HardwareFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  thread?: { targetBodyId: string; editId?: string; reactivate?: boolean };
  lead?: { editId?: string; screwId?: string; reactivate?: boolean };
}

export const useHardwarePreset = create<{ frame?: HardwareFrame }>(() => ({}));
