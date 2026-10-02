import { create } from "zustand";
import type { SketchMeasurementRef } from "../cad/inspection/measurements";
interface InspectionState {
  session: number;
  first?: SketchMeasurementRef;
  second?: SketchMeasurementRef;
  entity?: SketchMeasurementRef;
  setReference(
    session: number,
    field: "first" | "second" | "entity",
    ref?: SketchMeasurementRef,
  ): void;
  clear(session: number): void;
}
export const useInspectionState = create<InspectionState>((set, get) => ({
  session: -1,
  setReference: (session, field, ref) =>
    set({
      ...(get().session === session
        ? {}
        : { first: undefined, second: undefined, entity: undefined }),
      session,
      [field]: ref,
    }),
  clear: (session) =>
    set({ session, first: undefined, second: undefined, entity: undefined }),
}));
