import { applyExtrusion } from "../e2e/extrudeWorkflow";
import {
  AUTOSAVE_DB,
  AUTOSAVE_STORE,
} from "../src/persistence/recoveryConstants";
import { createBoxTemplate } from "../src/templates/templates";
import {
  addCenterRectangle,
  addCircleAt,
  createXySketch,
} from "../src/cad/sketch/SketchModel";
import {
  upsertSketch,
  upsertFeature,
  createExtrudeFeature,
} from "../src/cad/document/CadDocument";
import { detectProfiles } from "../src/cad/sketch/profileDetection";
import { solveSketch } from "../src/cad/sketch/SketchSolver";
import { evaluateParameters } from "../src/cad/parameters/expressionEvaluator";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
} from "../deployment/securityHeaders";
function stlVolume(bytes: Buffer) {
  const count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + 50 * count);
  let volume = 0;
  for (let i = 0; i < count; i++) {
    const p = Array.from({ length: 9 }, (_, j) =>
      bytes.readFloatLE(96 + 50 * i + 4 * j),
    );
    volume +=
      (p[0] * (p[4] * p[8] - p[5] * p[7]) -
        p[1] * (p[3] * p[8] - p[5] * p[6]) +
        p[2] * (p[3] * p[7] - p[4] * p[6])) /
      6;
  }
  return volume;
}
async function observeCsp(page: Page) {
  const errors: string[] = [],
    violations: Array<{ directive: string; blocked: string }> = [],
    workerUrls: string[] = [],
    assetHeaderJobs: Array<Promise<{ url: string; csp: string | undefined }>> =
      [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  page.on("response", (response) => {
    if (response.url().includes("/assets/"))
      assetHeaderJobs.push(
        response.allHeaders().then((headers) => ({
          url: response.url(),
          csp: headers["content-security-policy"],
        })),
      );
  });
  await page.exposeFunction(
    "reportCspViolation",
    (directive: string, blocked: string) =>
      violations.push({ directive, blocked }),
  );
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) => {
      void (
        window as unknown as {
          reportCspViolation(directive: string, blocked: string): Promise<void>;
        }
      ).reportCspViolation(event.effectiveDirective, event.blockedURI);
    }),
  );
  return { errors, violations, workerUrls, assetHeaderJobs };
}
test("built app enforces CSP while native modeling, import, recovery and STL workers operate", async ({
  page,
}, info) => {
  const { errors, violations, workerUrls, assetHeaderJobs } =
    await observeCsp(page);
  const response = await page.goto("/");
  for (const [header, value] of Object.entries(SECURITY_HEADERS))
    expect(response!.headers()[header.toLowerCase()]).toBe(value);
  await page.getByLabel("UI theme", { exact: true }).selectOption("saturn");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "saturn");
  await page
    .getByRole("button", { name: "Load parametric box template" })
    .click();
  const exporting = page.getByRole("button", {
    name: "Export STL",
    exact: true,
  });
  await expect(exporting).toBeEnabled();
  await page.getByRole("button", { name: "Box Extrude", exact: true }).click();
  await expect(page.getByText("Volume (mm³)", { exact: true })).toBeVisible();
  expect(workerUrls.some((url) => /geometryWorker/.test(url))).toBe(true);
  const width = page.getByRole("textbox", {
    name: "Parameter width expression",
    exact: true,
  });
  await width.fill("90mm");
  await width.press("Enter");
  await expect(exporting).toBeEnabled();
  let download = page.waitForEvent("download");
  await exporting.click();
  let path = info.outputPath("native.stl");
  await (await download).saveAs(path);
  expect(stlVolume(await readFile(path))).toBeCloseTo(90000, 3);
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  path = info.outputPath("built.pcaddoc");
  await (await download).saveAs(path);
  await page
    .getByRole("button", { name: "Load mounting plate template" })
    .click();
  await expect(exporting).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(width).toHaveValue("90mm");
  await expect(exporting).toBeEnabled();
  await width.fill("91mm");
  await width.press("Enter");
  await expect(exporting).toBeEnabled();
  await expect(
    page.getByText("Autosaved locally", { exact: true }),
  ).toBeVisible();
  const savedId = JSON.parse(await readFile(path, "utf8")).id as string;
  await expect
    .poll(() =>
      page.evaluate(
        async ({ id, dbName, storeName }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(dbName);
            request.onupgradeneeded = () => request.transaction?.abort();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            return await new Promise<string | undefined>((resolve, reject) => {
              const request = db
                .transaction(storeName)
                .objectStore(storeName)
                .get(id);
              request.onsuccess = () =>
                resolve(
                  request.result?.latest?.text
                    ? JSON.parse(request.result.latest.text).parameters.width
                        .expression
                    : undefined,
                );
              request.onerror = () => reject(request.error);
            });
          } finally {
            db.close();
          }
        },
        { id: savedId, dbName: AUTOSAVE_DB, storeName: AUTOSAVE_STORE },
      ),
    )
    .toBe("91mm");
  await page.reload();
  const recovery = page.getByRole("dialog", {
    name: "Recover unsaved project",
  });
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Recover Parametric Box", exact: true })
    .click();
  await expect(width).toHaveValue("91mm");
  await expect(exporting).toBeEnabled();
  let assembly = createBoxTemplate();
  let second = addCenterRectangle(
    createXySketch("Second body"),
    "width",
    "height",
  );
  second = {
    ...second,
    entities: Object.fromEntries(
      Object.entries(second.entities).map(([id, e]) => [
        id,
        e.type === "point"
          ? { ...e, x: { ...e.x, expression: `(${e.x.expression}) + 15mm` } }
          : e,
      ]),
    ),
  };
  assembly = upsertSketch(assembly, second);
  assembly = upsertFeature(
    assembly,
    createExtrudeFeature({
      name: "Second body",
      sketchId: second.id,
      profileId: detectProfiles(
        solveSketch(second, evaluateParameters(assembly.parameters).values),
      ).profiles[0].id,
      operation: "newBody",
      direction: "positive",
      distance: { expression: "depth", unit: "mm" },
    }),
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "union.pcaddoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(assembly)),
  });
  await expect(page.getByText("2 bodies", { exact: true })).toBeVisible();
  await expect(exporting).toBeEnabled();
  await exporting.click();
  const panel = page.getByRole("dialog", { name: "STL export options" });
  await panel.getByLabel("Output files").selectOption("merged");
  download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Generate STL", exact: true })
    .click();
  path = info.outputPath("native-union.stl");
  await (await download).saveAs(path);
  expect(stlVolume(await readFile(path))).toBeCloseTo(95000, 3);
  expect(workerUrls.some((url) => /importWorker/.test(url))).toBe(true);
  expect(workerUrls.some((url) => /exportWorker/.test(url))).toBe(true);
  const assetHeaders = await Promise.all(assetHeaderJobs);
  expect(assetHeaders.some((asset) => asset.url.endsWith(".wasm"))).toBe(true);
  expect(
    assetHeaders.every((asset) => asset.csp === CONTENT_SECURITY_POLICY),
  ).toBe(true);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("production CSP blocks inline scripts, JS eval and remote fetch", async ({
  page,
}) => {
  const { violations } = await observeCsp(page);
  const response = await page.goto("/");
  expect(response!.headers()["content-security-policy"]).toBe(
    CONTENT_SECURITY_POLICY,
  );
  await expect(page.getByText("PlainCAD", { exact: true })).toBeVisible();
  // Explicit negative probes prove enforcement, then verify the expected violations.
  await page.route("**/__csp_eval_probe.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      headers: SECURITY_HEADERS,
      body: "window.cspEvalBlocked=false;try{(0,eval)('window.cspEvalExecuted=true')}catch{window.cspEvalBlocked=true}",
    }),
  );
  await page.addScriptTag({ url: "/__csp_eval_probe.js" });
  const probes = await page.evaluate(async () => {
    const script = document.createElement("script");
    script.textContent = "window.cspProbeExecuted = true";
    document.head.appendChild(script);
    let externalBlocked = false;
    try {
      await fetch("https://example.invalid/csp-probe");
    } catch {
      externalBlocked = true;
    }
    return {
      inlineBlocked: !(window as unknown as { cspProbeExecuted?: boolean })
        .cspProbeExecuted,
      externalBlocked,
      evalBlocked:
        (window as unknown as { cspEvalBlocked?: boolean }).cspEvalBlocked ===
          true &&
        !(window as unknown as { cspEvalExecuted?: boolean }).cspEvalExecuted,
    };
  });
  expect(probes).toEqual({
    inlineBlocked: true,
    evalBlocked: true,
    externalBlocked: true,
  });
  await expect
    .poll(() =>
      violations.some(
        (v) => v.directive === "script-src-elem" && v.blocked === "inline",
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      violations.some(
        (v) => v.directive === "script-src" && v.blocked === "eval",
      ),
    )
    .toBe(true);
  await expect
    .poll(() => violations.some((v) => v.directive === "connect-src"))
    .toBe(true);
});

