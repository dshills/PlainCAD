import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import type { RenderMesh } from "../src/cad/kernel/KernelAdapter";

type Plane = "XY" | "XZ" | "YZ";
const CENTERS = [
  { x: 10, y: 8 },
  { x: -10, y: -8 },
];
async function fixture(page: Page, plane: Plane = "XY") {
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  return page.evaluate(async (plane) => {
    const documentPath = "/src/cad/document/CadDocument.ts",
      sketchPath = "/src/cad/sketch/SketchModel.ts",
      solvePath = "/src/cad/sketch/SketchSolver.ts",
      profilesPath = "/src/cad/sketch/profileDetection.ts",
      storePath = "/src/state/useCadStore.ts";
    const docs = await import(documentPath),
      sketches = await import(sketchPath),
      { solveSketch } = await import(solvePath),
      { detectProfiles } = await import(profilesPath),
      { useCadStore } = await import(storePath);
    let document = docs.createEmptyDocument(`Guided holes ${plane}`);
    for (const [name, expression, value] of [
      ["thickness", "20mm", 20],
      ["drill", "4mm", 4],
    ] as const)
      document = docs.upsertParameter(document, {
        id: `parameter_${name}`,
        name,
        expression,
        value,
        unit: "mm",
      });
    const section = sketches.addCenterRectangle(
      sketches.createSketchOnPlane("Base section", plane),
      "80mm",
      "50mm",
    );
    document = docs.upsertSketch(document, section);
    const base = docs.createExtrudeFeature({
      name: "Base",
      sketchId: section.id,
      profileId: detectProfiles(solveSketch(section, {})).profiles[0].id,
      operation: "newBody",
      distance: { expression: "thickness", unit: "mm" },
      direction: "positive",
    });
    document = docs.upsertFeature(document, base);
    useCadStore.getState().setDocument(document);
    return {
      baseId: base.id,
      bodyId: `body:${base.id}`,
      baseSketchId: section.id,
    };
  }, plane);
}
async function ready(page: Page, volume: number) {
  await expect(async () => {
    const state = await aiSnapshot(page),
      mesh = state.result?.meshes[0];
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.errors).toEqual([]);
    expect(state.result?.meshes).toHaveLength(1);
    expect(mesh?.geometrySource).toBe("opencascade");
    expect(mesh?.geometryAssertions).toMatchObject({
      valid: true,
      solidCount: 1,
    });
    expect(
      Math.abs(mesh!.geometryAssertions!.volume / volume - 1),
    ).toBeLessThan(1e-9);
  }).toPass({ timeout: 30000 });
}
async function open(page: Page, pickInViewer = false) {
  await page
    .getByRole("button", { name: "Place holes on face", exact: true })
    .click();
  const picker = page.getByRole("region", {
    name: "Choose hole face",
    exact: true,
  });
  await expect(picker).toBeVisible();
  if (pickInViewer) {
    const canvas = page.locator(".viewer-canvas canvas");
    await canvas.scrollIntoViewIfNeeded();
    const projected = await page.evaluate(async () => {
      const path = "/src/viewer/viewerDiagnostics.ts";
      return (await import(path)).projectViewerPoint([10, 8, 20]);
    });
    const bounds = await canvas.boundingBox();
    if (!projected || !bounds)
      throw new Error("Viewer face projection unavailable");
    await page.mouse.click(bounds.x + projected.x, bounds.y + projected.y);
  } else {
    await picker
      .getByRole("button", { name: "Hole on Base — end cap", exact: true })
      .click();
  }
  const dialog = page.getByRole("dialog", {
    name: "Place holes on face",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function clickCenter(dialog: Locator, page: Page, x: number, y: number) {
  const canvas = dialog.getByRole("group", {
    name: "Hole center placement",
    exact: true,
  });
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate(
    (element, local) => {
      const matrix = (element as SVGSVGElement).getScreenCTM();
      if (!matrix)
        throw new Error("Hole placement canvas transform unavailable");
      const client = new DOMPoint(local.x, -local.y).matrixTransform(matrix);
      return { x: client.x, y: client.y };
    },
    { x, y },
  );
  // Preserve fractional client coordinates and account for SVG letterboxing.
  await page.mouse.click(point.x, point.y);
}
async function typeCenter(dialog: Locator, x: string, y: string) {
  await dialog.getByLabel("Hole center X", { exact: true }).fill(x);
  await dialog.getByLabel("Hole center Y", { exact: true }).fill(y);
  await dialog
    .getByRole("button", { name: "Add hole center", exact: true })
    .click();
}
async function preview(dialog: Locator) {
  await expect(
    dialog.getByLabel("Guided hole preview status", { exact: true }),
  ).toContainText(/native preview ready/i);
  await expect(
    dialog.getByRole("button", { name: "Apply face holes", exact: true }),
  ).toBeEnabled();
}
function localVertex(plane: Plane, position: [number, number, number]) {
  const [x, y, z] = position;
  return plane === "XY"
    ? { x, y, axis: z }
    : plane === "XZ"
      ? { x, y: z, axis: -y }
      : { x: y, y: z, axis: x };
}
function holeDepthAndOrientation(
  mesh: RenderMesh,
  plane: Plane,
  radius: number,
  thickness: number,
  through: boolean,
  centers: Array<{ x: number; y: number }> = CENTERS,
) {
  const expectedBounds =
    plane === "XY"
      ? { min: [-40, -25, 0], max: [40, 25, thickness] }
      : plane === "XZ"
        ? { min: [-40, -thickness, -25], max: [40, 0, 25] }
        : { min: [0, -40, -25], max: [thickness, 40, 25] };
  for (const end of ["min", "max"] as const)
    mesh.bounds[end].forEach((value, index) =>
      expect(value).toBeCloseTo(expectedBounds[end][index], 5),
    );
  for (const center of centers) {
    const wall: number[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const point = localVertex(plane, [
        mesh.positions[i],
        mesh.positions[i + 1],
        mesh.positions[i + 2],
      ]);
      if (
        Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius) <
        1e-5
      )
        wall.push(point.axis);
    }
    // Actual circular-wall vertices prove the cut entered the selected outward cap.
    // A same-volume hole drilled from the opposite cap fails this assertion.
    expect(wall.length).toBeGreaterThan(10);
    expect(Math.min(...wall)).toBeCloseTo(through ? 0 : thickness - 4, 5);
    expect(Math.max(...wall)).toBeCloseTo(thickness, 5);
  }
}
async function editParameter(page: Page, name: string, expression: string) {
  const input = page.getByRole("textbox", {
    name: `Parameter ${name} expression`,
    exact: true,
  });
  await input.fill(expression);
  await input.press("Enter");
}

for (const plane of ["XY", "XZ", "YZ"] as const) {
  for (const through of [false, true]) {
    test(`${plane}: guided ${through ? "through-all" : "blind"} face holes preserve inward depth, IDs and native geometry through editing/undo/save/open/STL`, async ({
      page,
    }, info) => {
      test.slow();
      const ids = await fixture(page, plane);
      await ready(page, 80000);
      const before = await aiSnapshot(page),
        dialog = await open(page, plane === "XY" && through);
      await expect(dialog.locator("svg polygon").first()).toHaveCSS(
        "vector-effect",
        "non-scaling-stroke",
      );
      await expect(dialog.locator("svg polygon").first()).toHaveCSS(
        "stroke-width",
        "1px",
      );
      await clickCenter(dialog, page, CENTERS[0].x, CENTERS[0].y);
      await typeCenter(dialog, "-10mm", "-8mm");
      await expect(dialog.locator("[data-hole-center-id]")).toHaveCount(2);
      await expect(dialog.locator("svg circle").first()).toHaveCSS(
        "vector-effect",
        "non-scaling-stroke",
      );
      await expect(dialog.locator("svg circle").first()).toHaveCSS(
        "stroke-width",
        "1px",
      );
      await dialog
        .getByLabel("Guided hole diameter", { exact: true })
        .fill("drill");
      await dialog
        .getByLabel("Guided hole termination", { exact: true })
        .selectOption(through ? "throughAll" : "distance");
      if (!through)
        await dialog
          .getByLabel("Guided hole depth", { exact: true })
          .fill("4mm");
      await preview(dialog);
      expect((await aiSnapshot(page)).document).toEqual(before.document);
      expect((await aiSnapshot(page)).past).toBe(before.past);
      await dialog
        .getByRole("button", { name: "Apply face holes", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      const expected = 80000 - 2 * Math.PI * 4 * (through ? 20 : 4);
      await ready(page, expected);
      const applied = await aiSnapshot(page),
        hole = applied.document.features.find((f) => f.type === "hole")!;
      if (hole.type !== "hole") throw new Error("Guided Hole feature missing");
      expect(applied.past).toBe(before.past + 1);
      expect(Object.keys(applied.document.sketches)).toHaveLength(2);
      expect(applied.document.features).toHaveLength(2);
      expect(hole).toMatchObject({
        direction: "negative",
        targetBodyIds: [ids.bodyId],
        diameter: { expression: "drill" },
      });
      expect(applied.document.sketches[hole.sketchId].plane).toEqual({
        type: "face",
        featureId: ids.baseId,
        stableFaceId: `extrude:${ids.baseId}:endCap`,
      });
      // Pointer placement snaps to 0.001mm. Compare actual solved coordinates
      // closely enough to catch flipped axes or incorrect SVG mapping.
      const centers = hole.centerPointIds.map(
        (id) => applied.result!.solvedSketches![hole.sketchId].points[id],
      );
      expect(centers).toHaveLength(CENTERS.length);
      centers.forEach((center, index) => {
        expect(Math.abs(center.x - CENTERS[index].x)).toBeLessThanOrEqual(
          0.001,
        );
        expect(Math.abs(center.y - CENTERS[index].y)).toBeLessThanOrEqual(
          0.001,
        );
      });
      expect(applied.result!.meshes[0].bodyId).toBe(ids.bodyId);
      expect(applied.result!.meshes[0].kernelOperation).toBe("cut");
      holeDepthAndOrientation(
        applied.result!.meshes[0],
        plane,
        2,
        20,
        through,
        centers,
      );
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await ready(page, 80000);
      expect((await aiSnapshot(page)).document).toEqual(before.document);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await ready(page, expected);
      expect((await aiSnapshot(page)).document.features).toEqual(
        applied.document.features,
      );
      await editParameter(page, "drill", "6mm");
      await ready(page, 80000 - 2 * Math.PI * 9 * (through ? 20 : 4));
      await editParameter(page, "thickness", "24mm");
      const removed = 2 * Math.PI * 9 * (through ? 24 : 4),
        finalVolume = 96000 - removed;
      await ready(page, finalVolume);
      const final = await aiSnapshot(page);
      expect(final.document.features[1].id).toBe(hole.id);
      expect(final.document.sketches[hole.sketchId].plane).toEqual(
        applied.document.sketches[hole.sketchId].plane,
      );
      holeDepthAndOrientation(
        final.result!.meshes[0],
        plane,
        3,
        24,
        through,
        centers,
      );
      const saving = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      const path = info.outputPath(
        `guided-${plane}-${through ? "through" : "blind"}.pcaddoc`,
      );
      await (await saving).saveAs(path);
      const saved = JSON.parse(await readFile(path, "utf8"));
      expect(
        saved.features.find((f: { id: string }) => f.id === hole.id),
      ).toMatchObject({
        direction: "negative",
        centerPointIds: hole.centerPointIds,
      });
      const session = final.session;
      await page.locator('input[type="file"]').setInputFiles(path);
      await expect
        .poll(async () => (await aiSnapshot(page)).session)
        .toBeGreaterThan(session);
      await ready(page, finalVolume);
      const reopened = await aiSnapshot(page);
      expect(reopened.document.features).toEqual(final.document.features);
      holeDepthAndOrientation(
        reopened.result!.meshes[0],
        plane,
        3,
        24,
        through,
        centers,
      );
      const exporting = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export STL", exact: true })
        .click();
      const stl = info.outputPath(
        `guided-${plane}-${through ? "through" : "blind"}.stl`,
      );
      await (await exporting).saveAs(stl);
      const meshVolume = stlSignedVolume(await readFile(stl));
      expect(meshVolume).toBeGreaterThan(0);
      expect(Math.abs(meshVolume - finalVolume)).toBeLessThan(removed * 0.02);
    });
  }
}

test("guided holes reject outside-face centers, preserve typing/cancellation, and reject previews after selection or document-session changes", async ({
  page,
}) => {
  const ids = await fixture(page);
  await ready(page, 80000);
  const before = await aiSnapshot(page);
  await page
    .getByRole("button", { name: "Place holes on face", exact: true })
    .click();
  const picker = page.getByRole("region", {
    name: "Choose hole face",
    exact: true,
  });
  await picker
    .getByRole("button", { name: "Cancel guided holes", exact: true })
    .click();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  let dialog = await open(page);
  await clickCenter(dialog, page, 45, 0);
  await expect(dialog.getByRole("alert")).toContainText(
    /on the selected face|outside/i,
  );
  await expect(dialog.locator("[data-hole-center-id]")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Apply face holes", exact: true }),
  ).toBeDisabled();
  await typeCenter(dialog, "100mm", "0mm");
  await expect(dialog.getByRole("alert")).toContainText(
    /on the selected face|outside/i,
  );
  await expect(dialog.locator("[data-hole-center-id]")).toHaveCount(0);
  await dialog.getByLabel("Hole center X", { exact: true }).fill("10mm");
  await dialog.getByLabel("Hole center X", { exact: true }).press("Backspace");
  await expect(dialog.getByLabel("Hole center X", { exact: true })).toHaveValue(
    "10m",
  );
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  await typeCenter(dialog, "10mm", "8mm");
  await typeCenter(dialog, "100mm", "0mm");
  await expect(dialog.getByRole("alert")).toContainText(
    /on the selected face|outside/i,
  );
  await dialog
    .getByLabel("Guided hole termination", { exact: true })
    .selectOption("distance");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await typeCenter(dialog, "100mm", "0mm");
  await expect(dialog.getByRole("alert")).toContainText(
    /on the selected face|outside/i,
  );
  await dialog.getByLabel("Guided hole depth", { exact: true }).fill("4mm");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await typeCenter(dialog, "100mm", "0mm");
  await expect(dialog.getByRole("alert")).toContainText(
    /on the selected face|outside/i,
  );
  await dialog
    .getByRole("button", { name: "Remove hole center 1", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.locator("[data-hole-center-id]")).toHaveCount(0);
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await dialog
    .getByRole("button", { name: "Cancel guided holes", exact: true })
    .click();
  dialog = await open(page);
  await typeCenter(dialog, "10mm", "8mm");
  await dialog
    .getByLabel("Guided hole diameter", { exact: true })
    .fill("drill");
  await preview(dialog);
  await dialog
    .getByRole("button", { name: "Cancel guided holes", exact: true })
    .click();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  expect((await aiSnapshot(page)).past).toBe(before.past);
  dialog = await open(page);
  await typeCenter(dialog, "10mm", "8mm");
  await preview(dialog);
  await page.evaluate(async (baseId) => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    state.select({
      kind: "feature",
      id: baseId,
      documentId: state.history.present.id,
    });
  }, ids.baseId);
  await expect(
    dialog.getByLabel("Guided hole preview status", { exact: true }),
  ).toContainText(/project or selection changed/i);
  await expect(
    dialog.getByRole("button", { name: "Apply face holes", exact: true }),
  ).toBeDisabled();
  expect((await aiSnapshot(page)).document).toEqual(before.document);
  await dialog
    .getByRole("button", { name: "Cancel guided holes", exact: true })
    .click();
  dialog = await open(page);
  await typeCenter(dialog, "10mm", "8mm");
  await preview(dialog);
  const previousSession = (await aiSnapshot(page)).session;
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    state.setDocument(state.history.present);
  });
  await expect
    .poll(async () => (await aiSnapshot(page)).session)
    .toBeGreaterThan(previousSession);
  await expect(
    dialog.getByLabel("Guided hole preview status", { exact: true }),
  ).toContainText(/project or selection changed/i);
  await expect(
    dialog.getByRole("button", { name: "Apply face holes", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Cancel guided holes", exact: true })
    .click();
  await ready(page, 80000);
  expect((await aiSnapshot(page)).document.features).toHaveLength(1);
  expect((await aiSnapshot(page)).past).toBe(0);
});
