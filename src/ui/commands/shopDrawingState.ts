import { create } from "zustand";
export interface DrawingSession { session: number; documentId: string; bodyId: string }
export const useShopDrawing = create<{ frame?: DrawingSession }>(() => ({}));
