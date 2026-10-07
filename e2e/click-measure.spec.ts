import { test, expect, type Page } from "@playwright/test";

async function current(page: Page) {
  await expect(async () => {
    const state = await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts", s = (await import(path)).useCadStore.getState();
      return { status: s.rebuild.status, success: s.rebuild.result?.success, native: s.rebuild.result?.meshes.every((mesh: { geometrySource: string; geometryAssertions?: { valid: boolean } }) => mesh.geometrySource === "opencascade" && mesh.geometryAssertions?.valid) };
    });
    expect(state).toEqual({ status: "succeeded", success: true, native: true });
  }).toPass();
}
async function pick(page: Page, kind: "edge" | "point" | "circle", index = 0) {
  const projected = await page.evaluate(async ({ kind, index }) => {
    const sp = "/src/state/useCadStore.ts", mp = "/src/cad/inspection/modelMeasurements.ts", vp = "/src/viewer/viewerDiagnostics.ts";
    const state = (await import(sp)).useCadStore.getState(), targets = (await import(mp)).modelMeasurementTargets(state.history.present, state.rebuild.result);
    const caps = targets.filter((target: { id: string; bodyId?: string }) => target.bodyId && target.id.includes("endCapPerimeter"));
    const lines = caps.filter((target: { kind: string; direction?: unknown }) => target.kind === "curve" && target.direction);
    // Native boundary order is deliberately unrelated to authored array order.
    // Pick the long/short rectangle sides by exact analytic length instead.
    const longest = lines.reduce((selected: typeof lines[number] | undefined, target: typeof lines[number]) => !selected || target.curve!.length > selected.curve!.length ? target : selected, undefined);
    const target = kind === "point" ? caps.filter((target: { id: string; kind: string }) => target.kind === "point" && target.id.startsWith(`${longest!.id}:point:`))[index]
      : kind === "edge" ? (index === 0 ? longest : lines.find((target: typeof lines[number]) => target.curve!.length < longest!.curve!.length - 1e-6))
      : caps.find((target: { kind: string; curve?: { diameter?: number } }) => target.kind === "curve" && target.curve?.diameter !== undefined);
    if (!target) throw new Error(`No ${kind} target`);
    const path = target.paths[0];
    if (!target.point && (!path || path.length < 2)) throw new Error(`Insufficient display path for ${kind} target`);
    const point = target.point ?? (kind === "circle" ? path[Math.floor(path.length / 8)] : { x: (path[0].x + path[1].x) / 2, y: (path[0].y + path[1].y) / 2, z: (path[0].z + path[1].z) / 2 });
    return { point, screen: (await import(vp)).projectViewerPoint([point.x, point.y, point.z]) };
  }, { kind, index });
  const box = await page.locator(".viewer-canvas canvas").boundingBox();
  expect(projected.screen).toBeDefined(); expect(box).not.toBeNull();
  await page.mouse.click(box!.x + projected.screen!.x, box!.y + projected.screen!.y);
  return projected.point;
}

