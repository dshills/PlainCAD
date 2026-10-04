import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyDocument } from "../cad/document/CadDocument";
import type { CadDocument } from "../cad/document/schema";
import { useCanvasLabelDrag } from "../ui/panels/useCanvasLabelDrag";

const view = { x: -30, y: -20, width: 60, height: 40 };
function Harness({
  document,
  width = 60,
  ids = ["label"],
}: {
  document?: CadDocument;
  width?: number;
  ids?: string[];
}) {
  const drag = useCanvasLabelDrag(document, { ...view, width }, ids);
  const position = drag.positions.label ?? { x: 0, y: 0 };
  return (
    <>
      <svg>
        <g
          role="button"
          aria-label="Label"
          tabIndex={0}
          {...drag.handlers("label", position, () => {})}
        >
          <text x={position.x} y={-position.y}>
            Dimension
          </text>
        </g>
      </svg>
      <button onClick={drag.reset}>Reset</button>
      <output>{JSON.stringify(drag.positions)}</output>
    </>
  );
}
afterEach(cleanup);
describe("view-only canvas label positioning", () => {
  it("moves by keyboard, resets one or all labels, and never mutates the document", () => {
    const document = createEmptyDocument(),
      original = structuredClone(document);
    render(<Harness document={document} />);
    const label = screen.getByRole("button", { name: "Label" });
    fireEvent.keyDown(label, { key: "ArrowRight" });
    fireEvent.keyDown(label, { key: "ArrowUp", shiftKey: true });
    expect(screen.getByRole("status")).toHaveTextContent(
      '{"label":{"x":0.6,"y":6}}',
    );
    fireEvent.keyDown(label, { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("{}");
    fireEvent.keyDown(label, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("status")).toHaveTextContent("{}");
    expect(document).toEqual(original);
  });
  it("prunes removed labels and ignores placement when context is unavailable", () => {
    const document = createEmptyDocument();
    const rendered = render(<Harness document={document} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Label" }), {
      key: "ArrowRight",
    });
    rendered.rerender(<Harness document={document} ids={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("{}");
    rendered.rerender(<Harness />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Label" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("status")).toHaveTextContent("{}");
  });
});
