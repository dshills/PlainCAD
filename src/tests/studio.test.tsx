import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCadStore } from "../state/useCadStore";
import { useViewerState, type StudioMaterial } from "../state/viewerState";
import { createBoxTemplate } from "../templates/templates";
import { serializeProject } from "../persistence/exportProject";
import { runCommand } from "../ui/commands/commandRegistry";
import { setStudioAppearance } from "../ui/commands/studioCommand";
import { StudioPanel } from "../viewer/StudioPanel";
import { ModelMeshes } from "../viewer/modelMeshes";
import { studioBackground } from "../viewer/studioAppearance";
import { registerCameraController } from "../viewer/cameraController";
import { DEFAULT_CAMERA_POSE } from "../cad/inspection/cameraViews";
import { LazyPanelBoundary } from "../ui/design-system/LazyPanelBoundary";
import { ViewPanel } from "../ui/panels/ViewPanel";
import { useSectionState } from "../state/sectionState";
import type { RenderMesh } from "../cad/kernel/KernelAdapter";

beforeEach(() => {
  useCadStore.setState({ ...useCadStore.getInitialState(), history: { present: createBoxTemplate(), past: [], future: [] }, documentSession: 31 }, true);
  useViewerState.setState(useViewerState.getInitialState(), true);
  const state = useCadStore.getState();
  useViewerState.getState().openDocument(state.history.present, state.documentSession);
  useViewerState.getState().setPresentationMode(state.documentSession, "render");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useCadStore.setState(useCadStore.getInitialState(), true);
  useViewerState.setState(useViewerState.getInitialState(), true);
  useSectionState.setState(useSectionState.getInitialState(), true);
});

function context() {
  const state = useCadStore.getState();
  return { session: state.documentSession, documentId: state.history.present.id };
}

