import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiPlatePlan } from "../src/tests/fixtures/aiPlan";
import type { AiPlan } from "../src/ai/plan";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function snapshot(page: Page): Promise<{
  document: CadDocument;
  result?: RebuildResult;
  past: number;
  session: number;
  status: string;
}> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      result: state.rebuild.result,
      past: state.history.past.length,
      session: state.documentSession,
      status: state.rebuild.status,
    };
  });
}
async function setup(page: Page) {
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      json: {
        providers: ["anthropic", "openai", "google"].map((id) => ({
          id,
          label:
            id === "google"
              ? "Google AI"
              : id === "openai"
                ? "OpenAI"
                : "Anthropic",
          model: `test-${id}`,
          available: true,
        })),
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page
    .getByRole("button", { name: "Open AI drawer", exact: true })
    .click();
  const drawer = page.getByRole("region", { name: "AI modeling assistant" });
  await expect(drawer.getByLabel("AI model", { exact: true })).toHaveValue(
    "test-anthropic",
  );
  return drawer;
}
test("all three provider choices create real native previews; Cancel/Apply, parameter edits, one undo, save/open and STL retain editable geometry", async ({
  page,
}, info) => {
  const sent: Array<{ provider: string; prompt: string }> = [];
  await page.route("**/api/ai/generate", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { plan: aiPlatePlan } });
  });
  const drawer = await setup(page),
    before = await snapshot(page);
  const description = drawer.getByLabel("What would you like to make?");
  await expect(description).toBeFocused();
  await description.fill(
    "A 60 x 40 x 5mm mounting plate with a 4mm through hole in its center.",
  );
  for (const provider of ["anthropic", "openai", "google"]) {
    await drawer
      .getByLabel("AI provider", { exact: true })
      .selectOption(provider);
    await drawer
      .getByRole("button", { name: "Generate preview", exact: true })
      .click();
    await expect(
      drawer.getByRole("status", { name: "AI modeling status" }),
    ).toContainText("Native preview ready");
    await expect(drawer).toContainText(
      `${(12000 - 20 * Math.PI).toFixed(3)} mm³`,
    );
    await expect(
      drawer.getByRole("img", { name: "Native AI component preview" }),
    ).toBeVisible();
    expect((await snapshot(page)).document).toEqual(before.document);
    expect((await snapshot(page)).past).toBe(before.past);
    if (provider !== "google") {
      await drawer.getByRole("button", { name: "Cancel AI proposal" }).click();
      await expect(
        drawer.getByRole("button", { name: "Apply AI component" }),
      ).toBeDisabled();
    }
  }
  expect(sent.map((request) => request.provider)).toEqual([
    "anthropic",
    "openai",
    "google",
  ]);
  await page.screenshot({ path: info.outputPath("ai-drawer-preview.png") });
  await drawer.getByRole("button", { name: "Apply AI component" }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const applied = await snapshot(page),
    id = applied.result!.meshes[0].bodyId;
  expect(applied.past).toBe(before.past + 1);
  expect(Object.keys(applied.document.components)).toHaveLength(2);
  const mesh = applied.result!.meshes[0];
  expect(mesh.geometrySource).toBe("opencascade");
  expect(mesh.kernelOperation).toBe("cut");
  expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
  expect(mesh.geometryAssertions!.volume).toBeCloseTo(12000 - 20 * Math.PI, 5);
  for (let axis = 0; axis < 3; axis++) {
    expect(mesh.bounds.min[axis]).toBeCloseTo([-30, -20, 0][axis], 5);
    expect(mesh.bounds.max[axis]).toBeCloseTo([30, 20, 5][axis], 5);
  }
  await drawer.getByRole("button", { name: "Close AI drawer" }).click();
  const thickness = page.getByLabel("Parameter ai_1_thickness expression", {
    exact: true,
  });
  await thickness.fill("8mm");
  await thickness.press("Enter");
  const volume = (2400 - 4 * Math.PI) * 8;
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes.find((m) => m.bodyId === id)
          ?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume, 5);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(12000 - 20 * Math.PI, 5);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).document.features.length)
    .toBe(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume, 5);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const file = await saved,
    path = info.outputPath("ai-component.pcaddoc");
  await file.saveAs(path);
  const text = await readFile(path, "utf8");
  expect(text).not.toContain("test-google");
  expect(text).not.toContain("A 60 x 40 x 5mm mounting plate");
  const old = await snapshot(page);
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).session)
    .toBeGreaterThan(old.session);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(volume, 5);
  const stl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const exportFile = await stl,
    exportPath = info.outputPath("ai-component.stl");
  await exportFile.saveAs(exportPath);
  const bytes = await readFile(exportPath),
    count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + count * 50);
  let signedVolume = 0;
  for (let i = 0; i < count; i++) {
    const offset = 84 + i * 50;
    const a = [0, 1, 2].map((axis) =>
      bytes.readFloatLE(offset + 12 + axis * 4),
    );
    const b = [0, 1, 2].map((axis) =>
      bytes.readFloatLE(offset + 24 + axis * 4),
    );
    const c = [0, 1, 2].map((axis) =>
      bytes.readFloatLE(offset + 36 + axis * 4),
    );
    signedVolume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  expect(signedVolume).toBeGreaterThan(0);
  expect(Math.abs(signedVolume / volume - 1)).toBeLessThan(0.01);
});
test("AI parameter edits preserve existing component/feature/body IDs, preview before Apply, undo once and persist native geometry", async ({
  page,
}, info) => {
  const drawer = await setup(page);
  let edit = false;
  const editRequests: Array<{
    editContext: {
      componentName: string;
      parameters: Array<{ name: string; value: number }>;
    };
  }> = [];
  await page.route("**/api/ai/generate", async (route) => {
    const request = route.request().postDataJSON();
    if (edit) editRequests.push(request);
    await route.fulfill({
      json: {
        plan: edit
          ? {
              name: "Thicker plate",
              summary: "Increase thickness to 8mm",
              warnings: [],
              steps: [],
              parameters: [{ name: "ai_1_thickness", value: 8, unit: "mm" }],
            }
          : aiPlatePlan,
      },
    });
  });
  await drawer.getByLabel("What would you like to make?").fill("Make a plate");
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(
    drawer.getByRole("button", { name: "Apply AI component" }),
  ).toBeEnabled();
  await drawer.getByRole("button", { name: "Apply AI component" }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const before = await snapshot(page);
  edit = true;
  await drawer.getByLabel("AI task", { exact: true }).selectOption("edit");
  await drawer
    .getByLabel("What would you like to make?")
    .fill("Make this plate 8mm thick");
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(
    drawer.getByRole("button", { name: "Apply AI parameter edits" }),
  ).toBeEnabled();
  await expect(drawer.getByLabel("Proposed parameter changes")).toContainText(
    "ai_1_thickness: 5mm → 8mm",
  );
  expect(editRequests[0].editContext.componentName).toBe(aiPlatePlan.name);
  expect(
    editRequests[0].editContext.parameters.find(
      (p) => p.name === "ai_1_thickness",
    )?.value,
  ).toBe(5);
  expect((await snapshot(page)).document).toEqual(before.document);
  await drawer.getByRole("button", { name: "Cancel AI proposal" }).click();
  expect((await snapshot(page)).past).toBe(before.past);
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(
    drawer.getByRole("button", { name: "Apply AI parameter edits" }),
  ).toBeEnabled();
  await drawer
    .getByRole("button", { name: "Apply AI parameter edits" })
    .click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const after = await snapshot(page),
    expectedVolume = 19200 - 32 * Math.PI;
  expect(after.document.components).toEqual(before.document.components);
  expect(after.document.features).toEqual(before.document.features);
  expect(after.document.sketches).toEqual(before.document.sketches);
  expect(after.document.parameters.ai_1_thickness.id).toBe(
    before.document.parameters.ai_1_thickness.id,
  );
  expect(after.result!.meshes[0].bodyId).toBe(before.result!.meshes[0].bodyId);
  expect(after.result!.meshes[0].geometryAssertions!.volume).toBeCloseTo(
    expectedVolume,
    5,
  );
  expect(after.past).toBe(before.past + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(12000 - 20 * Math.PI, 5);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(expectedVolume, 5);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const path = info.outputPath("ai-edited.pcaddoc");
  await (await download).saveAs(path);
  const session = (await snapshot(page)).session;
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect
    .poll(async () => (await snapshot(page)).session)
    .toBeGreaterThan(session);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).result?.meshes[0]?.geometryAssertions?.volume,
    )
    .toBeCloseTo(expectedVolume, 5);
  const stl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const stlPath = info.outputPath("ai-edited.stl");
  await (await stl).saveAs(stlPath);
  expect((await readFile(stlPath)).readUInt32LE(80)).toBeGreaterThan(0);
});
test("AI failures, unsupported operations and stale same-ID project responses cannot mutate the document or enable Apply", async ({
  page,
}) => {
  let mode = "invalid";
  let release: () => void = () => {};
  let arrived: () => void = () => {};
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route("**/api/ai/generate", async (route) => {
    if (mode === "invalid")
      return route.fulfill({
        json: { plan: { ...aiPlatePlan, steps: [{ type: "loft" }] } },
      });
    if (mode === "unsupported")
      return route.fulfill({
        json: {
          plan: {
            ...aiPlatePlan,
            parameters: [],
            steps: [],
            summary:
              "Thread modeling is unsupported. Specify a plain cylinder instead.",
          },
        },
      });
    arrived();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await route.fulfill({ json: { plan: aiPlatePlan } });
    } catch {
      /* Canceled HTTP requests may close before delivery. */
    }
  });
  const drawer = await setup(page),
    before = await snapshot(page);
  await drawer
    .getByLabel("What would you like to make?")
    .fill("Make a threaded plate");
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(drawer.getByRole("alert")).toContainText("unsupported");
  await expect(
    drawer.getByRole("button", { name: "Apply AI component" }),
  ).toBeDisabled();
  mode = "unsupported";
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(drawer).toContainText("Thread modeling is unsupported");
  await expect(
    drawer.getByRole("button", { name: "Apply AI component" }),
  ).toBeDisabled();
  expect((await snapshot(page)).document).toEqual(before.document);
  mode = "held";
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await received;
  await page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      store = (await import(path)).useCadStore;
    store.getState().setDocument(store.getState().history.present);
  });
  release();
  await expect(
    drawer.getByRole("button", { name: "Generate preview" }),
  ).toBeEnabled();
  await expect(
    drawer.getByRole("button", { name: "Apply AI component" }),
  ).toBeDisabled();
  expect((await snapshot(page)).past).toBe(0);
  expect((await snapshot(page)).document.features).toHaveLength(0);
  await drawer.getByLabel("What would you like to make?").press("Escape");
  await expect(
    page.getByRole("button", { name: "Open AI drawer" }),
  ).toBeFocused();
});
test("AI recipes generate real XZ offset extrusions, cap treatments and origin-axis revolves with exact native volumes", async ({
  page,
}) => {
  const edgePlan: AiPlan = {
    name: "AI rounded block",
    summary: "XZ offset block",
    warnings: [],
    parameters: [],
    steps: [
      {
        type: "sketch",
        id: "shape",
        name: "Offset profile",
        plane: "XZ",
        offset: "3mm",
        profile: {
          type: "rectangle",
          x: "0mm",
          y: "0mm",
          width: "20mm",
          height: "10mm",
        },
      },
      {
        type: "extrude",
        id: "body",
        name: "Block",
        sketch: "shape",
        operation: "newBody",
        distance: "10mm",
        termination: "distance",
        direction: "positive",
        targets: [],
      },
      {
        type: "fillet",
        id: "round",
        name: "Cap fillet",
        owner: "body",
        role: "endCapPerimeter",
        size: "1mm",
      },
      {
        type: "chamfer",
        id: "bevel",
        name: "Cap chamfer",
        owner: "body",
        role: "startCapPerimeter",
        size: "1mm",
      },
    ],
  };
  const revolve: AiPlan = {
    name: "AI cylinder",
    summary: "Origin Y revolve",
    warnings: [],
    parameters: [],
    steps: [
      {
        type: "sketch",
        id: "shape",
        name: "Radial profile",
        plane: "XY",
        offset: "0mm",
        profile: {
          type: "rectangle",
          x: "2.5mm",
          y: "5mm",
          width: "5mm",
          height: "10mm",
        },
      },
      {
        type: "revolve",
        id: "body",
        name: "Cylinder",
        sketch: "shape",
        operation: "newBody",
        axis: "Y",
        angle: "360deg",
        targets: [],
      },
    ],
  };
  let plan = edgePlan;
  await page.route("**/api/ai/generate", (route) =>
    route.fulfill({ json: { plan } }),
  );
  const drawer = await setup(page);
  await drawer
    .getByLabel("What would you like to make?")
    .fill("A rounded block");
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(
    drawer.getByRole("status", { name: "AI modeling status" }),
  ).toContainText("Native preview ready");
  await drawer.getByRole("button", { name: "Apply AI component" }).click();
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  const mesh = (await snapshot(page)).result!.meshes[0];
  expect(mesh.kernelOperation).toBe("chamfer");
  expect(mesh.geometryAssertions!.volume).toBeGreaterThan(1900);
  expect(mesh.geometryAssertions!.volume).toBeLessThan(2000);
  expect(mesh.bounds.min[1]).toBeCloseTo(-13, 5);
  expect(mesh.bounds.max[1]).toBeCloseTo(-3, 5);
  plan = revolve;
  await drawer.getByRole("button", { name: "New conversation" }).click();
  await drawer.getByLabel("What would you like to make?").fill("A cylinder");
  await drawer.getByRole("button", { name: "Generate preview" }).click();
  await expect(
    drawer.getByRole("status", { name: "AI modeling status" }),
  ).toContainText("Native preview ready");
  await expect(drawer).toContainText(`${(250 * Math.PI).toFixed(3)} mm³`);
});
