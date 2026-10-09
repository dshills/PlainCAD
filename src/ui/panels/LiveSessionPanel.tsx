import { useEffect, useState } from "react";
import { connectLiveSession, copyLiveCapability, useLiveSessionState } from "../../commands/liveSession";
import { invokeCommand } from "../../commands/registry";
import "./LiveSessionPanel.css";

/** Embed in the automation dock. Capabilities remain memory-only and absent from DOM. */
export function LiveSessionPanel() {
  const state = useLiveSessionState();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  useEffect(() => { setNotice(undefined); }, [state.connectionId]);
  const message = state.error || notice?.text;
  return <section className="live-session-panel" aria-label="Live agent connection">
    <h3>Work with an external agent</h3>
    <p>Connect an agent to this open project. It uses the same commands, selection and Undo. Anyone with the copied capability can edit this project until you disconnect.</p>
    {state.status === "disconnected" ? <button type="button" onClick={event => {
      setNotice(undefined);
      const trusted = event.nativeEvent.isTrusted;
      void Promise.resolve().then(() => connectLiveSession(trusted)).catch(error => setNotice({ text: error instanceof Error ? error.message : "Connection failed.", error: true }));
    }}>Connect live agent</button> : <>
      <button type="button" onClick={() => { setNotice(undefined); void Promise.resolve().then(() => invokeCommand("live.disconnect", "domain")).catch(error => setNotice({ text: error instanceof Error ? error.message : "Disconnect failed.", error: true })); }}>Disconnect live agent</button>
      <button type="button" disabled={state.status !== "connected"} onClick={event => {
        const connectionId = state.connectionId;
        const current = () => useLiveSessionState.getState().status === "connected" && useLiveSessionState.getState().connectionId === connectionId;
        void copyLiveCapability(event.nativeEvent.isTrusted).then(() => { if (current()) setNotice({ text: "Capability copied. Pass it privately in PLAINCAD_LIVE_TOKEN." }); }, error => { if (current()) setNotice({ text: error instanceof Error ? error.message : "Clipboard unavailable.", error: true }); });
      }}>Copy agent capability</button>
      <p role="status">{state.status === "connecting" ? "Connecting…" : `Connected · ${state.completed} commands completed`}</p>
    </>}
    {message ? <p role={state.error || notice?.error ? "alert" : "status"}>{message}</p> : null}
    <p>Disconnect stops queued commands. A command already delivered may finish; inspect the project before retrying a timed-out request.</p>
  </section>;
}
