import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InspectorPanel } from "../ui/panels/InspectorPanel";
import { useCadStore } from "../state/useCadStore";
import { createBoxTemplate } from "../templates/templates";

describe("selection and inspection", () => {
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
});
