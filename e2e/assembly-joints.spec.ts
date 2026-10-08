import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
async function command(page: Page, id: string, args = {}) { await page.evaluate(async ({ id, args }) => { const path = "/src/ui/commands/commandRegistry.ts"; await (await import(path)).runCommand(id, args); }, { id, args }); }
async function geometry(page: Page, min: number[], max: number[], collisions = 0) {
  await expect(async () => {
    const state = await aiSnapshot(page); expect(state.status).toBe("succeeded"); expect(state.result?.errors).toEqual([]); expect(state.result?.success).toBe(true);
    expect(state.result?.meshes).toHaveLength(2); for (const mesh of state.result!.meshes) { expect(mesh.geometrySource).toBe("opencascade"); expect(mesh.geometryAssertions).toMatchObject({ valid: true, solidCount: 1 }); expect(mesh.geometryAssertions!.volume).toBeCloseTo(1000, 7); }
    const mesh = state.result!.meshes.find(mesh => mesh.bodyId === "body:second-solid")!;
    for (const axis of [0, 1, 2]) { expect(mesh.bounds.min[axis]).toBeCloseTo(min[axis], 6); expect(mesh.bounds.max[axis]).toBeCloseTo(max[axis], 6); }
    expect(state.result?.assemblyCollisionStatus).toBe("complete");
    expect(state.result?.assemblyCollisions).toHaveLength(collisions);
    if (collisions) { expect(mesh.color).toBe("#e96848"); expect(mesh.assemblyCollision).toBe(true); }
    else { expect(mesh.color).not.toBe("#e96848"); expect(mesh.assemblyCollision).not.toBe(true); }
  }).toPass({ timeout: 30000 });
}
test("face-picked slider joint gives native motion, collisions, undo, cancellation and durable placed STL", async ({ page }, info) => {
  const document = JSON.parse(await readFile("src/persistence/fixtures/schema-v18.pcaddoc", "utf8")); delete document.assemblyJoints;
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles({ name: "assembly.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) }); await geometry(page, [0, 0, 10], [20, 10, 15]);
  await command(page, "component.activate", { componentId: "second-component" }); await command(page, "component.move");
  const placement = page.getByRole("dialog", { name: "Move or rotate component", exact: true });
  await placement.getByLabel("Keep connected").selectOption("slider"); await placement.getByRole("combobox", { name: "Source geometry", exact: true }).selectOption("face:extrude:second-solid:startCap"); await placement.getByRole("combobox", { name: "Target geometry", exact: true }).selectOption("face:extrude:first-solid:endCap");
  await expect(placement.getByRole("button", { name: "Apply component placement", exact: true })).toBeEnabled(); await placement.getByRole("button", { name: "Apply component placement", exact: true }).click(); await geometry(page, [0, 0, 5], [20, 10, 10]);
  const before = await aiSnapshot(page); expect(before.document.assemblyJoints).toHaveLength(1);
  await command(page, "assembly.motion"); let motion = page.getByRole("dialog", { name: "Assembly motion", exact: true }); await motion.getByLabel("Exact motion").fill("-3"); await motion.getByLabel("Exact motion").press("Enter");
  await expect(motion.getByRole("status")).toContainText("1 native collision pairs"); expect((await aiSnapshot(page)).document).toEqual(before.document);
  await motion.getByRole("button", { name: "Apply joint motion" }).click(); await geometry(page, [0, 0, 2], [20, 10, 7], 1); expect((await aiSnapshot(page)).past).toBe(before.past + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click(); await geometry(page, [0, 0, 5], [20, 10, 10]); await page.getByRole("button", { name: "Redo", exact: true }).click(); await geometry(page, [0, 0, 2], [20, 10, 7], 1);
  await command(page, "assembly.motion"); motion = page.getByRole("dialog", { name: "Assembly motion", exact: true }); await motion.getByLabel("Exact motion").fill("10"); await motion.getByLabel("Exact motion").press("Enter"); await expect(motion.getByRole("status")).toContainText("0 native collision pairs"); await motion.getByRole("button", { name: "Cancel motion" }).click(); await geometry(page, [0, 0, 2], [20, 10, 7], 1);
  const saving = page.waitForEvent("download"); await page.getByRole("button", { name: "Save project", exact: true }).click(); const saved = info.outputPath("assembly.pcaddoc"); await (await saving).saveAs(saved); expect(JSON.parse(await readFile(saved, "utf8")).assemblyJoints[0].value).toBe(-3); const session = (await aiSnapshot(page)).session; await page.locator('input[type="file"]').first().setInputFiles(saved); await expect.poll(async () => (await aiSnapshot(page)).session).toBeGreaterThan(session); await expect.poll(async () => page.evaluate(async () => { const path = "/src/state/useCadStore.ts"; return (await import(path)).useCadStore.getState().fileBusy; })).toBe(false); await geometry(page, [0, 0, 2], [20, 10, 7], 1);
  const exporting = page.waitForEvent("download"); await page.evaluate(async () => { const path = "/src/persistence/fileJobs.ts"; await (await import(path)).runFabrication("separate", true, ["body:second-solid"]); }); const stl = info.outputPath("slider.stl"); await (await exporting).saveAs(stl); expect(stlSignedVolume(await readFile(stl))).toBeCloseTo(1000, 6);
});
test("native hinge follows parent placement, rotates exact solid bounds and diagnoses a lost mating face", async ({ page }) => {
  const document = JSON.parse(await readFile("src/persistence/fixtures/schema-v18.pcaddoc", "utf8")); Object.assign(document.assemblyJoints[0], { type: "hinge", value: 90, minimum: -180, maximum: 180 });
  document.components["first-component"].placement.translation = [40, 30, 20];
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles({ name: "hinge.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) }); await geometry(page, [30, 30, 25], [40, 50, 30]);
  await page.evaluate(async () => { const path = "/src/state/useCadStore.ts"; const store = (await import(path)).useCadStore; store.getState().updateDocument((current: typeof document) => ({ ...current, assemblyJoints: current.assemblyJoints.map((joint: { sourceFaceId: string }) => ({ ...joint, sourceFaceId: "missing" })) })); });
  await expect.poll(async () => (await aiSnapshot(page)).status).toBe("failed"); expect((await aiSnapshot(page)).result?.errors.some(error => error.message.includes("mating face was lost"))).toBe(true);
  expect((await aiSnapshot(page)).result?.assemblyCollisionStatus).toBe("incomplete");
});

test("native collision rejects overlapping bounding boxes for separated rotated solids", async ({ page }) => {
  const document = JSON.parse(await readFile("src/persistence/fixtures/schema-v18.pcaddoc", "utf8"));
  document.components["first-component"].placement.rotation = [0, 0, Math.PI / 4];
  document.components["second-component"].placement = { translation: [-8, 8, 10], rotation: [0, 0, Math.PI / 4] };
  Object.assign(document.assemblyJoints[0], { parentRest: document.components["first-component"].placement, childRest: document.components["second-component"].placement, gap: -3 });
  await page.goto("/"); await page.locator('input[type="file"]').first().setInputFiles({ name: "separated.pcaddoc", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await geometry(page, [-8 - 10 / Math.sqrt(2), 8, 2], [-8 + 20 / Math.sqrt(2), 8 + 30 / Math.sqrt(2), 7]);
  const meshes = (await aiSnapshot(page)).result!.meshes;
  for (const axis of [0, 1, 2]) expect(Math.min(meshes[0].bounds.max[axis], meshes[1].bounds.max[axis]) - Math.max(meshes[0].bounds.min[axis], meshes[1].bounds.min[axis])).toBeGreaterThan(0);
});
