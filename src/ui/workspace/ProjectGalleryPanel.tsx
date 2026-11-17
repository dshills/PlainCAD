import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { useCadStore } from "../../state/useCadStore";
import { prepareProjectDrop } from "../commands/projectDropCommand";
import { importProjectFile } from "../../persistence/importProject";
import { recentGalleryProjects, type GalleryProject } from "../../persistence/projectGallery";
import { previewModeling } from "../../cad/worker/extrudePreviewClient";
import { NativeKernel } from "../../cad/kernel/NativeKernel";
import type { NativeGeometrySource } from "../../cad/kernel/geometrySource";
import { drawGalleryPreview, galleryPreviewFaces } from "../../viewer/galleryPreview";
import { GALLERY_COLLECTIONS, GALLERY_DIFFICULTIES, GALLERY_EXAMPLES } from "./projectGalleryCatalog";
import { closeProjectGallery, useProjectGallery } from "./projectGalleryState";
import "./projectGallery.css";

interface Card { id: string; name: string; thumbnail?: string; parts: number; features: number; complexity: string; collection?: string; text?: string; projectUrl?: string; description?: string; parameter?: string; plainSolidLimit?: string }
function blockedExample(card: Card, source: NativeGeometrySource): string | undefined {
  return source === "plainsolid" ? card.plainSolidLimit : undefined;
}
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
  const [collection, setCollection] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [compatible, setCompatible] = useState(false);
  const [live, setLive] = useState(false);
  const [active, setActive] = useState<Card>();
  const recentHeading = useRef<HTMLHeadingElement>(null);
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
    if (request.current || busy || blockedExample(card, NativeKernel.source)) return;
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
  const words = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (card: Card) => {
    const searchable = [card.name, card.description, card.collection, card.complexity, card.parameter].join(" ").toLowerCase();
    return words.every(word => searchable.includes(word));
  };
  const examples = GALLERY_EXAMPLES.filter(card => matches(card) &&
    (!collection || card.collection === collection) &&
    (!difficulty || card.complexity === difficulty) &&
    (!compatible || !blockedExample(card, NativeKernel.source)),
  );
  const hasUnavailableExamples = GALLERY_EXAMPLES.some(card => blockedExample(card, NativeKernel.source));
  const saved = recent.filter(matches);
  function clearFilters() {
    setSearch("");
    setCollection("");
    setDifficulty("");
    setCompatible(false);
    setActive(undefined);
  }
  function cards(entries: Card[]) {
    return <ul className="gallery-grid">{entries.map(card => {
      const limit = blockedExample(card, NativeKernel.source);
      const detailsId = limit ? `gallery-limit-${card.id}` : undefined;
      const unavailable = busy || Boolean(limit);
      return <li className="gallery-card" key={card.id} onPointerEnter={() => { if (live && !reduced && !unavailable) setActive(card); }} onPointerLeave={() => setActive(current => current?.id === card.id ? undefined : current)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(current => current?.id === card.id ? undefined : current); }}>
        <div className="gallery-picture">{card.thumbnail ? <img src={card.thumbnail} alt={`${card.name} actual native CAD geometry`} loading="lazy" decoding="async"/> : <p>No saved cover yet</p>}{active?.id === card.id && !limit ? <GalleryLivePreview card={active}/> : null}</div>
        <div className="gallery-card-copy">
          <p className="gallery-card-category">{card.collection ? `${card.collection} · ` : ""}{card.complexity}</p>
          <h3>{card.name}</h3>
          <p>{card.description ?? "Your last manually saved editable project."}</p>
          <p className="gallery-counts">{card.parts} {card.text !== undefined ? (card.parts === 1 ? "component" : "components") : (card.parts === 1 ? "part" : "parts")} · {card.features} {card.features === 1 ? "feature" : "features"}</p>
          <div className="gallery-card-actions">
            {limit ? <p className="gallery-parameter" id={detailsId}><strong>Requires the OpenCascade comparison build.</strong> {limit}</p> : card.parameter ? <p className="gallery-parameter"><strong>Try</strong> {card.parameter}</p> : null}
            <div className="gallery-card-buttons">
              <button type="button" disabled={unavailable} aria-label={`Open ${card.name}`} aria-describedby={detailsId} onClick={() => void open(card)}>Open</button>
              {live && !reduced ? <button type="button" disabled={unavailable} aria-label={`Preview ${card.name}`} aria-describedby={detailsId} onFocus={() => setActive(card)} onClick={() => setActive({ ...card })}>Preview</button> : null}
            </div>
          </div>
        </div>
      </li>;
    })}</ul>;
  }
  return <ModalDialog label="Project gallery" className="project-gallery" onDismiss={closeProjectGallery}>
    <div className="gallery-heading"><div><h2>Project gallery</h2><p>Open an editable example and try the suggested change.</p></div><button type="button" onClick={closeProjectGallery}>Close gallery</button></div>
    <div className="gallery-controls">
      <div className="gallery-filter-fields">
        <label>Find a project<input type="search" value={search} onChange={event => { setSearch(event.target.value); setActive(undefined); }} placeholder="Name, feature, or suggested edit"/></label>
        <label>Collection<select value={collection} onChange={event => { setCollection(event.target.value); setActive(undefined); }}>
          <option value="">All collections</option>
          {GALLERY_COLLECTIONS.map(item => <option key={item}>{item}</option>)}
        </select></label>
        <label>Difficulty<select value={difficulty} onChange={event => { setDifficulty(event.target.value); setActive(undefined); }}>
          <option value="">Any difficulty</option>
          {GALLERY_DIFFICULTIES.map(item => <option key={item}>{item}</option>)}
        </select></label>
      </div>
      <div className="gallery-filter-options">
        {hasUnavailableExamples ? <label><input type="checkbox" checked={compatible} onChange={event => { setCompatible(event.target.checked); setActive(undefined); }}/>Works with PlainSolid</label> : null}
        <label><input type="checkbox" checked={live && !reduced} disabled={reduced} onChange={event => { setLive(event.target.checked); setActive(undefined); }}/>Live native previews</label>
        {reduced ? <span>Reduced motion uses static covers.</span> : null}
        {recent.length ? <button className="gallery-recent-link" type="button" onClick={() => recentHeading.current?.focus()}>Recent saves</button> : null}
      </div>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {busy ? <p role="status">Opening project…</p> : null}
    <section aria-label="Example projects">
      <div className="gallery-results"><h3>Example projects</h3><p role="status">{examples.length} of {GALLERY_EXAMPLES.length} examples</p></div>
      {examples.length ? cards(examples) : <div className="gallery-empty"><p>No examples match these filters.</p><button type="button" onClick={clearFilters}>Clear filters</button></div>}
    </section>
    <section aria-label="Recent saved projects"><h3 ref={recentHeading} tabIndex={-1}>Recent saved projects</h3><p>Manually saved copies on this browser. Find newer autosaves in Recovery.</p>{loading ? <p role="status">Reading saved projects…</p> : saved.length ? cards(saved) : <p>{recent.length ? "No saved projects match your search." : "Save a project to add it here."}</p>}</section>
  </ModalDialog>;
}
export function ProjectGalleryPanel() {
  const open = useProjectGallery(state => state.open);
  return open ? <GalleryContents/> : null;
}
