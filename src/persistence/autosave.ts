import type { CadDocument } from "../cad/document/schema";
import { serializeProject } from "./exportProject";
import { importProjectText } from "./projectCodec";
import { importProjectFile } from "./importProject";

export const AUTOSAVE_DB = "plaincad-recovery";
export const AUTOSAVE_DELAY_MS = 500;
export const AUTOSAVE_PROJECT_LIMIT = 5;
export interface RecoverySnapshot {
  text: string;
  savedAt: number;
  name: string;
  schemaVersion: number;
}
export interface RecoveryRecord {
  id: string;
  latest?: RecoverySnapshot;
  previous?: RecoverySnapshot;
  manual?: RecoverySnapshot;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = indexedDB.open(AUTOSAVE_DB, 1);
    let finished = false;
    const timeout = setTimeout(() => {
      finished = true;
      reject(new Error("Recovery storage timed out."));
    }, 8000);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects", { keyPath: "id" });
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (finished) {
        request.result.close();
        return;
      }
      finished = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      finished = true;
      clearTimeout(timeout);
      reject(request.error ?? new Error("Cannot open recovery storage."));
    };
    request.onblocked = () => {
      finished = true;
      clearTimeout(timeout);
      reject(new Error("Recovery storage is blocked by another tab."));
    };
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (
    store: IDBObjectStore,
    done: (value: T) => void,
    fail: (error: unknown) => void,
  ) => void,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction("projects", mode);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    let result: T;
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      db.close();
      if (error !== undefined) reject(error);
      else resolve(result);
    };
    const fail = (error: unknown) => {
      try {
        tx.abort();
      } catch {
        // An already finished transaction cannot abort; still report the failure.
      }
      finish(error);
    };
    const timeout = setTimeout(
      () => fail(new Error("Recovery storage transaction timed out.")),
      8000,
    );
    tx.oncomplete = () => finish();
    tx.onerror = tx.onabort = () =>
      finish(tx.error ?? new Error("Recovery storage transaction failed."));
    try {
      action(
        tx.objectStore("projects"),
        (value) => {
          result = value;
        },
        fail,
      );
    } catch (error) {
      fail(error);
    }
  });
}
export function listRecoveryRecords(): Promise<RecoveryRecord[]> {
  return transaction("readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done(request.result);
  });
}
export async function saveRecovery(
  document: CadDocument,
  manual = false,
  options: { exitFlush?: boolean } = {},
): Promise<void> {
  const text = serializeProject(document, false);
  const snapshot: RecoverySnapshot = {
    text,
    savedAt: Date.now(),
    name: document.name,
    schemaVersion: document.schemaVersion,
  };
  // Validate reopening off the UI thread; timestamp the authored snapshot before
  // asynchronous validation so manual-save ordering remains meaningful.
  if (typeof Worker !== "undefined" && !options.exitFlush)
    await importProjectFile(new File([text], "autosave.pcaddoc"));
  else importProjectText(text);
  await transaction<void>("readwrite", (store, done, fail) => {
    const get = store.get(document.id);
    get.onsuccess = () => {
      try {
        const record: RecoveryRecord = get.result ?? { id: document.id };
        if (manual) {
          if (!record.manual || snapshot.savedAt >= record.manual.savedAt)
            record.manual = snapshot;
        } else if (
          record.latest?.text !== text &&
          (!record.latest || snapshot.savedAt >= record.latest.savedAt)
        ) {
          record.previous = record.latest;
          record.latest = snapshot;
        }
        store.put(record);
        const all = store.getAll();
        all.onsuccess = () => {
          try {
            const records = (all.result as RecoveryRecord[]).sort((a, b) =>
              a.id === b.id
                ? 0
                : a.id === document.id
                  ? -1
                  : b.id === document.id
                    ? 1
                    : Math.max(b.latest?.savedAt ?? 0, b.manual?.savedAt ?? 0) -
                      Math.max(a.latest?.savedAt ?? 0, a.manual?.savedAt ?? 0),
            );
            for (const item of records.slice(AUTOSAVE_PROJECT_LIMIT))
              if (item.id !== document.id) store.delete(item.id);
            done();
          } catch (error) {
            fail(error);
          }
        };
      } catch (error) {
        fail(error);
      }
    };
  });
}
export function removeRecovery(id?: string): Promise<void> {
  return transaction("readwrite", (store, done) => {
    if (id) store.delete(id);
    else store.clear();
    done();
  });
}
export function recoveryCandidates(records: RecoveryRecord[]) {
  return records
    .filter(
      (r) =>
        r.latest &&
        r.latest.text !== r.manual?.text &&
        (!r.manual || r.latest.savedAt >= r.manual.savedAt),
    )
    .sort((a, b) => b.latest!.savedAt - a.latest!.savedAt);
}
export function recoverSnapshot(
  record: RecoveryRecord,
  previous = false,
): CadDocument {
  const snapshot = previous ? record.previous : record.latest;
  if (!snapshot) throw new Error("Recovery snapshot is unavailable.");
  const document = importProjectText(snapshot.text);
  if (document.id !== record.id)
    throw new Error("Recovery snapshot identity does not match its record.");
  return document;
}
