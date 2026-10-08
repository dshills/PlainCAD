import { create } from "zustand";
export interface FamilySession { session: number; documentId: string }
export const useProductFamily = create<{ frame?: FamilySession }>(() => ({}));
