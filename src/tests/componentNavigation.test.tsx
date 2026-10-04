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

beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useViewerState.setState(useViewerState.getInitialState(), true);
});
afterEach(cleanup);
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
    expect(screen.getByLabelText("Show body Bracket solid")).not.toBeChecked();
    expect(screen.getByLabelText("Show body Bracket solid")).toBeDisabled();
    expect(screen.getByLabelText("Show body Cover solid")).toBeChecked();
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
    fireEvent.click(
      screen.getByRole("button", { name: "Isolate component Cover" }),
    );
    expect(screen.getByLabelText("Show component Cover")).toBeChecked();
    expect(screen.getByLabelText("Show component Bracket")).not.toBeChecked();
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
  it("independently hides sketch overlays, preserves hiding when restoring bodies and clears it for full views", () => {
    const { document, a, session } = project();
    useCadStore.setState({
      rebuild: {
        ...useCadStore.getState().rebuild,
        status: "succeeded",
        result: rebuildDocument(document),
      },
    });
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
    ).toBeChecked();
    expect(useCadStore.getState().history.present).toBe(document);
    expect(useCadStore.getState().history.past).toEqual([]);
    expect(serializeProject(document)).not.toContain("hiddenSketchIds");
  });
  it("rejects stale or missing sketch visibility contexts even when project IDs are reused", () => {
    const { document, session } = project(),
      sketchId = Object.keys(document.sketches)[0];
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
