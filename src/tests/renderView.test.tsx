import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useCadStore } from "../state/useCadStore";
import { useViewerState } from "../state/viewerState";
import { createBoxTemplate } from "../templates/templates";
import { serializeProject } from "../persistence/exportProject";
import { ViewPanel } from "../ui/panels/ViewPanel";
import { ViewerToolbar } from "../viewer/ViewerToolbar";
import { runCommand } from "../ui/commands/commandRegistry";
import { createPresentationLights } from "../viewer/presentationLights";

beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useViewerState.setState(useViewerState.getInitialState(), true);
  useCadStore.getState().setDocument(createBoxTemplate());
});
afterEach(cleanup);

describe("Model and Render presets", () => {
  it("routes both controls through commands and preserves independent appearance and visibility without document edits", async () => {
    const state = useCadStore.getState(), doc = state.history.present, session = state.documentSession;
    const view = useViewerState.getState();
    view.toggleBody(session, "kept-hidden", ["kept-hidden"]);
    view.toggleComponent(session, "component-hidden", ["component-hidden"]);
    const hiddenSketches = view.hiddenSketchIds;
    render(<><ViewerToolbar hasGeometry /><ViewPanel /></>);
    const toolbar = within(screen.getByRole("group", { name: "Viewport controls" }));
    expect(toolbar.getByRole("button", { name: "Model view" })).toHaveAttribute("aria-pressed", "true");
    await screen.findByLabelText("Show model edges");
    fireEvent.click(screen.getByLabelText("Show model edges"));
    fireEvent.click(screen.getByLabelText("Show ground grid"));
    fireEvent.click(toolbar.getByRole("button", { name: "Render view" }));
    expect(screen.getByLabelText("Show ground grid")).not.toBeChecked();
    expect(screen.getByLabelText("Show model edges")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Render presentation preset" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("Show ground grid"));
    fireEvent.click(screen.getByLabelText("Show model edges"));
    fireEvent.click(screen.getByRole("button", { name: "Model presentation preset" }));
    expect(screen.getByLabelText("Show ground grid")).not.toBeChecked();
    expect(screen.getByLabelText("Show model edges")).not.toBeChecked();
    act(() => runCommand("view.render"));
    expect(screen.getByLabelText("Show ground grid")).toBeChecked();
    expect(screen.getByLabelText("Show model edges")).toBeChecked();
    expect(useViewerState.getState()).toMatchObject({ hiddenBodyIds: ["kept-hidden"], hiddenComponentIds: ["component-hidden"], hiddenSketchIds: hiddenSketches });
    expect(useCadStore.getState().history.present).toBe(doc);
    expect(useCadStore.getState().history.past).toEqual([]);
    expect(serializeProject(doc)).not.toMatch(/presentationMode|showGrid|modelPreferences|renderPreferences/);
  });

  it("resets presets on a same-ID document reopen and ignores commands for a replaced session", () => {
    const doc = useCadStore.getState().history.present;
    act(() => runCommand("view.render"));
    act(() => runCommand("view.toggleGrid"));
    const session = useCadStore.getState().documentSession;
    act(() => useCadStore.getState().setDocument(doc));
    expect(useViewerState.getState()).toMatchObject({ presentationMode: "model", showGrid: true, showModelEdges: true });
    act(() => runCommand("view.render", { documentSession: session }));
    expect(useViewerState.getState().presentationMode).toBe("model");
    act(() => runCommand("view.render"));
    expect(useViewerState.getState()).toMatchObject({ presentationMode: "render", showGrid: false, showModelEdges: false });
  });

  it("uses fixed key/fill/rim lights without shadows or texture resources and restores original Model lighting", () => {
    const scene = new THREE.Scene(), lights = createPresentationLights(scene);
    lights.setMode("model");
    expect(scene.children.filter((light) => light.visible)).toHaveLength(2);
    const before = [...scene.children];
    lights.setMode("render");
    expect(scene.children.filter((light) => light.visible)).toHaveLength(4);
    expect(scene.children).toEqual(before);
    expect(scene.children.every((light) => light instanceof THREE.Light && !light.castShadow)).toBe(true);
    lights.setMode("model");
    expect(scene.children.filter((light) => light.visible)).toHaveLength(2);
    expect((scene.children[0] as THREE.HemisphereLight).intensity).toBe(2.6);
    expect((scene.children[1] as THREE.DirectionalLight).intensity).toBe(2);
  });
});
