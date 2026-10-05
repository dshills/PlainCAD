import { expect, type Page } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";
import type { ViewerSnapshot } from "../src/viewer/viewerDiagnostics";
import type { AiAcceptanceCase } from "../src/tests/fixtures/aiAcceptanceCorpus";

export async function aiSnapshot(page: Page): Promise<{
  document: CadDocument;
  result?: RebuildResult;
  session: number;
  past: number;
  status: string;
}> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts",
      state = (await import(path)).useCadStore.getState();
    return {
      document: state.history.present,
      result: state.rebuild.result,
      session: state.documentSession,
      past: state.history.past.length,
      status: state.rebuild.status,
    };
  });
}
export async function assertAiAcceptanceGeometry(
  page: Page,
  example: AiAcceptanceCase,
  volume = example.volume,
) {
  await expect(async () => {
    const state = await aiSnapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result?.documentId).toBe(state.document.id);
    expect(state.result?.success).toBe(true);
    expect(state.result?.errors).toEqual([]);
    expect(state.result!.meshes).toHaveLength(example.bodies);
    let actualVolume = 0;
    for (const mesh of state.result!.meshes) {
      expect(mesh.geometrySource).toBe("opencascade");
      expect(mesh.geometryAssertions).toMatchObject({
        valid: true,
        solidCount: 1,
      });
      expect(Number.isFinite(mesh.geometryAssertions!.volume)).toBe(true);
      actualVolume += mesh.geometryAssertions!.volume;
    }
    expect(Math.abs(actualVolume / volume - 1)).toBeLessThan(1e-7);
  }).toPass({ timeout: 30000 });
}
export async function assertAiAcceptanceSpan(
  page: Page,
  example: AiAcceptanceCase,
) {
  await expect(async () => {
    const meshes = (await aiSnapshot(page)).result?.meshes;
    expect(meshes).toHaveLength(example.bodies);
    expect(
      Math.min(...meshes!.map((m) => m.bounds.min[example.span.axis])),
    ).toBeCloseTo(example.span.min, 5);
    expect(
      Math.max(...meshes!.map((m) => m.bounds.max[example.span.axis])),
    ).toBeCloseTo(example.span.max, 5);
  }).toPass({ timeout: 30000 });
}
export async function assertAiAcceptanceViewer(page: Page, bodies: number) {
  await expect(async () => {
    const snapshot: ViewerSnapshot | undefined = await page.evaluate(
      async () => {
        const path = "/src/viewer/viewerDiagnostics.ts";
        return (await import(path)).inspectViewer();
      },
    );
    expect(snapshot?.meshes.filter((m) => m.visible)).toHaveLength(bodies);
    expect(snapshot?.resources.programs).toBeGreaterThan(0);
  }).toPass({ timeout: 30000 });
}
export function stlSignedVolume(bytes: Buffer) {
  const count = bytes.readUInt32LE(80);
  expect(bytes.length).toBe(84 + 50 * count);
  expect(count).toBeGreaterThan(0);
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