test("production CSP permits explicit native scope capture and subsequent STL export", async ({
  page,
}, info) => {
  const { errors, violations, workerUrls } = await observeCsp(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load parametric box template", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  let document = createBoxTemplate();
  const sketch = addCircleAt(createXySketch("Scope tool"), "5mm", "5mm", "2mm");
  const feature = createExtrudeFeature({
    name: "Scoped cut",
    sketchId: sketch.id,
    profileId: detectProfiles(solveSketch(sketch, {})).profiles[0].id,
    operation: "cut",
    targetBodyIds: [],
    direction: "positive",
    termination: { type: "throughAll" },
    distance: { expression: "10mm", unit: "mm" },
  });
  document = upsertFeature(upsertSketch(document, sketch), feature);
  await page.locator('input[type="file"]').setInputFiles({
    name: "scope.pcaddoc",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await page
    .getByRole("list", { name: "Sketch and feature history" })
    .getByRole("button", { name: /Scoped cut/ })
    .click();
  await page
    .getByRole("button", { name: "Capture intersected targets", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  expect(workerUrls.some((url) => /scopeCaptureWorker/.test(url))).toBe(true);
  await expect(
    page.getByRole("combobox", { name: "Target body", exact: true }),
  ).toHaveValue(`body:${document.features[0].id}`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const path = info.outputPath("scoped.stl");
  await (await download).saveAs(path);
  expect(
    stlVolume(await readFile(path)) / (80000 - Math.PI * 4 * 20),
  ).toBeCloseTo(1, 3);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("built app draws and dimensions a native sketch under production CSP", async ({
  page,
}, info) => {
  const { errors, violations } = await observeCsp(page);
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page
    .getByRole("button", { name: "Create XZ sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit sketch canvas", exact: true })
    .click();
  await page.getByLabel("Canvas tool", { exact: true }).selectOption("circle");
  await page
    .getByRole("button", { name: "Place coordinate", exact: true })
    .click();
  await page.getByLabel("Canvas coordinate X", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Place coordinate", exact: true })
    .click();
  const svg = page.getByLabel("Sketch drawing canvas", { exact: true });
  await page.getByLabel("Show reference measurements", { exact: true }).check();
  await expect(svg.locator("text")).toHaveText("R 5.0000 mm");
  await page
    .getByLabel("Canvas dimension type", { exact: true })
    .selectOption("diameter");
  await page
    .getByLabel("Canvas dimension reference 1", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByLabel("Canvas dimension expression", { exact: true })
    .fill("20mm");
  await page
    .getByRole("button", { name: "Apply driving dimension", exact: true })
    .click();
  await expect(svg.locator("[data-dimension-id] text")).toHaveText(
    "D1 Ø 20.0000 mm",
  );
  await page
    .getByRole("button", { name: "Finish Sketch", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Extrude selected sketch", exact: true })
    .click();
  await applyExtrusion(page);
  await expect(
    page.getByRole("button", { name: "Export STL", exact: true }),
  ).toBeEnabled();
  await page
    .locator(".body-row")
    .getByRole("button", { name: /Extrude 1/ })
    .click();
  await expect(
    page.getByText("Volume (mm³)", { exact: true }).locator(".."),
  ).toContainText("3141.593");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL", exact: true }).click();
  const path = info.outputPath("dimensioned.stl");
  await (await download).saveAs(path);
  const bytes = await readFile(path);
  expect(stlVolume(bytes) / (Math.PI * 100 * 10)).toBeCloseTo(1, 2);
  const axes: number[][] = [[], [], []];
  for (let i = 0; i < bytes.readUInt32LE(80); i++)
    for (let j = 0; j < 9; j++)
      axes[j % 3].push(bytes.readFloatLE(96 + 50 * i + j * 4));
  expect(Math.min(...axes[1])).toBeCloseTo(-10, 4);
  expect(Math.max(...axes[1])).toBeCloseTo(0, 4);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
