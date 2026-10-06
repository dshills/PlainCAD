import { create } from "zustand";
/** Runtime intent only; never serialized into CAD files. */
export const useFacePocketIntent = create<{ source?: { sketchId: string; documentId: string; session: number; componentId: string } }>(() => ({}));
