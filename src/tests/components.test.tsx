import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  createExtrudeFeature,
  upsertFeature,
  upsertSketch,
} from "../cad/document/CadDocument";
import { addComponent, renameComponent } from "../cad/document/components";
import { validateDocument } from "../cad/document/validate";
import { addCenterRectangle, createXySketch } from "../cad/sketch/SketchModel";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { App } from "../app/App";
import { useCadStore } from "../state/useCadStore";
import {
  runCommand,
  selectCommandEnablement,
} from "../ui/commands/commandRegistry";
import {
  activeComponentId,
  finishProjectWorkflow,
  useProjectWorkflow,
} from "../ui/commands/projectWorkflowCommand";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";
import { upstreamBodyOwners } from "../cad/document/timelineEditing";

vi.mock("../viewer/CadViewer", () => ({ CadViewer: () => <div /> }));
beforeEach(() => {
  useCadStore.setState(useCadStore.getInitialState(), true);
  useCadStore.getState().setDocument(createEmptyDocument());
});
afterEach(() => {
  cleanup();
  useProjectWorkflow.setState({ active: undefined });
  useSketchCanvas.setState({ active: undefined });
});

function twoParts() {
  const a = addComponent(createEmptyDocument(), "Bracket"),
    b = addComponent(a.document, "Cover");
  const sketch = {
    ...addCenterRectangle(createXySketch("Section"), "20mm", "10mm"),
    componentId: a.component.id,
  };
  let document = upsertSketch(b.document, sketch);
  const base = createExtrudeFeature({
    name: "Base",
    sketchId: sketch.id,
    profileId: "unused",
    operation: "newBody",
    distance: { expression: "5mm", unit: "mm" },
    direction: "positive",
  });
  document = upsertFeature(document, base);
  return {
    document,
    a: a.component,
    b: b.component,
    sketch,
    base: document.features[0],
  };
}

