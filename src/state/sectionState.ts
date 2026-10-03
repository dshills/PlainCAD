import { create } from "zustand";
import { sectionPlane, type SectionAxis } from "../cad/inspection/cameraViews";
interface SectionState {
  session: number;
  axis?: SectionAxis;
  offset: number;
  positive: boolean;
  setSection(
    session: number,
    axis: SectionAxis | undefined,
    offset: number,
    positive: boolean,
  ): void;
  clear(session: number): void;
}
export const useSectionState = create<SectionState>((set) => ({
  session: -1,
  offset: 0,
  positive: true,
  setSection: (session, axis, offset, positive) => {
    sectionPlane(axis ?? "X", offset, positive);
    set({ session, axis, offset, positive });
  },
  clear: (session) =>
    set({ session, axis: undefined, offset: 0, positive: true }),
}));
