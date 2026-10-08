import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";
import { prepareProjectDrop } from "../commands/projectDropCommand";
import { importProjectFile } from "../../persistence/importProject";
import { recentGalleryProjects, type GalleryProject } from "../../persistence/projectGallery";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { drawGalleryPreview, galleryPreviewFaces } from "../../viewer/galleryPreview";
import { GALLERY_EXAMPLES } from "./projectGalleryCatalog";
import { closeProjectGallery, useProjectGallery } from "./projectGalleryState";
import "./projectGallery.css";

interface Card { id: string; name: string; thumbnail?: string; parts: number; features: number; complexity: string; text?: string; projectUrl?: string; description?: string; parameter?: string }
async function projectFile(card: Card, signal: AbortSignal): Promise<File> {
  if (card.text !== undefined) return new File([card.text], `${card.name}.pcaddoc`);
  if (!card.projectUrl) throw new Error("This example has no project file. Open another example or a local project.");
  const response = await fetch(card.projectUrl, { signal });
  if (!response.ok) throw new Error(`The example could not be loaded (${response.status}).`);
  return new File([await response.blob()], `${card.name}.pcaddoc`);
}
function GalleryLivePreview({ card }: { card: Card }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState("Rebuilding native preview…");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setReady(false); setMessage("Rebuilding native preview…");
    let frame: number | undefined;
    const stop = () => { controller.abort(); if (frame !== undefined) cancelAnimationFrame(frame); };
    const visibility = () => { if (document.hidden) { stop(); setMessage("Preview paused. Select Preview to restart."); } };
    document.addEventListener("visibilitychange", visibility);
    void (async () => {
      try {
        const file = await projectFile(card, controller.signal);
        const project = await importProjectFile(file, controller.signal);
        const result = await previewModeling(project, controller.signal);
        if (controller.signal.aborted || !canvas.current) return;
        if (!result.success) throw new Error(result.errors[0]?.message ?? "Native preview could not rebuild.");
        const faces = galleryPreviewFaces(result.meshes);
        drawGalleryPreview(canvas.current, faces, 0);
        setReady(true); setMessage("Native geometry · rotating preview");
        let start: number | undefined;
        let lastDraw = 0;
        const animate = (time: number) => {
          if (!canvas.current || controller.signal.aborted) return;
          if (start === undefined) { start = time; lastDraw = time; }
          const elapsed = time - start;
          if (elapsed >= 5000) { setMessage("Native geometry · preview paused"); return; }
          if (time - lastDraw >= (faces.faces.length > 5000 ? 200 : 100)) {
            try { drawGalleryPreview(canvas.current, faces, Math.sin(elapsed / 1700) * 0.45); }
            catch (error) { setReady(false); setMessage(error instanceof Error ? error.message : "Preview rendering is unavailable."); return; }
            lastDraw = time;
          }
          frame = requestAnimationFrame(animate);
        };
        frame = requestAnimationFrame(animate);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Live preview is unavailable. Open this project to explore it.");
      }
    })();
    return () => { stop(); document.removeEventListener("visibilitychange", visibility); };
  }, [card]);
  return <div className="gallery-live"><canvas ref={canvas} width={240} height={200} hidden={!ready} aria-label={`Native rotating preview of ${card.name}`}/><span role="status">{message}</span></div>;
}
function GalleryContents() {
  const [recent, setRecent] = useState<GalleryProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(false);
  const [active, setActive] = useState<Card>();
  const request = useRef<AbortController>(undefined);
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const changed = () => { setReduced(Boolean(media?.matches)); setActive(undefined); };
    media?.addEventListener("change", changed);
    return () => media?.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void recentGalleryProjects(controller.signal).then(({ projects, warnings }) => { if (!controller.signal.aborted) { setRecent(projects); if (warnings.length) setError(warnings.join(" ")); } }).catch(error => { if (!controller.signal.aborted) setError(`Recent projects could not be read: ${error instanceof Error ? error.message : String(error)}`); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  async function open(card: Card) {
    if (request.current || busy) return;
    const state = useCadStore.getState(), project = state.history.present, session = state.documentSession;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(undefined); setActive(undefined);
    try {
      const file = await projectFile(card, controller.signal);
      if (controller.signal.aborted) return;
      const current = useCadStore.getState();
      if (current.history.present !== project || current.documentSession !== session) throw new Error("The current project changed. Reopen the gallery before loading this project.");
      request.current = undefined;
      closeProjectGallery();
      // Replacement validation reports to the shared file error surface after this dialog closes.
      try { await prepareProjectDrop(file); } catch (error) { useCadStore.getState().setFileError(error instanceof Error ? error.message : String(error)); }
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (request.current === controller) request.current = undefined; if (!controller.signal.aborted) setBusy(false); }
  }
  const matches = (card: Card) => `${card.name} ${card.complexity} ${card.description ?? ""}`.toLowerCase().includes(search.toLowerCase().trim());
  function cards(entries: Card[]) {
    return <ul className="gallery-grid">{entries.filter(matches).map(card => <li className="gallery-card" key={card.id} onPointerEnter={() => { if (live && !reduced && !busy) setActive(card); }} onPointerLeave={() => setActive(current => current?.id === card.id ? undefined : current)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(current => current?.id === card.id ? undefined : current); }}>
      <div className="gallery-picture">{card.thumbnail ? <img src={card.thumbnail} alt={`${card.name} actual native CAD geometry`} loading="lazy"/> : <p>No saved cover yet. Open to explore the actual model.</p>}{active?.id === card.id ? <GalleryLivePreview card={active}/> : null}</div>
      <div className="gallery-card-copy"><span className="gallery-complexity">{card.complexity}</span><h3>{card.name}</h3><p>{card.description ?? "Your last manually saved editable project."}</p><p className="gallery-counts">{card.parts} {card.text !== undefined ? "components" : "parts"} · {card.features} features</p>{card.parameter ? <p className="gallery-parameter">Try {card.parameter}</p> : null}<button type="button" disabled={busy} onClick={() => void open(card)}>Open {card.name}</button>{live && !reduced ? <button type="button" className="gallery-preview-button" disabled={busy} onFocus={() => setActive(card)} onClick={() => setActive({ ...card })}>Preview {card.name}</button> : null}</div>
    </li>)}</ul>;
  }
  return <ModalDialog label="Project gallery" className="project-gallery" onDismiss={closeProjectGallery}>
    <div className="gallery-heading"><div><p className="gallery-eyebrow">PLAINCAD / EXPLORE</p><h2>Make something yours.</h2><p>Open an editable design, explore its history, then change a parameter.</p></div><button type="button" onClick={closeProjectGallery}>Close gallery</button></div>
    <div className="gallery-controls"><label>Find a project<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or complexity"/></label><label><input type="checkbox" checked={live} disabled={reduced} onChange={event => { setLive(event.target.checked); setActive(undefined); }}/>Live native previews</label><span>{reduced ? "Reduced motion: static covers." : "Optional rotation runs for five seconds while hovered or focused."}</span></div>
    {error ? <p role="alert">{error}</p> : null}
    {busy ? <p role="status">Opening project…</p> : null}
    <section aria-label="Recent saved projects"><h3>Recent saved projects</h3><p>Last manually saved copies on this browser. Newer autosaves remain available in Recovery. Keep downloaded project files as your portable copies.</p>{loading ? <p role="status">Reading saved projects…</p> : recent.length ? cards(recent) : <p>Save a project to add it here.</p>}</section>
    <section aria-label="Example projects"><h3>Example projects</h3><p>Ten mechanical designs, from two parts to forty. Try the suggested parameter edit to explore each design.</p>{cards(GALLERY_EXAMPLES)}{!GALLERY_EXAMPLES.some(matches) && !recent.some(matches) ? <p>No projects match your search.</p> : null}</section>
  </ModalDialog>;
}
export function ProjectGalleryPanel() {
  const open = useProjectGallery(state => state.open);
  return open ? <GalleryContents/> : null;
}
