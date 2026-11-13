import { expect, it } from "vitest";
import { applyCadCommand } from "../commands/cadCommandOperations";
import { createBoxTemplate } from "../templates/templates";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { appendProject } from "../persistence/appendProject";
import { serializeProject } from "../persistence/exportProject";
import { bindDocumentExpressions } from "../cad/parameters/expressionBindings";
import { importProjectText } from "../persistence/projectCodec";

it("persists a finish through portable save and project insertion without changing geometry", () => {
  const original = bindDocumentExpressions(createBoxTemplate());
  const componentId = original.rootComponentId;
  const document = applyCadCommand(original, { command: "cad.component.appearance", arguments: { componentId, finish: "brass" } }).document;
  expect(document.components[componentId].appearance).toBe("brass");
  expect(original.components[componentId].appearance).toBeUndefined();
  expect(document.features).toEqual(original.features);
  expect(document.sketches).toEqual(original.sketches);
  const text = serializeProject(document);
  const reopened = importProjectText(text);
  expect(reopened.components[componentId].appearance).toBe("brass");
  const { document: merged, componentIds } = appendProject(createEmptyDocument(), reopened);
  expect(merged.components[componentIds[0]].appearance).toBe("brass");
  const reset = applyCadCommand(reopened, { command: "cad.component.appearance", arguments: { componentId, finish: "default" } }).document;
  expect(reset.components[componentId]).not.toHaveProperty("appearance");

  expect(() => importProjectText(text.replace('"brass"', '"unsupported"'))).toThrow(/supported finish/i);
  const oldFile = JSON.stringify({ ...document, schemaVersion: 25 });
  expect(importProjectText(oldFile).components[componentId]).not.toHaveProperty("appearance");
});
