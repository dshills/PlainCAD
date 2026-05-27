import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "../cad/document/schema";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/importProject";
import { PROJECT_IMPORT_LIMITS } from "../persistence/importSafety";
import { createMountingPlateTemplate } from "../templates/templates";

describe("project import safety and migrations", () => {
  it("migrates v1 documents to the current schema with timeline metadata", () => {
    const document = createMountingPlateTemplate();
    const v1Text = serializeProject({
      ...document,
      schemaVersion: 1,
      timelineCursor: undefined,
      sketches: Object.fromEntries(
        Object.entries(document.sketches).map(([id, sketch]) => [id, { ...sketch, timelineStep: undefined }]),
      ),
      features: document.features.map((feature) => ({ ...feature, timelineStep: undefined })),
    });

    const imported = importProjectText(v1Text);

    expect(imported.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(imported.timelineCursor).toBe(Object.keys(imported.sketches).length + imported.features.length);
    expect(Object.values(imported.sketches).every((sketch) => typeof sketch.timelineStep === "number")).toBe(true);
    expect(imported.features.every((feature) => typeof feature.timelineStep === "number")).toBe(true);
  });

  it("rejects dangerous keys before accepting project state", () => {
    expect(() => importProjectText('{"schemaVersion":1,"__proto__":{"polluted":true}}')).toThrow(
      "Project file contains unsafe key __proto__.",
    );
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects oversized and too deeply nested project files", () => {
    expect(() => importProjectText(`{"schemaVersion":1,"padding":"${"x".repeat(PROJECT_IMPORT_LIMITS.maxBytes)}"}`)).toThrow(
      "Project file is too large.",
    );

    let nested: unknown = "leaf";
    for (let index = 0; index < PROJECT_IMPORT_LIMITS.maxDepth + 1; index += 1) {
      nested = { child: nested };
    }
    expect(() => importProjectText(JSON.stringify({ ...createMountingPlateTemplate(), metadata: nested }))).toThrow(
      "Project file is nested too deeply.",
    );
  });

  it("enforces entity count limits before migration", () => {
    const document = createMountingPlateTemplate();
    const parameters = Object.fromEntries(
      Array.from({ length: PROJECT_IMPORT_LIMITS.maxParameters + 1 }, (_, index) => [
        `p${index}`,
        { id: `param_${index}`, name: `p${index}`, expression: "1mm", value: 1, unit: "mm" },
      ]),
    );

    expect(() => importProjectText(JSON.stringify({ ...document, parameters }))).toThrow("Project file has too many parameters.");
  });

  it("strips runtime-only and unknown fields during import", () => {
    const document = createMountingPlateTemplate();
    const imported = importProjectText(
      JSON.stringify({
        ...document,
        runtimeMesh: { positions: [0, 1, 2] },
        parameters: {
          plate_width: { ...document.parameters.plate_width, runtimeCache: 123 },
        },
      }),
    );

    expect("runtimeMesh" in imported).toBe(false);
    expect("runtimeCache" in imported.parameters.plate_width).toBe(false);
  });

  it("sanitizes malformed feature arrays without crashing before validation", () => {
    const document = createMountingPlateTemplate();
    expect(() =>
      importProjectText(
        JSON.stringify({
          ...document,
          features: [{ type: "hole", id: "feature_bad", name: "Bad Hole", sketchId: "missing" }],
        }),
      ),
    ).toThrow("Hole references a missing sketch.");
  });
});