describe("component project ownership", () => {
  it("preserves ownership, IDs and edits through save/open and undo/redo", () => {
    const parts = twoParts();
    expect(parts.base.componentId).toBe(parts.a.id);
    const reopened = importProjectText(serializeProject(parts.document));
    expect(reopened.components).toEqual(parts.document.components);
    expect(reopened.sketches[parts.sketch.id].componentId).toBe(parts.a.id);
    expect(reopened.features[0].componentId).toBe(parts.a.id);
    useCadStore.getState().setDocument(reopened);
    useCadStore.getState().activateComponent(parts.b.id);
    useCadStore
      .getState()
      .updateDocument((document) =>
        renameComponent(document, parts.b.id, "Lid"),
      );
    useCadStore.getState().undo();
    expect(
      useCadStore.getState().history.present.components[parts.b.id].name,
    ).toBe("Cover");
    useCadStore.getState().redo();
    expect(
      useCadStore.getState().history.present.components[parts.b.id].name,
    ).toBe("Lid");
    expect(
      JSON.parse(serializeProject(useCadStore.getState().history.present))
        .activeComponentId,
    ).toBeUndefined();
  });
  it("rejects lost ownership and cross-component modeling; target choices are scoped", () => {
    const { document, a, b, base, sketch } = twoParts();
    const other = { ...sketch, id: "other", entities: {}, componentId: b.id };
    let next = upsertSketch(document, other);
    const cut = {
      ...base,
      id: "cut",
      componentId: b.id,
      sketchId: "other",
      operation: "cut" as const,
      targetBodyIds: [`body:${base.id}`],
    };
    next = upsertFeature(next, cut);
    expect(upstreamBodyOwners(next, cut)).toEqual([]);
    expect(
      validateDocument(next, "storage").map((issue) => issue.message),
    ).toContain(
      "Modeling targets must belong to the feature’s component. Select a body in this component.",
    );
    expect(() => importProjectText(serializeProject(next))).toThrow(
      /Modeling targets must belong to the feature’s component/,
    );
    expect(() =>
      importProjectText(
        JSON.stringify({
          ...document,
          components: {
            [document.rootComponentId]:
              document.components[document.rootComponentId],
            [b.id]: b,
          },
        }),
      ),
    ).toThrow(/component was lost/);
    expect(() =>
      importProjectText(
        JSON.stringify({ ...document, rootComponentId: a.id, components: {} }),
      ),
    ).toThrow(/root component/);
    for (const componentId of ["constructor", "toString", "", null, 12]) {
      expect(() =>
        importProjectText(
          JSON.stringify({
            ...document,
            sketches: {
              ...document.sketches,
              [sketch.id]: { ...sketch, componentId },
            },
          }),
        ),
      ).toThrow(/component was lost/);
      expect(() =>
        importProjectText(
          JSON.stringify({ ...document, features: [{ ...base, componentId }] }),
        ),
      ).toThrow(/component was lost/);
    }
    expect(() => addComponent(document, " ")).toThrow(/name/);
  });
  it("reports malformed schema-11 collections before migration and preserves root IDs on collisions", () => {
    const document = createEmptyDocument();
    for (const patch of [{ sketches: null }, { features: {} }]) {
      expect(() =>
        importProjectText(
          JSON.stringify({ ...document, schemaVersion: 11, ...patch }),
        ),
      ).toThrow(/missing sketches|missing features/);
    }
    const legacy = {
      ...document,
      schemaVersion: 11,
      parameters: {
        size: {
          id: `component:${document.id}:root`,
          name: "size",
          expression: "1",
          value: 1,
          unit: "",
        },
      },
    };
    const migrated = importProjectText(JSON.stringify(legacy));
    expect(migrated.rootComponentId).toBe(`component:${document.id}:root:root`);
    expect(importProjectText(serializeProject(migrated)).rootComponentId).toBe(
      migrated.rootComponentId,
    );
  });
  it("reports invalid component rename through the store without changing history", () => {
    const document = useCadStore.getState().history.present;
    runCommand("component.rename", {
      componentId: document.rootComponentId,
      componentName: " ",
    });
    expect(useCadStore.getState().history.present).toBe(document);
    expect(useCadStore.getState().fileError).toBe(
      "Component name must contain 1–120 characters.",
    );
    expect(useCadStore.getState().history.past).toEqual([]);
  });
  it("undoing component creation resolves the active context to root", () => {
    useCadStore.getState().setDocument(createEmptyDocument());
    runCommand("component.create");
    finishProjectWorkflow(useProjectWorkflow.getState().active!, "Part");
    const id = activeComponentId(useCadStore.getState());
    useCadStore.getState().undo();
    expect(activeComponentId(useCadStore.getState())).toBe(
      useCadStore.getState().history.present.rootComponentId,
    );
    useCadStore.getState().redo();
    expect(useCadStore.getState().history.present.components[id]).toBeDefined();
    expect(useCadStore.getState().activeComponentId).toBe(
      useCadStore.getState().history.present.rootComponentId,
    );
  });
  it("limits creation, validates duplicate IDs, and cancels stale plane selection", () => {
    const { document } = twoParts();
    expect(
      validateDocument({
        ...document,
        components: {
          ...document.components,
          [document.id]: { id: document.id, name: "Duplicate" },
        },
      }).some((issue) => /Duplicate id/.test(issue.message)),
    ).toBe(true);
    const components = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [
        `c${i}`,
        { id: `c${i}`, name: `Part ${i}` },
      ]),
    );
    useCadStore.getState().setDocument({
      ...createEmptyDocument(),
      components,
      rootComponentId: "c0",
    });
    expect(selectCommandEnablement(useCadStore.getState()).newComponent).toBe(
      false,
    );
    expect(() =>
      addComponent(useCadStore.getState().history.present, "More"),
    ).toThrow(/too many/);
    runCommand("sketch.create");
    const active = useProjectWorkflow.getState().active!;
    useCadStore.getState().activateComponent("c1");
    expect(() => finishProjectWorkflow(active, "XY")).toThrow(/changed/);
    expect(
      Object.keys(useCadStore.getState().history.present.sketches),
    ).toEqual([]);
  });
  it("guides a blank project through a named component, plane choice and Finish Sketch", async () => {
    useCadStore.getState().setDocument(createEmptyDocument());
    render(<App />);
    const ribbon = screen.getByRole("navigation", {
      name: "Main CAD commands",
    });
    fireEvent.click(
      within(ribbon).getByRole("button", { name: "New component" }),
    );
    const componentDialog = screen.getByRole("dialog", {
      name: "New Component",
    });
    fireEvent.change(within(componentDialog).getByLabelText("Component name"), {
      target: { value: "Bracket" },
    });
    fireEvent.click(
      within(componentDialog).getByRole("button", { name: "Create component" }),
    );
    fireEvent.click(
      within(ribbon).getByRole("button", { name: "Create sketch" }),
    );
    const chooser = screen.getByRole("dialog", { name: "Create Sketch" });
    expect(chooser).toHaveTextContent("Bracket");
    fireEvent.click(
      within(chooser).getByRole("button", { name: "Sketch on XZ plane" }),
    );
    const canvas = screen.getByRole("dialog", { name: "Sketch canvas" });
    expect(canvas).toHaveTextContent("XZ");
    await act(async () => {
      await runCommand("sketch.addCenterRectangle");
    });
    fireEvent.click(
      within(canvas).getByRole("button", { name: "Finish Sketch" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        within(ribbon).getByRole("button", { name: "Extrude selected sketch" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(ribbon).getByRole("button", { name: "Extrude selected sketch" }),
    );
    await waitFor(() =>
      expect(useCadStore.getState().history.present.features).toHaveLength(1),
    );
    const state = useCadStore.getState(),
      sketch = Object.values(state.history.present.sketches)[0];
    expect(state.history.present.components[sketch.componentId!].name).toBe(
      "Bracket",
    );
    expect(state.history.present.features[0].componentId).toBe(
      sketch.componentId,
    );
    expect(state.selection.selectedIds[0].kind).toBe("feature");
  });
});