describe("product photo studio", () => {
  it("contains optional panel chunk failures while leaving the local editor available", () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    function FailedChunk(): never { throw new Error("Chunk unavailable"); }
    render(<><button type="button">Keep modeling</button><LazyPanelBoundary label="Photo studio"><FailedChunk /></LazyPanelBoundary></>);
    expect(screen.getByRole("alert")).toHaveTextContent("Photo studio could not open. Save your project, then reload to retry.");
    expect(screen.getByRole("button", { name: "Keep modeling" })).toBeEnabled();
    report.mockRestore();
  });

  it("changes display finishes/backdrop through shared commands without history, rebuild or durable data", async () => {
    const before = useCadStore.getState(), savedBefore = serializeProject(before.history.present);
    render(<StudioPanel hasGeometry />);
    fireEvent.change(screen.getByLabelText("Studio finish"), { target: { value: "metal" } });
    await waitFor(() => expect(useViewerState.getState().studioMaterial).toBe("metal"));
    fireEvent.change(screen.getByLabelText("Studio backdrop"), { target: { value: "warm" } });
    await waitFor(() => expect(useViewerState.getState().studioBackdrop).toBe("warm"));
    expect(useCadStore.getState().history).toBe(before.history);
    expect(useCadStore.getState().rebuild).toBe(before.rebuild);
    expect(serializeProject(useCadStore.getState().history.present)).toBe(savedBefore);
    expect(screen.getByRole("button", { name: "Download studio PNG" })).toBeDisabled();
  });

  it("reports an application failure separately from a command-load failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const before = useCadStore.getState();
    useViewerState.setState({ setStudioAppearance: () => { throw new Error("Appearance unavailable"); } });
    await expect(runCommand("view.studioAppearance", { studio: { ...context(), material: "metal" } })).resolves.toBeUndefined();
    expect(useCadStore.getState().history).toBe(before.history);
    expect(useCadStore.getState().fileError).toContain("Studio settings could not be applied");
    expect(useCadStore.getState().fileError).not.toContain("could not load");
    expect(useViewerState.getState().studioMaterial).toBe("original");
  });

  it("retains section-offset validation and diagnostics in lazily loaded Views", async () => {
    const session = useCadStore.getState().documentSession;
    useSectionState.getState().setSection(session, "Z", 3, true);
    render(<ViewPanel />);
    const offset = await screen.findByLabelText("Section offset (mm)");
    fireEvent.change(offset, { target: { value: "not_a_number" } });
    fireEvent.blur(offset);
    expect(screen.getByRole("alert")).toHaveTextContent("Section offset must be finite and within ±1e9 mm.");
    expect(useSectionState.getState().offset).toBe(3);
  });

  it("rejects late imports, replaced same-ID projects, stale sessions, file work and non-Render controls", async () => {
    const captured = useCadStore.getState(), settings = { ...context(), material: "metal" as const };
    useCadStore.setState({ rebuild: { ...captured.rebuild } });
    // Status-only changes preserve the captured result and remain view-only.
    expect(await setStudioAppearance(settings, captured)).toBe(true);
    useCadStore.setState({ documentSession: captured.documentSession + 1 });
    expect(await setStudioAppearance(settings, captured)).toBe(false);
    useCadStore.setState({ ...captured, history: { ...captured.history, present: { ...captured.history.present } } });
    expect(await setStudioAppearance(settings, captured)).toBe(false);
    useCadStore.setState(captured, true);
    useViewerState.getState().setPresentationMode(captured.documentSession, "model");
    expect(await setStudioAppearance(settings, captured)).toBe(false);
    useViewerState.getState().setPresentationMode(captured.documentSession, "render");
    useCadStore.setState({ fileBusy: true });
    expect(await setStudioAppearance(settings, captured)).toBe(false);
  });

  it("validates runtime settings and resets them on reopen while remembering Render settings across mode switches", async () => {
    const state = useCadStore.getState(), view = useViewerState.getState();
    expect(await setStudioAppearance({ ...context(), material: "unsupported" as StudioMaterial }, state)).toBe(false);
    expect(await setStudioAppearance({ ...context(), material: "metal", backdrop: "dark" }, state)).toBe(true);
    view.setPresentationMode(state.documentSession, "model");
    view.setStudioAppearance(state.documentSession, { material: "powder" });
    expect(useViewerState.getState().studioMaterial).toBe("metal");
    view.setPresentationMode(state.documentSession, "render");
    expect(useViewerState.getState()).toMatchObject({ studioMaterial: "metal", studioBackdrop: "dark" });
    view.openDocument(state.history.present, state.documentSession + 1);
    expect(useViewerState.getState()).toMatchObject({ presentationMode: "model", studioMaterial: "original", studioBackdrop: "theme" });
    view.setStudioAppearance(state.documentSession, { material: "powder" });
    expect(useViewerState.getState().studioMaterial).toBe("original");
  });

  it("uses existing standard camera and fitting commands for compositions", async () => {
    const preset = vi.fn(), fit = vi.fn();
    const unregister = registerCameraController({ read: () => DEFAULT_CAMERA_POSE, apply: () => true, preset });
    window.addEventListener("plaincad:fit-view", fit);
    try {
      expect(await setStudioAppearance({ ...context(), composition: "isometric" }, useCadStore.getState())).toBe(true);
      expect(preset).toHaveBeenCalledWith("isometric");
      expect(fit).toHaveBeenCalledOnce();
      expect(useCadStore.getState().history.past).toEqual([]);
    } finally {
      unregister();
      window.removeEventListener("plaincad:fit-view", fit);
    }
  });

  it("rolls back a failed composition without applying appearance or replacing project data", async () => {
    const apply = vi.fn(() => true);
    const unregister = registerCameraController({ read: () => DEFAULT_CAMERA_POSE, apply, preset: () => { throw new Error("Camera unavailable"); } });
    const before = useCadStore.getState();
    try {
      expect(await setStudioAppearance({ ...context(), composition: "isometric", material: "metal", backdrop: "warm" }, before)).toBe(false);
      expect(apply).toHaveBeenCalledWith(DEFAULT_CAMERA_POSE);
      expect(useViewerState.getState()).toMatchObject({ studioMaterial: "original", studioBackdrop: "theme" });
      expect(useCadStore.getState().history).toBe(before.history);
      expect(useCadStore.getState().fileError).toContain("Studio camera could not be composed");
    } finally { unregister(); }
  });

  it("diagnoses a camera read failure before changing composition or finish", async () => {
    const preset = vi.fn();
    const unregister = registerCameraController({ read: () => { throw new Error("Camera unavailable"); }, apply: () => true, preset });
    const before = useCadStore.getState();
    try {
      expect(await setStudioAppearance({ ...context(), composition: "isometric", material: "metal" }, before)).toBe(false);
      expect(preset).not.toHaveBeenCalled();
      expect(useViewerState.getState().studioMaterial).toBe("original");
      expect(useCadStore.getState().history).toBe(before.history);
      expect(useCadStore.getState().fileError).toContain("Studio camera could not be composed");
    } finally { unregister(); }
  });

  it("does not fit after a composition invalidates the viewer session", async () => {
    const session = useCadStore.getState().documentSession, fit = vi.fn();
    const unregister = registerCameraController({ read: () => DEFAULT_CAMERA_POSE, apply: () => true, preset: () => useViewerState.setState({ session: session + 1 }) });
    window.addEventListener("plaincad:fit-view", fit);
    try {
      expect(await setStudioAppearance({ ...context(), composition: "isometric" }, useCadStore.getState())).toBe(false);
      expect(fit).not.toHaveBeenCalled();
    } finally {
      unregister();
      window.removeEventListener("plaincad:fit-view", fit);
    }
  });

  it("reuses native buffers, normal splits and materials for every finish and restores source Model colors", () => {
    const cache = new ModelMeshes();
    const source: RenderMesh = { id: "part", bodyId: "part", positions: [0, 0, 0, 10, 0, 0, 0, 10, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], bounds: { min: [0, 0, 0], max: [10, 10, 0] }, color: "#e03020" };
    const saved = structuredClone(source);
    cache.update([source]);
    const body = cache.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const geometry = body.geometry, material = body.material;
    const dispose = vi.spyOn(geometry, "dispose");
    try {
      cache.setPresentationMode("render", "metal");
      expect(material).toMatchObject({ roughness: 0.48, metalness: 0.65 });
      expect(material.color.getHexString()).toBe("bbc4cc");
      cache.update([{ ...source, positions: [...Array.from(source.positions)] }]);
      expect(cache.group.children[0]).toBe(body);
      expect(body.geometry).toBe(geometry);
      expect(body.material).toBe(material);
      expect(material.color.getHexString()).toBe("bbc4cc");
      cache.setPresentationMode("render", "powder");
      expect(material).toMatchObject({ roughness: 0.85, metalness: 0 });
      expect(material.color.getHexString()).toBe("e03020");
      cache.setPresentationMode("model", "metal");
      expect(material).toMatchObject({ roughness: 0.55, metalness: 0.05 });
      expect(material.color.getHexString()).toBe("e03020");
      expect(dispose).not.toHaveBeenCalled();
      expect(source).toEqual(saved);
    } finally { cache.dispose(); }
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("restores theme backgrounds in Model while retaining independent Render backdrops", () => {
    expect(studioBackground("render", "warm", "#ffffff")).toBe("#e8dfcf");
    expect(studioBackground("render", "theme", "#030e14")).toBe("#030e14");
    expect(studioBackground("model", "dark", "#e7ebe8")).toBe("#e7ebe8");
  });
});
