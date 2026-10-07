import { create } from "zustand";
import type { CadDocument } from "../../cad/document/schema";
export interface ReusablePartFrame {
  document: CadDocument;
  session: number;
  source?: CadDocument;
  filename?: string;
  error?: string;
  reading: boolean;
}
export const useReusablePart = create<{
  frame?: ReusablePartFrame;
}>(() => ({}));
