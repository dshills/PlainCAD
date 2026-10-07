import { test, expect } from "@playwright/test";
import type { CadDocument } from "../src/cad/document/schema";

test("dependency navigation traces current authored inputs, downstream changes, missing bindings and cycles", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load parametric box template", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Dependencies", exact: true });
  const snapshot = async () =>
    page.evaluate(async () => {
      const path = "/src/state/useCadStore.ts";
      const s = (await import(path)).useCadStore.getState();
      return {
        status: s.rebuild.status,
        document: s.history.present as CadDocument,
        selection: s.selection.selectedIds[0],
        past: s.history.past.length,
        volume: s.rebuild.result?.meshes[0]?.geometryAssertions?.volume,
      };
    });
  await expect.poll(async () => (await snapshot()).status).toBe("succeeded");
  await page.getByLabel("Parameter width expression").focus();
  await expect(
    panel.getByRole("list", { name: "Affected outputs", exact: true }),
  ).toContainText("Box Base");
  await expect(
    panel.getByRole("list", { name: "Affected outputs", exact: true }),
  ).toContainText("Box Extrude");
  const initialAffectedCount = await panel
    .getByRole("list", { name: "Affected outputs", exact: true })
    .getByRole("listitem")
    .count();
  const baseline = await snapshot();
  await panel
    .getByRole("button", { name: "Inspect feature Box Extrude", exact: true })
    .click();
  await expect(
    panel.getByRole("list", { name: "Inputs", exact: true }),
  ).toContainText("depth");
  await expect(
    panel.getByRole("list", { name: "Inputs", exact: true }),
  ).toContainText("width");
  await panel
    .getByRole("button", { name: "Inspect parameter depth", exact: true })
    .click();
  expect((await snapshot()).selection?.id).toBe(
    baseline.document.parameters.depth.id,
  );
  expect((await snapshot()).past).toBe(baseline.past);
  expect((await snapshot()).document).toEqual(baseline.document);
  await page.getByRole("button", { name: "Rename parameter width", exact: true }).click();
  await page.getByLabel("Parameter width name").fill("span");
  await page.getByLabel("Parameter width name").press("Enter");
  await expect.poll(async () => (await snapshot()).status).toBe("succeeded");
  await page.getByRole("button", { name: "Box Extrude", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Inspect parameter span", exact: true }),
  ).toBeVisible();
  expect((await snapshot()).volume).toBeCloseTo(baseline.volume!, 4);
  await page.evaluate(async () => {
    const sp = "/src/state/useCadStore.ts",
      dp = "/src/cad/document/CadDocument.ts";
    const { upsertParameter } = await import(dp),
      store = (await import(sp)).useCadStore.getState();
    store.updateDocument((d: CadDocument) =>
      upsertParameter(
        upsertParameter(d, {
          id: "a",
          name: "a",
          expression: "b",
          value: 0,
          unit: "",
        }),
        { id: "b", name: "b", expression: "a", value: 0, unit: "" },
      ),
    );
  });
  await expect.poll(async () => (await snapshot()).status).toBe("failed");
  await page.getByLabel("Parameter a expression").focus();
  await expect(panel.getByText(/contains a cycle/)).toBeVisible();
  await expect(
    panel
      .getByRole("list", { name: "Inputs", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await snapshot()).status).toBe("succeeded");
  await page.evaluate(async () => {
    const sp = "/src/state/useCadStore.ts",
      dp = "/src/cad/document/CadDocument.ts";
    const { upsertParameter } = await import(dp),
      store = (await import(sp)).useCadStore.getState();
    store.updateDocument((d: CadDocument) =>
      upsertParameter(d, {
        id: "broken",
        name: "broken",
        expression: "span",
        parameterRefs: { span: "lost-parameter" },
        value: 0,
        unit: "mm",
      }),
    );
  });
  await expect.poll(async () => (await snapshot()).status).toBe("failed");
  await page.getByLabel("Parameter broken expression").focus();
  await expect(
    panel.getByRole("button", {
      name: "Inspect parameter Lost parameter lost-parameter",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("list", { name: "Inputs", exact: true }),
  ).toContainText("Missing reference");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await snapshot()).status).toBe("succeeded");
  await page.evaluate(async () => {
    const sp = "/src/state/useCadStore.ts",
      dp = "/src/cad/document/CadDocument.ts";
    const { upsertParameter } = await import(dp);
    (await import(sp)).useCadStore
      .getState()
      .updateDocument((d: CadDocument) => {
        for (let i = 0; i < 55; i++)
          d = upsertParameter(d, {
            id: `dependent-${i}`,
            name: `dependent_${i}`,
            expression: "span",
            value: 0,
            unit: "mm",
          });
        return d;
      });
  });
  await expect.poll(async () => (await snapshot()).status).toBe("succeeded");
  await page.getByLabel("Parameter span expression").focus();
  const affected = panel.getByRole("list", {
    name: "Affected outputs",
    exact: true,
  });
  await expect(affected.getByRole("listitem")).toHaveCount(50);
  await panel
    .getByRole("button", { name: "Show more affected outputs", exact: true })
    .click();
  await expect(affected.getByRole("listitem")).toHaveCount(
    initialAffectedCount + 55,
  );
  expect((await snapshot()).volume).toBeCloseTo(baseline.volume!, 4);
  await page.evaluate(async () => {
    const sp = "/src/state/useCadStore.ts",
      store = (await import(sp)).useCadStore.getState();
    store.updateParameter(store.history.present.parameters.span.id, {
      description: "Unrelated annotation",
    });
  });
  await expect.poll(async () => (await snapshot()).status).toBe("succeeded");
  await expect(affected.getByRole("listitem")).toHaveCount(
    initialAffectedCount + 55,
  );
  await page.getByLabel("Parameter depth expression").focus();
  await page.getByLabel("Parameter span expression").focus();
  await expect(affected.getByRole("listitem")).toHaveCount(50);
  expect(errors).toEqual([]);
});
