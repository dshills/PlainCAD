import { addComponent } from "./components";
import { upsertSketch } from "./CadDocument";
import type { CadDocument, SketchPlaneReference } from "./schema";
import { createSketchOnPlane } from "../sketch/SketchModel";

/** Build the initial part and its sketch together, before publishing one history edit. */
export function createPartSketch(
  document: CadDocument,
  name: string,
  plane: SketchPlaneReference,
) {
  const added = addComponent(document, name);
  const sketch = {
    ...createSketchOnPlane("Sketch 1", plane),
    componentId: added.component.id,
  };
  return {
    component: added.component,
    sketch,
    document: upsertSketch(added.document, sketch),
  };
}
