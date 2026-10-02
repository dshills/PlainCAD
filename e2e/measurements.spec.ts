import { test, expect, type Page } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
async function ready(page: Page) {
  await expect(async () => {
    const s = await page.evaluate(async () => {
      const p = "/src/state/useCadStore.ts";
      const s = (await import(p)).useCadStore.getState();
      return {
        document: s.history.present,
        status: s.rebuild.status,
        result: s.rebuild.result,
      };
    });
    expect(s.status).toBe("succeeded");
    expect(s.result?.documentId).toBe(s.document.id);
    expect(
      s.result?.meshes.every(
        (m: { geometrySource: string }) => m.geometrySource === "opencascade",
      ),
    ).toBe(true);
  }).toPass({ timeout: 20000 });
}
async function line(page: Page) {
  return page.evaluate(async () => {
    const p = "/src/viewer/viewerDiagnostics.ts";
    return ((await import(p)).inspectViewer() as ViewerSnapshot)
      .measurementLine;
  });
}
test("world measurements follow native sketch edits, units, analytic curves and stale/lost references", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.evaluate(async () => {
    const dp = "/src/cad/document/CadDocument.ts",
      kp = "/src/cad/sketch/SketchModel.ts",
      sp = "/src/state/useCadStore.ts",
      pp = "/src/cad/sketch/profileDetection.ts",
      rp = "/src/cad/sketch/SketchSolver.ts";
    const ops = await import(dp),
      k = await import(kp),
      { solveSketch } = await import(rp),
      { detectProfiles } = await import(pp);
    let doc = ops.upsertParameter(
      ops.createEmptyDocument("Measurement model"),
      {
        id: "param_span",
        name: "span",
        expression: "3mm",
        value: 3,
        unit: "mm",
      },
    );
    for (const plane of ["XY", "XZ", "YZ"] as const) {
      let sketch = k.addCornerRectangle(
        k.createSketchOnPlane(
          plane,
          plane === "YZ"
            ? {
                type: "offset",
                base: "YZ",
                offset: { expression: "3mm", unit: "mm" },
              }
            : plane,
        ),
        "span",
        "4mm",
      );
      if (plane === "XY") {
        const center = k.addPoint(sketch, "0mm", "0mm"),
          start = k.addPoint(center.sketch, "5mm", "0mm"),
          end = k.addPoint(start.sketch, "0mm", "5mm");
        const arc = k.addArc(
          end.sketch,
          center.pointId,
          start.pointId,
          end.pointId,
        );
        sketch = k.setConstruction(arc.sketch, arc.arcId, true);
      }
      sketch = k.addCircleAt(sketch, "0mm", "0mm", "2mm");
      const circle = Object.values(sketch.entities).find(
        (e: any) => e.type === "circle",
      ) as { id: string };
      sketch = k.setConstruction(sketch, circle.id, true);
      doc = ops.upsertSketch(doc, sketch);
      doc = ops.upsertFeature(
        doc,
        ops.createExtrudeFeature({
          name: `${plane} body`,
          sketchId: sketch.id,
          profileId: detectProfiles(
            solveSketch(sketch, {
              span: { value: 3, unit: "mm", dimension: "length" },
            }),
          ).profiles[0].id,
          operation: "newBody",
          direction: "positive",
          distance: { expression: "2mm", unit: "mm" },
        }),
      );
    }
    (await import(sp)).useCadStore.getState().setDocument(doc);
  });
  await ready(page);
  const panel = page.getByRole("region", { name: "Measurements" });
  await panel
    .getByLabel("Measurement first point")
    .selectOption({ label: "XY — point 1" });
  await panel
    .getByLabel("Measurement second point")
    .selectOption({ label: "YZ — point 3" });
  await expect(panel.getByLabel("Point distance", { exact: true })).toHaveText(
    "5.8310 mm",
  );
  await expect.poll(() => line(page)).toEqual([0, 0, 0, 3, 3, 4]);
  await panel.getByLabel("Measurement units").selectOption("in");
  await expect(panel.getByLabel("Point distance", { exact: true })).toHaveText(
    "0.2296 in",
  );
  await panel
    .getByLabel("Measurement curve")
    .selectOption({ label: "XY — arc 1 (construction)" });
  await expect(
    panel.getByLabel("Solved curve length", { exact: true }),
  ).toHaveText("0.3092 in");
  await expect(panel.getByLabel("Measured radius", { exact: true })).toHaveText(
    "0.1969 in",
  );
  await panel.getByLabel("Measurement units").selectOption("mm");
  await expect(
    panel.getByLabel("Solved curve length", { exact: true }),
  ).toHaveText("7.8540 mm");
  await panel
    .getByLabel("Measurement curve")
    .selectOption({ label: "XZ — circle 1 (construction)" });
  await expect(
    panel.getByLabel("Measured diameter", { exact: true }),
  ).toHaveText("4.0000 mm");
  const parameter = page.getByRole("textbox", {
    name: "Parameter span expression",
    exact: true,
  });
  await parameter.fill("6mm");
  await parameter.press("Enter");
  await ready(page);
  await expect(panel.getByLabel("Point distance", { exact: true })).toHaveText(
    "7.8102 mm",
  );
  await expect.poll(() => line(page)).toEqual([0, 0, 0, 3, 6, 4]);
  await parameter.fill("missing_length");
  await parameter.press("Enter");
  await expect(panel.getByRole("status")).toContainText("unavailable");
  await expect(panel.getByLabel("Point distance", { exact: true })).toHaveCount(
    0,
  );
  await expect.poll(() => line(page)).toEqual([]);
  await parameter.fill("6mm");
  await parameter.press("Enter");
  await ready(page);
  await expect(panel.getByLabel("Point distance", { exact: true })).toHaveText(
    "7.8102 mm",
  );
  await page.evaluate(async () => {
    const p = "/src/state/useCadStore.ts";
    const store = (await import(p)).useCadStore.getState();
    const sketch = Object.values(
      store.history.present.sketches as CadDocument["sketches"],
    ).find((s) => s.name === "XY")!;
    store.updateDocument((d: CadDocument) => ({
      ...d,
      sketches: Object.fromEntries(
        Object.entries(d.sketches).filter(([id]) => id !== sketch.id),
      ),
      features: d.features.filter(
        (f) => !("sketchId" in f) || f.sketchId !== sketch.id,
      ),
    }));
  });
  await ready(page);
  await expect(panel.getByRole("alert")).toContainText(
    "reference is unavailable",
  );
  await expect(
    panel.getByLabel("Measured diameter", { exact: true }),
  ).toHaveText("4.0000 mm");
  await expect(
    panel.getByLabel("Measurement first point").locator("option:checked"),
  ).toHaveText("Unavailable reference — reselect");
  await expect.poll(() => line(page)).toEqual([]);
  await panel.getByRole("button", { name: "Clear measurements" }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Load parametric box template" })
    .click();
  await ready(page);
  await expect(panel.getByLabel("Measurement first point")).toHaveValue("");
});
