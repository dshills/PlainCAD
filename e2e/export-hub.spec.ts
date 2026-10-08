import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { aiSnapshot, stlSignedVolume } from "./aiAcceptanceHelpers";
import { inspectPngDownload } from "./pngDownload";
import { assertStepProofs, expectedStepProofs, loadStepFixture, observeStepProofs, stepTranscripts } from "./stepExportHelpers";
async function selectImageSource(page: Page, kind: "body" | "sketch", id: string) {
    await page.evaluate(async ({ kind, id }) => {
        const path = "/src/state/useCadStore.ts";
        const state = (await import(path)).useCadStore.getState();
        state.select({ kind, id, documentId: state.history.present.id });
    }, { kind, id });
}
async function hub(page: Page, goal?: RegExp) {
    await expect(page.getByRole("dialog", { name: "Save or export", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Save or export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Save or export", exact: true });
    await expect(dialog.getByRole("radio")).toHaveCount(5);
    if (goal)
        await dialog.getByRole("radio", { name: goal }).check();
    return dialog;
}
test("unified hub produces editable project, validated STL/STEP, project/part/sketch PNG and a complete library pack without changing native geometry", async ({ page }, info) => {
    await observeStepProofs(page);
    const model = await loadStepFixture(page);
    await expect(async () => {
        const state = await aiSnapshot(page);
        expect(state.status).toBe("succeeded");
        expect(state.result!.meshes).toHaveLength(2);
        state.result!.meshes.forEach((mesh, index) => { expect(mesh).toMatchObject({ geometrySource: "opencascade", geometryAssertions: { valid: true, solidCount: 1 } }); expect(mesh.geometryAssertions!.volume).toBeCloseTo(expectedStepProofs()[index].volume, 5); });
    }).toPass();
    const before = await aiSnapshot(page);
    let dialog = await hub(page), downloading = page.waitForEvent("download");
    await test.step("Download the editable project", async () => {
        await dialog.getByRole("button", { name: "Save editable project", exact: true }).click();
        const projectPath = info.outputPath("hub.pcaddoc");
        await (await downloading).saveAs(projectPath);
        const saved = JSON.parse(await readFile(projectPath, "utf8"));
        expect(saved.components).toEqual(before.document.components);
        expect(saved.features).toEqual(before.document.features);
    });
    await test.step("Capture project, part and sketch images", async () => {
        dialog = await hub(page, /Image \(\.png\)/);
        downloading = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "Download PNG", exact: true }).click();
        await inspectPngDownload(page, await downloading, info.outputPath("hub-project.png"));
        await selectImageSource(page, "body", model.rimId);
        dialog = await hub(page, /Image \(\.png\)/);
        await dialog.getByRole("combobox", { name: "Image content" }).selectOption("body");
        downloading = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "Download PNG", exact: true }).click();
        await inspectPngDownload(page, await downloading, info.outputPath("hub-part.png"));
        const sketchId = Object.values(model.document.sketches)[0].id;
        await selectImageSource(page, "sketch", sketchId);
        dialog = await hub(page, /Image \(\.png\)/);
        await dialog.getByRole("combobox", { name: "Image content" }).selectOption("sketch");
        await expect(dialog.getByRole("status")).toContainText("does not download");
        await dialog.getByRole("button", { name: "Open sketch image" }).click();
        await expect(page.getByRole("group", { name: "Sketch drawing canvas", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Save or export", exact: true })).toBeDisabled();
        downloading = page.waitForEvent("download");
        await page.getByRole("button", { name: "Download sketch PNG", exact: true }).last().click();
        await inspectPngDownload(page, await downloading, info.outputPath("hub-sketch.png"));
        await page.getByRole("button", { name: "Finish Sketch", exact: true }).last().click();
    });
    await test.step("Download selected-part STL", async () => {
        dialog = await hub(page, /Export for printing/);
        await dialog.getByRole("button", { name: "Clear body selection" }).click();
        await dialog.getByLabel("Export body Arc rim", { exact: true }).check();
        downloading = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "Generate STL", exact: true }).click();
        const stlPath = info.outputPath("hub.stl");
        await (await downloading).saveAs(stlPath);
        const stl = await readFile(stlPath);
        expect(Math.abs(stlSignedVolume(stl) / expectedStepProofs()[0].volume - 1)).toBeLessThan(0.005);
    });
    await test.step("Validate and download native STEP", async () => {
        dialog = await hub(page, /Other CAD/);
        await dialog.getByRole("button", { name: "Choose parts for STEP" }).click();
        const step = page.getByRole("dialog", { name: "Export STEP", exact: true });
        await step.getByRole("button", { name: "Generate validated STEP" }).click();
        await expect(step.getByRole("button", { name: "Download STEP file" })).toBeEnabled();
        const proof = (await stepTranscripts(page)).at(-1);
        if (!proof) throw new Error("Native STEP export returned no geometry proof.");
        assertStepProofs(proof);
        downloading = page.waitForEvent("download");
        await step.getByRole("button", { name: "Download STEP file" }).click();
        const stepPath = info.outputPath("hub.step");
        await (await downloading).saveAs(stepPath);
        expect(await readFile(stepPath, "utf8")).toMatch(/^ISO-10303-21;/);
    });
    await test.step("Back up editable library copies", async () => {
        dialog = await hub(page, /Library backup/);
        await dialog.getByRole("button", { name: "Review library backup" }).click();
        const library = page.getByRole("region", { name: "Local part library", exact: true });
        await expect(library.getByRole("button", { name: "Save active component to library" })).toBeEnabled();
        await library.getByLabel("Name for active component").fill("Hub saved rim");
        await library.getByRole("button", { name: "Save active component to library" }).click();
        await expect(library.getByRole("button", { name: "Download library backup" })).toBeEnabled();
        downloading = page.waitForEvent("download");
        await library.getByRole("button", { name: "Download library backup" }).click();
        const packPath = info.outputPath("hub.pcadlib");
        await (await downloading).saveAs(packPath);
        const pack = JSON.parse(await readFile(packPath, "utf8"));
        expect(pack).toMatchObject({ format: "plaincad-part-library", version: 1 });
        expect(pack.entries).toHaveLength(1);
        expect(pack.entries[0].name).toBe("Hub saved rim");
        expect(JSON.parse(pack.entries[0].text).features.length).toBeGreaterThan(0);
    });
    const after = await aiSnapshot(page);
    expect(after.document).toEqual(before.document);
    expect(after.past).toBe(before.past);
    expect(after.result!.meshes.map(mesh => mesh.geometryAssertions)).toEqual(before.result!.meshes.map(mesh => mesh.geometryAssertions));
});
