import { ViewPanel } from "../ui/panels/ViewPanel";
import { BodyPanel } from "../ui/panels/BodyPanel";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addComponent } from "../cad/document/components";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import { stableBodyIdForFeature } from "../cad/features/featureGraph";
import { detectProfiles } from "../cad/sketch/profileDetection";
import { solveSketch } from "../cad/sketch/SketchSolver";
import { addCornerRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { serializeProject } from "../persistence/exportProject";
import { useCadStore } from "../state/useCadStore";
import { hiddenViewerBodies, useViewerState } from "../state/viewerState";
import { runCommand } from "../ui/commands/commandRegistry";
import { FeatureTimeline } from "../ui/panels/FeatureTimeline";
import { SketchPanel } from "../ui/panels/SketchPanel";
import { InspectorPanel } from "../ui/panels/InspectorPanel";
import { FabricationPanel } from "../ui/panels/FabricationPanel";
import { openFabrication, useFileJobs } from "../persistence/fileJobs";

beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useViewerState.setState(useViewerState.getInitialState(), true);
  useFileJobs.getState().cancel();
  useFileJobs.setState({ exportOpen: false });
});
afterEach(() => {
  cleanup();
  useFileJobs.getState().cancel();
  useFileJobs.setState({ exportOpen: false });
});
function project() {
  const a = addComponent(createEmptyDocument(), "Bracket"),
    b = addComponent(a.document, "Cover");
  let document = b.document;
  for (const component of [a.component, b.component]) {
    const sketch = {
      ...addCornerRectangle(
        createXySketch(`${component.name} section`),
        "20mm",
        "10mm",
      ),
      componentId: component.id,
    };
    document = upsertSketch(document, sketch);
    const profiles = detectProfiles(solveSketch(sketch, {})).profiles;
    expect(profiles).toHaveLength(1);
    document = upsertFeature(
      document,
      createExtrudeFeature({
        name: `${component.name} solid`,
        sketchId: sketch.id,
        profileId: profiles[0].id,
        operation: "newBody",
        distance: { expression: "10mm", unit: "mm" },
        direction: "positive",
      }),
    );
  }
  useCadStore.getState().setDocument(document);
  return {
    document: useCadStore.getState().history.present,
    a: a.component,
    b: b.component,
    session: useCadStore.getState().documentSession,
    bodies: useCadStore
      .getState()
      .history.present.features.map((f) => stableBodyIdForFeature(f.id)),
  };
}
describe("component navigation", () => {
  it("presents the same part identity in the browser, inspector and export choices while retaining source feature names", () => {
    const { document } = project();
    useCadStore.setState({ rebuild: {
      status: "succeeded", kernelReady: true, result: rebuildDocument(document),
    } });
    render(<><BodyPanel /><InspectorPanel /><FabricationPanel /></>);
    fireEvent.click(screen.getByRole("button", { name: "Bracket" }));
    expect(screen.getByText("Generated from Bracket solid")).toBeInTheDocument();
    expect(screen.getAllByText("Bracket", { exact: true })).toHaveLength(2);
    act(() => openFabrication());
    expect(screen.getByLabelText("Export body Bracket")).toBeChecked();
    expect(screen.getByLabelText("Export body Cover")).toBeChecked();
    expect(useCadStore.getState().history.present.features[0].name).toBe("Bracket solid");
    expect(useCadStore.getState().history.past).toEqual([]);
  });
  it("routes edge and movement preferences through shared commands without adding history or project data", async () => {
    const { document } = project();
    render(<ViewPanel />);
    await screen.findByLabelText("Show model edges");
    expect(screen.getByLabelText("Show model edges")).toBeChecked();
    expect(screen.getByLabelText("Optimize while moving")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Show model edges"));
    fireEvent.click(screen.getByLabelText("Optimize while moving"));
    expect(useViewerState.getState()).toMatchObject({ showModelEdges: false, optimizeWhileMoving: false });
    act(() => runCommand("view.toggleModelEdges"));
    expect(screen.getByLabelText("Show model edges")).toBeChecked();
    expect(useCadStore.getState().history.present).toBe(document);
    expect(useCadStore.getState().history.past).toEqual([]);
    expect(serializeProject(document)).not.toMatch(/showModelEdges|optimizeWhileMoving/);
    act(() => useCadStore.getState().setDocument(document));
    expect(screen.getByLabelText("Optimize while moving")).toBeChecked();
  });

  it("hides and isolates owned bodies without editing history or persistence, resets on replacement and ignores stale commands", () => {
    const { document, a, b, session, bodies } = project();
    runCommand("component.toggleVisibility", { componentId: a.id });
    expect(
      hiddenViewerBodies(document, bodies, session, useViewerState.getState()),
    ).toEqual([]);
    runCommand("component.toggleVisibility", {
      componentId: a.id,
      documentSession: session,
    });
    expect(
      hiddenViewerBodies(document, bodies, session, useViewerState.getState()),
    ).toEqual([bodies[0]]);
    // Newly rebuilt bodies inherit their component visibility.
    const newFeature = { ...document.features[0], id: "later-body" };
    const next = { ...document, features: [...document.features, newFeature] };
    expect(
      hiddenViewerBodies(
        next,
        [...bodies, "body:later-body"],
        session,
        useViewerState.getState(),
      ),
    ).toEqual([bodies[0], "body:later-body"]);
    runCommand("component.isolate", {
      componentId: a.id,
      documentSession: session,
    });
    expect(
      hiddenViewerBodies(document, bodies, session, useViewerState.getState()),
    ).toEqual([bodies[1]]);
    expect(useCadStore.getState().history.present).toBe(document);
    expect(useCadStore.getState().history.past).toEqual([]);
    expect(serializeProject(document)).not.toMatch(
      /hiddenComponentIds|hiddenBodyIds|activeComponentTimeline/,
    );
    useCadStore.getState().setDocument(document);
    const replacement = useCadStore.getState().documentSession;
    expect(
      hiddenViewerBodies(
        document,
        bodies,
        replacement,
        useViewerState.getState(),
      ),
    ).toEqual([]);
    runCommand("component.toggleVisibility", {
      componentId: b.id,
      documentSession: session,
    });
    expect(
      hiddenViewerBodies(
        document,
        bodies,
        replacement,
        useViewerState.getState(),
      ),
    ).toEqual([]);
    runCommand("view.showAllComponents");
    expect(useViewerState.getState().hiddenComponentIds).toEqual([]);
  });
  it("shows component hiding consistently in an unscoped body list", () => {
    const { document, a, session } = project();
    useCadStore.setState({
      rebuild: {
        ...useCadStore.getState().rebuild,
        status: "succeeded",
        result: rebuildDocument(document),
      },
    });
    render(<BodyPanel />);
    act(() => {
      runCommand("component.toggleVisibility", {
        componentId: a.id,
        documentSession: session,
      });
    });
    expect(screen.getByLabelText("Show body Bracket")).not.toBeChecked();
    expect(screen.getByLabelText("Show body Bracket")).toBeDisabled();
    expect(screen.getByLabelText("Show body Cover")).toBeChecked();
  });
  it("labels ownership and filters the timeline as the active component changes without altering global ordering", () => {
    const { document, a } = project();
    render(
      <>
        <SketchPanel />
        <FeatureTimeline />
      </>,
    );
    const track = screen.getByRole("list", {
      name: "Sketch and feature history",
    });
    expect(within(track).getAllByRole("listitem")).toHaveLength(4);
    expect(track.querySelectorAll(".timeline-owner")).toHaveLength(4);
    act(() => useCadStore.getState().activateComponent(a.id));
    fireEvent.click(screen.getByLabelText("Timeline: active component only"));
    expect(within(track).getAllByRole("listitem")).toHaveLength(2);
    expect(track).toHaveTextContent("Bracket solid");
    expect(track).not.toHaveTextContent("Cover solid");
    fireEvent.click(
      screen.getByRole("button", { name: "Activate component Cover" }),
    );
    expect(track).toHaveTextContent("Cover solid");
    expect(track).not.toHaveTextContent("Bracket solid");
    fireEvent.click(screen.getByLabelText("Actions for component Cover"));
    fireEvent.click(
      screen.getByRole("button", { name: "Isolate component Cover" }),
    );
    expect(screen.getByLabelText("Show component Cover")).toBeChecked();
    expect(screen.getByLabelText("Show component Bracket")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Exit isolation" }));
    expect(screen.getByLabelText("Show component Bracket")).toBeChecked();
    expect(useViewerState.getState().hiddenBodyIds).toEqual([]);
    expect(useViewerState.getState().hiddenSketchIds).toEqual(Object.keys(document.sketches));
    expect(screen.queryByRole("button", { name: "Exit isolation" })).toBeNull();
    expect(useCadStore.getState().history.present).toBe(document);
    act(() => useCadStore.getState().setDocument(document));
    expect(
      screen.getByLabelText("Timeline: active component only"),
    ).not.toBeChecked();
    expect(within(track).getAllByRole("listitem")).toHaveLength(4);
    expect(useCadStore.getState().activeComponentId).toBe(
      document.rootComponentId,
    );
  });
  it("uses inline component navigation, keeps empty root content quiet and reveals matching sketch descendants", () => {
    const { document, a, b } = project();
    useCadStore.setState({ rebuild: {
      status: "succeeded", kernelReady: true, result: rebuildDocument(document),
    } });
    render(<SketchPanel compact />);
    const root = screen.getByRole("button", { name: "Activate component Root Component" }).closest(".component-node")!;
    expect(root.querySelector(".browser-folder")).toBeNull();
    expect(screen.queryByText("Origin", { exact: true })).toBeNull();
    const bracket = screen.getByRole("button", { name: "Activate component Bracket" });
    const heading = bracket.closest(".component-heading")!;
    expect(within(heading as HTMLElement).getByLabelText("Show component Bracket")).toBeChecked();
    expect(heading.querySelector(".component-actions")).toBeInTheDocument();
    fireEvent.click(bracket);
    expect(useCadStore.getState().activeComponentId).toBe(a.id);
    expect(bracket).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Bracket" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search project"), { target: { value: "cover section" } });
    expect(screen.getByRole("button", { name: /Cover section/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate component Cover" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate component Bracket" })).toBeNull();
    expect(useCadStore.getState().activeComponentId).toBe(a.id);
    act(() => useCadStore.getState().setDocument(document));
    expect(screen.getByLabelText("Search project")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Activate component Cover" })).toBeInTheDocument();
    expect(useCadStore.getState().history.past).toEqual([]);
    expect(document.components[b.id].name).toBe("Cover");
  });
  it("keeps rename inside contextual actions and preserves component identity with undo", () => {
    const { a } = project();
    act(() => useCadStore.getState().activateComponent(a.id));
    render(<SketchPanel compact />);
    const menu = screen.getByLabelText("Actions for component Bracket").closest("details")!;
    menu.open = true;
    const input = within(menu).getByLabelText("Component name");
    (input as HTMLInputElement).focus();
    fireEvent.change(input, { target: { value: "Bracket revised" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useCadStore.getState().history.present.components[a.id].name).toBe("Bracket revised");
    expect(useCadStore.getState().activeComponentId).toBe(a.id);
    menu.open = true;
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(menu).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Actions for component Bracket revised")).toHaveFocus();
    act(() => useCadStore.getState().undo());
    expect(screen.getByRole("button", { name: "Activate component Bracket" })).toBeInTheDocument();
  });
  it("commits a pending rename before outside dismissal while internal focus keeps actions open", () => {
    const { a } = project();
    act(() => useCadStore.getState().activateComponent(a.id));
    render(<SketchPanel compact />);
    const summary = screen.getByLabelText("Actions for component Bracket");
    const menu = summary.closest("details")!;
    menu.open = true;
    fireEvent(menu, new Event("toggle"));
    const input = within(menu).getByLabelText("Component name") as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Renamed by leaving" } });
    fireEvent.pointerDown(summary);
    expect(menu.open).toBe(true);
    expect(useCadStore.getState().history.present.components[a.id].name).toBe("Bracket");
    fireEvent.pointerDown(screen.getByLabelText("Search project"));
    expect(menu.open).toBe(false);
    expect(useCadStore.getState().history.present.components[a.id].name).toBe("Renamed by leaving");
    expect(useCadStore.getState().history.past).toHaveLength(1);
    expect(useCadStore.getState().activeComponentId).toBe(a.id);
    menu.open = true;
    fireEvent(menu, new Event("toggle"));
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Escaped draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(menu.open).toBe(false);
    expect(useCadStore.getState().history.present.components[a.id].name).toBe("Renamed by leaving");
    expect(useCadStore.getState().history.past).toHaveLength(1);
  });
  it("allows Escape to reach workspace shortcuts when contextual actions are closed", () => {
    project();
    let escaped = 0;
    render(<div onKeyDown={(event) => { if (event.key === "Escape") escaped++; }}><SketchPanel compact /></div>);
    const summary = screen.getByLabelText("Actions for component Root Component");
    const menu = summary.closest("details")!;
    fireEvent.keyDown(summary, { key: "Escape" });
    expect(escaped).toBe(1);
    menu.open = true;
    fireEvent.keyDown(summary, { key: "Escape" });
    expect(escaped).toBe(1);
    expect(menu).not.toHaveAttribute("open");
  });
  it("opens used sketches hidden, keeps unused/suppressed sources visible and resets same-ID sessions", () => {
    const { document, session } = project();
    const sourceIds = Object.keys(document.sketches);
    expect(useViewerState.getState().hiddenSketchIds).toEqual(sourceIds);
    const unused = createXySketch("Unused drawing");
    const suppressedId = document.features[1].id;
    const reopened = upsertSketch({ ...document, features: document.features.map((feature) =>
      feature.id === suppressedId ? { ...feature, suppressed: true } : feature,
    ) }, unused);
    runCommand("view.showAllComponents");
    useCadStore.getState().setDocument(reopened);
    const state = useCadStore.getState();
    expect(state.documentSession).toBe(session + 1);
    expect(useViewerState.getState().session).toBe(state.documentSession);
    expect(useViewerState.getState().hiddenSketchIds).toEqual([sourceIds[0]]);
    render(<SketchPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Expand component Bracket" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand component Cover" }));
    expect(screen.getByLabelText("Show sketch Bracket section in 3D")).not.toBeChecked();
    expect(screen.getByLabelText("Show sketch Cover section in 3D")).toBeChecked();
    expect(screen.getByLabelText("Show sketch Unused drawing in 3D")).toBeChecked();
    expect(state.history.past).toEqual([]);
    expect(serializeProject(state.history.present)).not.toContain("hiddenSketchIds");
  });
  it("independently hides sketch overlays, preserves hiding when restoring bodies and clears it for full views", () => {
    const { document, a, session } = project();
    useCadStore.setState({
      rebuild: {
        ...useCadStore.getState().rebuild,
        status: "succeeded",
        result: rebuildDocument(document),
      },
    });
    runCommand("view.showAllComponents");
    render(<SketchPanel />);
    act(() => useCadStore.getState().activateComponent(a.id));
    const sketch = Object.values(document.sketches).find(
      (item) => item.componentId === a.id,
    )!;
    fireEvent.click(screen.getByLabelText("Show sketch Bracket section in 3D"));
    expect(useViewerState.getState().hiddenSketchIds).toEqual([sketch.id]);
    fireEvent.click(screen.getByLabelText("Show component Bracket"));
    expect(
      screen.getByLabelText("Show sketch Bracket section in 3D"),
    ).toBeDisabled();
    expect(
      screen.getByLabelText("Show sketch Bracket section in 3D"),
    ).not.toBeChecked();
    act(() => runCommand("view.showAllBodies"));
    expect(screen.getByLabelText("Show component Bracket")).toBeChecked();
    expect(
      screen.getByLabelText("Show sketch Bracket section in 3D"),
    ).toBeEnabled();
    expect(
      screen.getByLabelText("Show sketch Bracket section in 3D"),
    ).not.toBeChecked();
    act(() => runCommand("view.showAllComponents"));
    expect(
      screen.getByLabelText("Show sketch Bracket section in 3D"),
    ).toBeChecked();
    act(() => {
      runCommand("sketch.toggleVisibility", {
        sketchId: sketch.id,
        documentSession: session,
      });
      runCommand("component.isolate", {
        componentId: a.id,
        documentSession: session,
      });
    });
    expect(
      screen.getByLabelText("Show sketch Bracket section in 3D"),
    ).not.toBeChecked();
    expect(useCadStore.getState().history.present).toBe(document);
    expect(useCadStore.getState().history.past).toEqual([]);
    expect(serializeProject(document)).not.toContain("hiddenSketchIds");
  });
  it("rejects stale or missing sketch visibility contexts even when project IDs are reused", () => {
    const { document, session } = project(),
      sketchId = Object.keys(document.sketches)[0];
    runCommand("view.showAllComponents");
    runCommand("sketch.toggleVisibility", { sketchId });
    runCommand("sketch.toggleVisibility", {
      sketchId: "lost",
      documentSession: session,
    });
    expect(useViewerState.getState().hiddenSketchIds).toEqual([]);
    runCommand("sketch.toggleVisibility", {
      sketchId,
      documentSession: session,
    });
    expect(useViewerState.getState().hiddenSketchIds).toEqual([sketchId]);
    useCadStore.getState().setDocument(document);
    const replacement = useCadStore.getState().documentSession;
    runCommand("view.showAllComponents");
    runCommand("sketch.toggleVisibility", {
      sketchId,
      documentSession: session,
    });
    expect(useViewerState.getState().session).toBe(replacement);
    expect(useViewerState.getState().hiddenSketchIds).toEqual([]);
    runCommand("sketch.toggleVisibility", {
      sketchId,
      documentSession: replacement,
    });
    expect(useViewerState.getState().hiddenSketchIds).toEqual([sketchId]);
  });
});
