import { create } from "zustand";

interface ViewerState {
  session: number;
  hiddenBodyIds: string[];
  toggleBody(
    session: number,
    bodyId: string,
    availableIds: readonly string[],
  ): void;
  showAll(session: number): void;
}

// Runtime view preferences never enter document history or project JSON.
export const useViewerState = create<ViewerState>((set, get) => ({
  session: -1,
  hiddenBodyIds: [],
  toggleBody: (session, bodyId, availableIds) => {
    const hidden =
      get().session === session
        ? get().hiddenBodyIds.filter((id) => availableIds.includes(id))
        : [];
    set({
      session,
      hiddenBodyIds: hidden.includes(bodyId)
        ? hidden.filter((id) => id !== bodyId)
        : [...hidden, bodyId],
    });
  },
  showAll: (session) => set({ session, hiddenBodyIds: [] }),
}));
