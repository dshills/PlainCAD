import schema15Fixture from "../persistence/fixtures/schema-v15.pcaddoc?raw";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { it, expect, afterEach } from "vitest";
import { importProjectText } from "../persistence/importProject";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { SketchCanvasPanel } from "../ui/panels/SketchCanvasPanel";
import { useCadStore } from "../state/useCadStore";
import { useSketchCanvas } from "../ui/commands/sketchCanvasCommand";

afterEach(() => {
  useCadStore.setState(useCadStore.getInitialState());
  useSketchCanvas.setState(useSketchCanvas.getInitialState());
});

it("inspects partial read-only projected geometry without rendering a throwing deletion plan", () => {
  const document = importProjectText(schema15Fixture);
  const unlinked = { ...document, sketches: Object.fromEntries(Object.entries(document.sketches).map(([id, sketch]) => [id, { ...sketch, projections: undefined }])) };
  const result = rebuildDocument(unlinked), session = 93;
  useCadStore.setState({ history: { past: [], present: document, future: [] }, documentSession: session, activeComponentId: "cover-component", fileBusy: false, rebuild: { status: "succeeded", kernelReady: true, result } });
  useSketchCanvas.setState({ active: { session, documentId: document.id, sketchId: "cover-section" }, selection: { document, entityIds: ["cover-p0"] } });
  render(<SketchCanvasPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Draw tool: select" }));
  act(() => useSketchCanvas.setState({ selection: { document, entityIds: ["cover-p0"] } }));
  expect(screen.getByRole("region", { name: "Linked projected boundaries" })).toHaveTextContent("linked and read-only");
  expect(screen.getByRole("button", { name: "Delete selected sketch item" })).toBeDisabled();
  act(() => useSketchCanvas.setState({ selection: { document, entityIds: Object.keys(document.sketches["cover-section"].entities) } }));
  expect(screen.getByRole("button", { name: "Delete selected sketch item" })).toBeEnabled();
});
