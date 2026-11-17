import { applyExtrusion } from "./extrudeWorkflow";
import { test, expect } from "@playwright/test";
import { REBUILD_DEBOUNCE_MS } from "../src/cad/worker/workerLifecycle";
import type { CadStore } from "../src/state/useCadStore";
import type { WorkerRequest, WorkerResponse } from "../src/cad/worker/workerProtocol";
import { createBoxTemplate } from "../src/templates/templates";
import { aiSnapshot } from "./aiAcceptanceHelpers";
import { expectedGeometrySource } from "./expectedGeometrySource";

// The real worker still initializes WASM and computes every response. This test
// controls delivery order only, to reproduce races without timing-based sleeps.
declare global {
  interface Window {
    cadDelivery: {
      holdNext: boolean;
      deferDebounce: boolean;
      held: boolean;
      requests: WorkerRequest[];
      failWorker?: () => void;
      releaseResult?: () => void;
      releaseWrongEpoch?: () => void;
      debounceHeld: boolean;
      states: Array<{ expression: string; status: string; maxZ?: number }>;
    };
    cadOpenDelivery: {
      holdRebuild: boolean;
      rebuild?: () => void;
      imports: Map<string, () => void>;
    };
  }
}

test("opening a project keeps an in-flight rebuild from reporting the old project ready", async ({ page }) => {
  await page.addInitScript(() => {
    const held = window.cadOpenDelivery = {
      holdRebuild: false,
      imports: new Map<string, () => void>(),
    } as Window["cadOpenDelivery"];
    const BrowserWorker = window.Worker;
    window.Worker = class extends BrowserWorker {
      private fileName?: string;
      override postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        if (message instanceof File) this.fileName = message.name;
        super.postMessage(message, Array.isArray(options) ? { transfer: options } : options);
      }
      override set onmessage(listener: ((this: Worker, ev: MessageEvent) => unknown) | null) {
        super.onmessage = (event: MessageEvent) => {
          if (event.data.type === "rebuildResult" && held.holdRebuild) {
            held.holdRebuild = false;
            held.rebuild = () => listener?.call(this, event);
          } else if (this.fileName?.startsWith("held-") && ("result" in event.data || "error" in event.data)) {
            held.imports.set(this.fileName, () => listener?.call(this, event));
          } else listener?.call(this, event);
        };
      }
      override get onmessage() { return super.onmessage; }
    };
  });
  const waitForImport = (name: string) => expect.poll(() => page.evaluate((name) =>
    window.cadOpenDelivery.imports.has(name), name,
  )).toBe(true);
  const releaseImport = (name: string) => page.evaluate((name) =>
    window.cadOpenDelivery.imports.get(name)!(), name,
  );
  await page.goto("/");
  await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
  await page.getByRole("button", { name: "Load parametric box template", exact: true }).click();
  const exporting = page.getByRole("button", { name: "Export STL", exact: true });
  await expect(exporting).toBeEnabled();
  const original = await aiSnapshot(page);
  await page.evaluate(() => {
    window.cadOpenDelivery.holdRebuild = true;
  });
  const width = page.getByRole("textbox", { name: "Parameter width expression", exact: true });
  await width.fill("90mm");
  await width.press("Enter");
  await expect.poll(() => page.evaluate(() => Boolean(window.cadOpenDelivery.rebuild))).toBe(true);
  await expect(page.locator(".rebuild-pill")).toHaveText("rebuilding");

  const picker = page.locator('input[type="file"]').first();
  await picker.setInputFiles({ name: "held-broken.pcaddoc", mimeType: "application/json", buffer: Buffer.from("{bad json") });
  await waitForImport("held-broken.pcaddoc");
  await page.evaluate(() => window.cadOpenDelivery.rebuild!());
  const opening = await aiSnapshot(page);
  expect(opening.document.id).toBe(original.document.id);
  expect(opening.session).toBe(original.session);
  expect(opening.status).toBe("queued");
  expect(opening.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(90000, 7);
  await expect(exporting).toBeDisabled();

  // A newer open owns readiness even when the superseded result is delivered.
  await picker.setInputFiles({ name: "held-replacement.pcaddoc", mimeType: "application/json", buffer: Buffer.from("{bad json") });
  await waitForImport("held-replacement.pcaddoc");
  await releaseImport("held-broken.pcaddoc");
  await expect(page.locator(".rebuild-pill")).toHaveText("queued");
  await releaseImport("held-replacement.pcaddoc");
  await expect(exporting).toBeEnabled();
  const restored = await aiSnapshot(page);
  expect(restored.document.id).toBe(original.document.id);
  expect(restored.session).toBe(original.session);
  expect(restored.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(90000, 7);

  const replacement = createBoxTemplate();
  await picker.setInputFiles({
    name: "held-valid.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(replacement)),
  });
  await waitForImport("held-valid.pcaddoc");
  await expect(page.locator(".rebuild-pill")).toHaveText("queued");
  await releaseImport("held-valid.pcaddoc");
  await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(original.session);
  await expect(exporting).toBeEnabled();
  const accepted = await aiSnapshot(page);
  expect(accepted.document.id).toBe(replacement.id);
  expect(accepted.result?.meshes[0].geometryAssertions?.volume).toBeCloseTo(80000, 7);
});

for (const outcome of ["result", "worker failure"] as const) {
  test(`real-worker ${outcome} cannot overwrite a newer edit during debounce or after its rebuild`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((debounceMs) => {
      const delivery = window.cadDelivery = {
        holdNext: false, deferDebounce: false, held: false, debounceHeld: false,
        requests: [] as WorkerRequest[], states: [],
      } as Window["cadDelivery"];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        override postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
          // Recovery/import workers use a separate protocol and must not alter
          // the geometry worker selected for controlled failure or request counts.
          if (message && typeof message === "object" && "epoch" in message && "requestId" in message) {
            delivery.requests.push(structuredClone(message) as WorkerRequest);
            delivery.failWorker = () => this.dispatchEvent(new ErrorEvent("error", { message: "Controlled worker failure" }));
          }
          super.postMessage(message, Array.isArray(options) ? { transfer: options } : options);
        }
        override set onmessage(listener: ((this: Worker, ev: MessageEvent) => unknown) | null) {
          super.onmessage = (event: MessageEvent<WorkerResponse>) => {
            if (event.data.type === "rebuildResult" && delivery.holdNext) {
              delivery.holdNext = false;
              delivery.held = true;
              delivery.releaseResult = () => listener?.call(this, event);
              delivery.releaseWrongEpoch = () => listener?.call(this, new MessageEvent("message", {
                data: { ...event.data, epoch: event.data.epoch + 1 },
              }));
            } else {
              listener?.call(this, event);
            }
          };
        }
        override get onmessage() { return super.onmessage; }
      };
      const nativeTimeout = window.setTimeout.bind(window);
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delivery.deferDebounce && delay === debounceMs && typeof handler === "function") {
          // Deliberately pause dispatch: in-flight completion/failure must drain
          // the queue itself and clear this timer, without a debounce callback.
          delivery.debounceHeld = true;
          return nativeTimeout(() => { throw new Error("Queued rebuild did not drain"); }, 60_000);
        }
        return nativeTimeout(handler, delay, ...args);
      }) as typeof window.setTimeout;
    }, REBUILD_DEBOUNCE_MS);
    await page.goto("/");
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await page.getByRole("button", { name: "Add Parameter", exact: true }).click();
    await page.getByRole("button", { name: "Create XY sketch", exact: true }).click();
    await page.getByRole("button", { name: "Add center rectangle", exact: true }).click();
    await page.getByRole("button", { name: "Extrude selected sketch", exact: true }).click();
    await applyExtrusion(page);
    await page.getByLabel("Distance", { exact: true }).fill("param_1");
    await page.getByLabel("Distance", { exact: true }).press("Enter");
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts";
      const { useCadStore } = await import(path);
      useCadStore.subscribe((state: CadStore) => {
        window.cadDelivery.states.push({ expression: state.history.present.parameters.param_1.expression,
          status: state.rebuild.status, maxZ: state.rebuild.result?.meshes[0]?.bounds.max[2] });
      });
      window.cadDelivery.holdNext = true;
    });
    const expression = page.getByLabel("Parameter param_1 expression", { exact: true });
    await expression.fill("12mm");
    await expression.press("Enter");
    await expect.poll(() => page.evaluate(() => window.cadDelivery.held)).toBe(true);
    expect(await page.evaluate(() => typeof window.cadDelivery.releaseWrongEpoch)).toBe("function");
    await page.evaluate(() => window.cadDelivery.releaseWrongEpoch!());
    await expect(page.locator(".rebuild-pill")).toHaveText("rebuilding");
    await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeDisabled();
    const requestCount = await page.evaluate(() => window.cadDelivery.requests.length);
    await page.evaluate(() => { window.cadDelivery.deferDebounce = true; });
    await expression.fill("18mm");
    await expression.press("Enter");
    expect(await page.evaluate(() => window.cadDelivery.debounceHeld)).toBe(true);
    expect(await page.evaluate(() => window.cadDelivery.requests.length)).toBe(requestCount);
    await expect(page.locator(".rebuild-pill")).toHaveText("queued");
    await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeDisabled();
    await page.evaluate((outcome) => {
      window.cadDelivery.deferDebounce = false;
      if (outcome === "worker failure") window.cadDelivery.failWorker!();
      else window.cadDelivery.releaseResult!();
    }, outcome);
    // Drain the latest edit, reinitializing WASM first if the old worker failed.
    await expect(page.locator(".rebuild-pill")).toHaveText("succeeded");
    expect(await page.evaluate((count) => window.cadDelivery.requests.slice(count).map((request) => request.type), requestCount))
      .toEqual(outcome === "worker failure" ? ["initialize", "rebuild"] : ["rebuild"]);
    // Replay the old response after the latest successful rebuild; the listener
    // is synchronous, so any incorrect store notification is recorded immediately.
    await page.evaluate(() => window.cadDelivery.releaseResult!());
    const states = await page.evaluate(() => window.cadDelivery.states);
    expect(states.filter((state) => state.expression === "18mm" && state.status === "succeeded")).not.toHaveLength(0);
    expect(states.filter((state) => state.expression === "18mm" && state.status === "succeeded").every((state) => state.maxZ === 18)).toBe(true);
    const latest = await page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts";
      return (await import(path)).useCadStore.getState().rebuild.result;
    });
    expect(latest.meshes[0].geometrySource).toBe(expectedGeometrySource);
    expect(latest.meshes[0].bounds.max[2]).toBe(18);
    await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}