test("clicks native authored edges and endpoints with analytic feedback, units and stale result protection", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const dp = "/src/cad/document/CadDocument.ts", sk = "/src/cad/sketch/SketchModel.ts", sol = "/src/cad/sketch/SketchSolver.ts", pro = "/src/cad/sketch/profileDetection.ts", sp = "/src/state/useCadStore.ts";
    const d = await import(dp), k = await import(sk);
    let doc = d.upsertParameter(d.createEmptyDocument("Click measurement"), { id: "measure_width", name: "width", expression: "30mm", value: 30, unit: "mm" });
    const sketch = k.addCornerRectangle(k.createSketchOnPlane("XZ base", { type: "offset", base: "XZ", offset: { expression: "7mm", unit: "mm" } }), "width", "20mm");
    const profile = (await import(pro)).detectProfiles((await import(sol)).solveSketch(sketch, { width: { value: 30, unit: "mm", dimension: "length" } })).profiles[0];
    doc = d.upsertFeature(d.upsertSketch(doc, sketch), d.createExtrudeFeature({ name: "Measured block", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } }));
    (await import(sp)).useCadStore.getState().setDocument(doc);
  });
  await current(page);
  const panel = page.getByRole("region", { name: "Measurements" });
  await panel.getByRole("button", { name: "Pick in model" }).click();
  await pick(page, "edge");
  await expect(panel.getByLabel("Model measured length")).toHaveText("30.0000 mm");
  await expect(page.getByRole("status", { name: "Model measurement" })).toContainText("30.0000 mm");
  await pick(page, "edge", 1);
  await expect(panel.getByLabel("Model measured angle")).toHaveText("90.0000 deg");
  await panel.getByRole("button", { name: "Clear measurements" }).click();
  const a = await pick(page, "point", 0), b = await pick(page, "point", 1);
  // XZ normal points toward -Y: offset7 plus the positive8mm end cap gives Y=-15.
  expect(a.y).toBeCloseTo(-15, 6); expect(b.y).toBeCloseTo(-15, 6);
  await expect(panel.getByLabel("Model measured distance")).toHaveText("30.0000 mm");
  await panel.getByLabel("Measurement units").selectOption("in");
  await expect(panel.getByLabel("Model measured distance")).toHaveText("1.1811 in");
  await panel.getByLabel("Measurement units").selectOption("mm");
  const parameter = page.getByRole("textbox", { name: "Parameter width expression", exact: true });
  await parameter.fill("42mm"); await parameter.press("Tab");
  await current(page);
  await expect(panel.getByLabel("Model measured distance")).toHaveCount(0);
  await pick(page, "edge");
  await expect(panel.getByLabel("Model measured length")).toHaveText("42.0000 mm");
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "Pick in model" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Model measurement" })).toHaveCount(0);
});

test("clicks a native circular boundary for analytic diameter and supported planar faces for separation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const dp = "/src/cad/document/CadDocument.ts", sk = "/src/cad/sketch/SketchModel.ts", sol = "/src/cad/sketch/SketchSolver.ts", pro = "/src/cad/sketch/profileDetection.ts", sp = "/src/state/useCadStore.ts";
    const d = await import(dp), k = await import(sk);
    const sketch = k.addCircleAt(k.createSketchOnPlane("Disk", "XY"), "0mm", "0mm", "12mm");
    const profile = (await import(pro)).detectProfiles((await import(sol)).solveSketch(sketch, {})).profiles[0];
    const doc = d.upsertFeature(d.upsertSketch(d.createEmptyDocument("Measure disk"), sketch), d.createExtrudeFeature({ name: "Disk", sketchId: sketch.id, profileId: profile.id, operation: "newBody", direction: "positive", distance: { expression: "8mm", unit: "mm" } }));
    (await import(sp)).useCadStore.getState().setDocument(doc);
  });
  await current(page);
  const panel = page.getByRole("region", { name: "Measurements" });
  await panel.getByRole("button", { name: "Pick in model" }).click();
  await pick(page, "circle");
  await expect(panel.getByLabel("Model measured diameter")).toHaveText("24.0000 mm");
  await expect(panel.getByLabel("Model measured length")).toHaveText("75.3982 mm");
  await panel.getByRole("button", { name: "Clear measurements" }).click();
  const box = await page.locator(".viewer-canvas canvas").boundingBox();
  const face = await page.evaluate(async () => {
    const path = "/src/viewer/viewerDiagnostics.ts";
    return (await import(path)).projectViewerPoint([0, 0, 8]);
  });
  await page.mouse.click(box!.x + face!.x, box!.y + face!.y);
  await expect(panel.getByText("Choose a second planar face", { exact: true })).toHaveCount(0); // Hint lives on the model.
  await expect(page.getByRole("status", { name: "Model measurement" })).toContainText("Choose a second planar face");
  await panel.getByText("Choose model geometry by name", { exact: true }).click();
  const firstId = await page.evaluate(async () => {
    const path = "/src/state/inspectionState.ts";
    return (await import(path)).useInspectionState.getState().targetIds[0];
  });
  const option = panel.getByLabel("Model measurement target").locator("option");
  const secondId = await option.evaluateAll((options, first) => options.map((element) => (element as HTMLOptionElement).value).find((id) => id.startsWith("face:") && id !== first), firstId);
  expect(secondId).toBeDefined();
  await panel.getByLabel("Model measurement target").selectOption(secondId!);
  await expect(panel.getByLabel("Model measured distance")).toHaveText("8.0000 mm");
  await expect(panel.getByLabel("Model measured angle")).toHaveText("0.0000 deg");
});
