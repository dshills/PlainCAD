import { ModalDialog } from "../ModalDialog";
import type { CadDocument } from "../../cad/document/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCadStore } from "../../state/useCadStore";
import {
  AUTOSAVE_DELAY_MS,
  listRecoveryRecords,
  recoveryCandidates,
  removeRecovery,
  saveRecovery,
  type RecoveryRecord,
} from "../../persistence/autosave";
import { importProjectFile } from "../../persistence/importProject";
export function RecoveryPanel() {
  const document = useCadStore((s) => s.history.present);
  const [candidates, setCandidates] = useState<RecoveryRecord[]>([]),
    [ready, setReady] = useState(false),
    [status, setStatus] = useState("Checking recovery storage…"),
    [error, setError] = useState<string>(),
    [recovering, setRecovering] = useState(false);
  const startupId = useRef(document.id);
  const recoveryJob = useRef<AbortController | undefined>(undefined);
  const current = useRef(document),
    mounted = useRef(true),
    writing = useRef(false),
    pending = useRef<CadDocument | undefined>(undefined);
  current.current = document;
  const checkStorage = useCallback(() => {
    setReady(false);
    return listRecoveryRecords()
      .then((records) => {
        if (mounted.current) {
          setCandidates(
            current.current.id === startupId.current
              ? recoveryCandidates(records)
              : [],
          );
          setReady(true);
          setError(undefined);
          setStatus("Autosave ready");
        }
      })
      .catch((e) => {
        if (mounted.current) {
          setError(String(e));
          setStatus("Autosave unavailable");
        }
      });
  }, []);
  useEffect(() => {
    mounted.current = true;
    void checkStorage();
    return () => {
      mounted.current = false;
      recoveryJob.current?.abort();
    };
  }, [checkStorage]);
  useEffect(() => {
    if (document.id !== startupId.current) setCandidates([]);
  }, [document.id]);
  useEffect(() => {
    if (!ready || candidates.length) return;
    const save = (exitFlush = false) => {
      const snapshot = current.current;
      if (
        !snapshot.features.length &&
        !Object.keys(snapshot.sketches).length &&
        !Object.keys(snapshot.parameters).length &&
        !useCadStore.getState().history.past.length
      )
        return;
      setStatus("Autosaving…");
      if (exitFlush) {
        // Begin storage without waiting for a worker or an older queued save.
        // Snapshot timestamps prevent an older worker completion replacing this.
        void saveRecovery(snapshot, false, { exitFlush: true })
          .then(() => {
            if (mounted.current) {
              setStatus("Autosaved locally");
              setError(undefined);
            }
          })
          .catch((e) => {
            if (mounted.current) {
              setStatus("Autosave unavailable");
              setError(e instanceof Error ? e.message : String(e));
            }
          });
        return;
      }
      pending.current = snapshot;
      if (writing.current) return;
      writing.current = true;
      void (async () => {
        try {
          while (pending.current) {
            const next = pending.current;
            pending.current = undefined;
            await saveRecovery(next);
            if (mounted.current) {
              setStatus("Autosaved locally");
              setError(undefined);
            }
          }
        } catch (e) {
          if (mounted.current) {
            setStatus("Autosave unavailable");
            setError(e instanceof Error ? e.message : String(e));
          }
        } finally {
          writing.current = false;
        }
      })();
    };
    const timer = setTimeout(() => save(), AUTOSAVE_DELAY_MS);
    const flush = () => save(true);
    const hidden = () => {
      if (globalThis.document.visibilityState === "hidden") flush();
    };
    globalThis.document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(timer);
      globalThis.document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
    };
  }, [document, ready, candidates.length]);
  const recover = async (record: RecoveryRecord, previous = false) => {
    const baseline = useCadStore.getState().history.present;
    const controller = new AbortController();
    recoveryJob.current?.abort();
    recoveryJob.current = controller;
    setRecovering(true);
    try {
      const snapshot = previous ? record.previous : record.latest;
      if (!snapshot) throw new Error("Recovery snapshot is unavailable.");
      const recovered = await importProjectFile(
        new File([snapshot.text], "recovery.pcaddoc"),
        controller.signal,
      );
      if (recovered.id !== record.id)
        throw new Error(
          "Recovery snapshot identity does not match its record.",
        );
      if (!mounted.current) return;
      if (useCadStore.getState().history.present !== baseline)
        throw new Error(
          "Project changed during recovery. Your current edits were preserved; retry recovery when ready.",
        );
      useCadStore.getState().setDocument(recovered);
      setCandidates([]);
      setError(undefined);
    } catch (e) {
      if (mounted.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (recoveryJob.current === controller) {
        recoveryJob.current = undefined;
        if (mounted.current) setRecovering(false);
      }
    }
  };
  const dismiss = () => {
    if (recovering) return;
    setCandidates([]);
    setStatus("Recovery kept; autosave ready");
  };
  const errorBanner = error ? (
    <div className="kernel-banner error" role="alert">
      <span>
        Recovery storage: {error}. Keep working in memory and use Save project
        to download a copy.
      </span>
      <button disabled={recovering} onClick={() => void checkStorage()}>
        Retry recovery storage
      </button>
      <button
        disabled={recovering}
        onClick={() => {
          if (
            !window.confirm(
              "Delete all local autosave and recovery snapshots? Downloaded project files will remain available.",
            )
          )
            return;
          void removeRecovery()
            .then(() => {
              setCandidates([]);
              setReady(true);
              setError(undefined);
              setStatus("Recovery storage cleared");
            })
            .catch((e) => setError(String(e)));
        }}
      >
        Clear all autosaves
      </button>
    </div>
  ) : null;
  return (
    <>
      <div className="autosave-status" role="status">
        {status}
      </div>
      {candidates.length ? (
        <ModalDialog
          className="file-dialog"
          label="Recover unsaved project"
          onDismiss={dismiss}
        >
          <h2>Recover unsaved work</h2>
          <p>
            Recovery replaces the current project. Your downloaded project files
            are unchanged.
          </p>
          {candidates.map((record) => (
            <div key={record.id}>
              <strong>{record.latest!.name}</strong>
              <p>{new Date(record.latest!.savedAt).toLocaleString()}</p>
              <button
                disabled={recovering}
                onClick={() => void recover(record)}
              >
                Recover {record.latest!.name}
              </button>
              {record.previous ? (
                <button
                  disabled={recovering}
                  onClick={() => void recover(record, true)}
                >
                  Recover previous snapshot
                </button>
              ) : null}
            </div>
          ))}
          {errorBanner}
          <button disabled={recovering} onClick={dismiss}>
            Start without recovery
          </button>
        </ModalDialog>
      ) : null}
      {!candidates.length ? errorBanner : null}
    </>
  );
}
