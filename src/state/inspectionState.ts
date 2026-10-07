import { create } from "zustand";
import type { CadDocument, UnitSettings } from "../cad/document/schema";
import type { RebuildResult } from "../cad/worker/workerProtocol";
import type { SketchMeasurementRef } from "../cad/inspection/measurements";
interface InspectionState {
  session: number;
  picking: boolean;
  unit?: UnitSettings["length"];
  targetIds: string[];
  document?: CadDocument;
  result?: RebuildResult;
  error?: string;
  setPicking(session: number, picking: boolean): void;
  setUnit(session: number, unit: UnitSettings["length"]): void;
  setError(session: number, error: string): void;
  pick(session: number, document: CadDocument, result: RebuildResult, id: string): void;
  clearModel(): void;
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
const emptyReferences = { first: undefined, second: undefined, entity: undefined, targetIds: [] as string[], document: undefined, result: undefined, error: undefined };
export const useInspectionState = create<InspectionState>((set, get) => ({
  session: -1,
  picking: false,
  targetIds: [],
  setPicking: (session, picking) => set({ session, picking, targetIds: [], document: undefined, result: undefined, error: undefined, first: undefined, second: undefined, entity: undefined, ...(get().session !== session ? { unit: undefined } : {}) }),
  setUnit: (session, unit) => set({ ...(get().session !== session ? { ...emptyReferences, picking: false } : {}), session, unit }),
  setError: (session, error) => set({ ...(get().session !== session ? { ...emptyReferences, picking: false, unit: undefined } : {}), session, error }),
  pick: (session, document, result, id) => {
    const state = get();
    const previous = state.session === session && state.document === document && state.result === result ? state.targetIds : [];
    set({ ...(state.session !== session ? { ...emptyReferences, picking: false, unit: undefined } : {}), session, document, result, error: undefined, targetIds: previous.length === 1 && previous[0] !== id ? [...previous, id] : [id] });
  },
  clearModel: () => set({ targetIds: [], document: undefined, result: undefined, error: undefined }),
  setReference: (session, field, ref) =>
    set({
      ...(get().session === session
        ? {}
        : { ...emptyReferences, picking: false, unit: undefined }),
      session,
      [field]: ref,
    }),
  clear: (session) =>
    set({ session, ...emptyReferences, ...(get().session !== session ? { picking: false, unit: undefined } : {}) }),
}));
