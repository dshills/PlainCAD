import { create } from "zustand";
import type { CadDocument } from "../../cad/document/schema";
import type { RebuildResult } from "../../cad/worker/workerProtocol";
import type { Point3 } from "../../cad/sketch/planes";
import type { DamagedLibraryEntry, PartLibraryEntry } from "../../persistence/partLibrary";
export interface LibraryPlacement {
  entry: PartLibraryEntry;
  origin: Point3;
  candidate: CadDocument;
  componentId: string;
  result?: RebuildResult;
}
export interface PartLibraryFrame {
  document: CadDocument;
  session: number;
  componentId: string;
  result?: RebuildResult;
  entries: PartLibraryEntry[];
  damaged: DamagedLibraryEntry[];
  limited: boolean;
  busy: boolean;
  error?: string;
  notice?: string;
  placement?: LibraryPlacement;
  transfer?: { filename: string; entries?: PartLibraryEntry[] };
}
/** Runtime ownership: saved entries contain only portable CAD and a bounded thumbnail. */
export const usePartLibrary = create<{ frame?: PartLibraryFrame }>(() => ({}));
