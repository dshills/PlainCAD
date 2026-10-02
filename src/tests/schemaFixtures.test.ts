import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importProjectText } from "../persistence/importProject";
import { serializeProject } from "../persistence/exportProject";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { recoverSnapshot } from "../persistence/autosave";

describe("released-schema corpus", () => {
  it.each([1, 2, 3, 4, 5, 6, 7])(
    "migrates schema %i with stable IDs, editable geometry, and recovery",
    (version) => {
      const text = readFileSync(
        `src/persistence/fixtures/schema-v${version}.pcaddoc`,
        "utf8",
      );
      const raw = JSON.parse(text),
        document = importProjectText(text);
      expect(raw.schemaVersion).toBe(version);
      expect(document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(document.id).toBe(raw.id);
      expect(document.features.map((f) => f.id)).toEqual(["base", "hole"]);
      expect(Object.keys(document.sketches.section.entities)).toEqual(
        Object.keys(raw.sketches.section.entities),
      );
      expect(document.features[1]).toMatchObject({
        targetBodyId: "body:base",
        centerPointIds: ["center"],
      });
      const result = rebuildDocument(document);
      expect(result.errors).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.meshes).toHaveLength(1);
      expect(result.meshes[0].bounds).toEqual({
        min: [0, 0, 0],
        max: [20, 10, 5],
      });
      const edited = rebuildDocument({
        ...document,
        parameters: {
          ...document.parameters,
          thickness: { ...document.parameters.thickness, expression: "8mm" },
        },
      });
      expect(edited.success).toBe(true);
      expect(edited.meshes[0].bounds.max[2]).toBe(8);
      const exported = serializeProject(document);
      expect(serializeProject(importProjectText(exported))).toBe(exported);
      expect(
        recoverSnapshot({
          id: document.id,
          latest: {
            text,
            savedAt: 1,
            name: document.name,
            schemaVersion: version,
          },
        }),
      ).toEqual(document);
    },
  );
});
