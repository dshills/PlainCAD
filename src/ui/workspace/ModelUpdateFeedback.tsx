import { useEffect, useRef, useState } from "react";
import type { RenderMesh } from "../../cad/kernel/KernelAdapter";
import { useCadStore } from "../../state/useCadStore";
import "./workbenchMotion.css";

function sameValues(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

export function sameModelGeometry(a: readonly RenderMesh[], b: readonly RenderMesh[]) {
  return a.length === b.length && a.every((mesh, index) => {
    const other = b[index];
    return mesh.bodyId === other.bodyId && sameValues(mesh.positions, other.positions) && sameValues(mesh.indices, other.indices);
  });
}

/** A confirmation follows accepted native results, never a click or draft preview. */
export function ModelUpdateFeedback() {
  const session = useCadStore((state) => state.documentSession);
  const documentId = useCadStore((state) => state.history.present.id);
  const rebuild = useCadStore((state) => state.rebuild);
  const previous = useRef<{ session: number; meshes?: readonly RenderMesh[]; result?: typeof rebuild.result }>({ session });
  const [confirmation, setConfirmation] = useState(0);
  useEffect(() => {
    if (previous.current.session !== session) {
      previous.current = { session };
      setConfirmation(0);
    }
    const result = rebuild.result;
    if (rebuild.status !== "succeeded" || !result?.success || result.documentId !== documentId || previous.current.result === result) return;
    previous.current.result = result;
    if (result.meshes.some((mesh) => mesh.geometrySource !== "opencascade" || !mesh.geometryAssertions?.valid || mesh.geometryAssertions.solidCount < 1 || !Number.isFinite(mesh.geometryAssertions.volume) || mesh.geometryAssertions.volume <= 0)) return;
    const before = previous.current.meshes;
    previous.current.meshes = result.meshes;
    if (before && !sameModelGeometry(before, result.meshes)) setConfirmation((value) => value + 1);
  }, [session, documentId, rebuild]);
  useEffect(() => {
    if (!confirmation) return;
    const timeout = window.setTimeout(() => setConfirmation(0), 1800);
    return () => window.clearTimeout(timeout);
  }, [confirmation]);
  return <div className="model-update-feedback" aria-live="polite" aria-atomic="true">
    {confirmation ? <span key={confirmation} className="model-update-confirmation">✓ Model updated</span> : null}
  </div>;
}
