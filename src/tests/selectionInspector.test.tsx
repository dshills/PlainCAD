import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InspectorPanel } from "../ui/panels/InspectorPanel";
import { RebuildErrorsPanel } from "../ui/panels/RebuildErrorsPanel";
import { useCadStore } from "../state/useCadStore";
import { createBoxTemplate } from "../templates/templates";
import { createMountingPlateTemplate } from "../templates/templates";

describe("selection and inspection", () => {
  it("marks unsupported extrude directions and to-face termination unavailable", () => {
    const document = createBoxTemplate();
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [{ kind: "feature", id: document.features[0].id, documentId: document.id }] },
    });
    render(<InspectorPanel />);
    expect(screen.queryByText(/geometry is unavailable/)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Positive" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Negative unavailable" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Symmetric unavailable" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "To face unavailable" })).toBeDisabled();
  });

  it.each(["fillet", "chamfer"] as const)("explains unavailable %s geometry for imported features", (type) => {
    const document = createBoxTemplate();
    const feature = type === "fillet"
      ? { id: "edge-treatment", name: "Round", type, targetEdgeRefs: [], radius: { expression: "1mm", unit: "mm" } }
      : { id: "edge-treatment", name: "Break", type, targetEdgeRefs: [], distance: { expression: "1mm", unit: "mm" } };
    document.features.push(feature);
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [{ kind: "feature", id: feature.id, documentId: document.id }] },
    });
    const { rerender } = render(<InspectorPanel />);
    expect(screen.getByText(/geometry is unavailable/)).toHaveTextContent("Suppress or delete");
    act(() => useCadStore.setState({ history: { past: [], present: { ...document, features: document.features.map((item) => item.id === feature.id ? { ...item, suppressed: true } : item) }, future: [] } }));
    rerender(<InspectorPanel />);
    expect(screen.queryByText(/geometry is unavailable/)).not.toBeInTheDocument();
  });

  it("shows body mesh facts and routes to the source feature", async () => {
    const document = createBoxTemplate();
    const feature = document.features[0];
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [{ kind: "body", id: "body_1", documentId: document.id }] },
      rebuild: {
        status: "succeeded",
        kernelReady: true,
        result: {
          documentId: document.id,
          success: true,
          bodies: [{ id: "body_1", name: "Box Body", featureId: feature.id }],
          meshes: [
            {
              id: "mesh_1",
              bodyId: "body_1",
              positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
              normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
              indices: [0, 1, 2],
              bounds: { min: [0, 0, 0], max: [1, 1, 0] },
            },
          ],
          errors: [],
          warnings: [],
          durationMs: 1,
        },
      },
    });

    render(<InspectorPanel />);
    expect(screen.getByText("Box Body")).toBeInTheDocument();
    expect(screen.getByText("Vertices")).toBeInTheDocument();
    expect(screen.getByText("Triangles")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Select Source Feature/i }));
    expect(useCadStore.getState().selection.selectedIds[0]).toMatchObject({ kind: "feature", id: feature.id });
  });

  it("edits selected sketch and parameter details in the inspector", async () => {
    const document = createMountingPlateTemplate();
    const sketch = Object.values(document.sketches)[0];
    act(() => useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [{ kind: "sketch", id: sketch.id, documentId: document.id }] },
    }));

    const { rerender } = render(<InspectorPanel />);
    const nameInput = screen.getByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Base Plate");
    await userEvent.tab();

    expect(useCadStore.getState().history.present.sketches[sketch.id].name).toBe("Base Plate");

    act(() => useCadStore.setState({
      selection: { selectedIds: [{ kind: "parameter", id: "plate_width", documentId: document.id }] },
    }));
    rerender(<InspectorPanel />);
    const expressionInput = screen.getByLabelText("plate_width expression");
    await userEvent.clear(expressionInput);
    await userEvent.type(expressionInput, "120mm");
    await userEvent.tab();

    expect(useCadStore.getState().history.present.parameters.plate_width.expression).toBe("120mm");
  });

  it("links rebuild errors back to source objects and shows file errors", async () => {
    const document = createBoxTemplate();
    const feature = document.features[0];
    useCadStore.setState({
      history: { past: [], present: document, future: [] },
      selection: { selectedIds: [] },
      fileError: "Project file is not valid JSON.",
      rebuild: {
        status: "failed",
        kernelReady: true,
        result: {
          documentId: document.id,
          success: false,
          bodies: [],
          meshes: [],
          errors: [{ id: "feature:error", source: "feature", sourceId: feature.id, message: "Extrude failed." }],
          warnings: [],
          durationMs: 2,
        },
      },
    });

    render(<RebuildErrorsPanel />);

    await userEvent.click(screen.getByRole("button", { name: /feature: Extrude failed/i }));
    expect(useCadStore.getState().selection.selectedIds[0]).toMatchObject({ kind: "feature", id: feature.id });

    await userEvent.click(screen.getByRole("button", { name: /File: Project file is not valid JSON/i }));
    expect(useCadStore.getState().fileError).toBeUndefined();
  });
});
