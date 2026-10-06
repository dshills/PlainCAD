import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyExtrusion } from "./extrudeWorkflow";
import type { CadDocument } from "../src/cad/document/schema";
import type { RebuildResult } from "../src/cad/worker/workerProtocol";

async function snapshot(page: Page): Promise<{ document: CadDocument; status: string; result: RebuildResult; past: number }> {
  return page.evaluate(async () => {
    const path = "/src/state/useCadStore.ts", state = (await import(path)).useCadStore.getState();
    return { document: state.history.present, status: state.rebuild.status, result: state.rebuild.result, past: state.history.past.length };
  });
}
async function ready(page: Page, volume?: number) {
  await expect(async () => {
    const state = await snapshot(page);
    expect(state.status).toBe("succeeded");
    expect(state.result.documentId).toBe(state.document.id);
    expect(state.result.errors).toEqual([]);
    if (volume !== undefined) {
      expect(state.result.meshes).toHaveLength(1);
      expect(state.result.meshes[0].geometrySource).toBe("opencascade");
      expect(state.result.meshes[0].geometryAssertions).toMatchObject({ valid: true, solidCount: 1 });
      expect(state.result.meshes[0].geometryAssertions!.volume).toBeCloseTo(volume, 5);
    }
  }).toPass();
}
function stlVolume(bytes: Buffer) {
  let sum = 0;
  for (let i=0; i<bytes.readUInt32LE(80); i++) {
    const p = Array.from({ length:9 }, (_,j) => bytes.readFloatLE(96 + 50*i + 4*j));
    sum += (p[0]*(p[4]*p[8]-p[5]*p[7])-p[1]*(p[3]*p[8]-p[5]*p[6])+p[2]*(p[3]*p[7]-p[4]*p[6]))/6;
  }
  return sum;
}
test("guided closing-edge repair highlights the proposal, preserves one Undo and yields native save/open/STL geometry", async ({page}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  const fixture = await page.evaluate(async () => {
    const docPath="/src/cad/document/CadDocument.ts", sketchPath="/src/cad/sketch/SketchModel.ts", canvasPath="/src/cad/sketch/canvasGeometry.ts", solvePath="/src/cad/sketch/SketchSolver.ts";
    const docs=await import(docPath), {createXySketch}=await import(sketchPath), {addCanvasGeometry}=await import(canvasPath), {solveSketch}=await import(solvePath);
    let sketch=createXySketch("Unfinished mouse outline");
    for (const [a,b] of [[[0,0],[20,0]],[[20,0],[20,10]],[[20,10],[0,10]]])
      sketch=addCanvasGeometry(sketch,solveSketch(sketch,{}),"line",[{x:a[0],y:a[1]},{x:b[0],y:b[1]}]).sketch;
    return docs.upsertSketch(docs.createEmptyDocument("Repair workflow"),sketch);
  });
  await page.locator('input[type="file"]').setInputFiles({name:"open.pcaddoc",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(fixture))});
  await expect.poll(async()=> (await snapshot(page)).document.id).toBe(fixture.id);
  await ready(page);
  const card=page.locator(".repair-card").filter({hasText:"Close this sketch outline"}).first();
  const add=card.getByRole("button",{name:"Add missing closing edge",exact:true});
  await expect(add).toBeDisabled();
  const before=await snapshot(page);
  await card.getByRole("button",{name:"Show and repair",exact:true}).click();
  await expect(page.getByLabel("Proposed missing closing edge")).toBeVisible();
  await expect(page.locator(".canvas-point.canvas-entity-selected")).toHaveCount(2);
  expect((await snapshot(page)).document).toEqual(before.document);
  await add.click();
  await ready(page);
  expect((await snapshot(page)).past).toBe(before.past+1);
  expect((await snapshot(page)).result.profiles![Object.keys(fixture.sketches)[0]]).toHaveLength(1);
  await page.getByRole("button",{name:"Finish Sketch",exact:true}).click();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await ready(page);
  expect((await snapshot(page)).document.sketches).toEqual(fixture.sketches);
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  await ready(page);
  await page.getByRole("button",{name:"Extrude selected sketch",exact:true}).click();
  await applyExtrusion(page);
  await ready(page,2000);
  const model=await snapshot(page);
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Save project",exact:true}).click();
  const saved=await download, path=await saved.path();
  if (!path) throw new Error("Missing saved project");
  await page.getByRole("button",{name:"New project",exact:true}).click();
  await page.locator('input[type="file"]').setInputFiles(path);
  await ready(page,2000);
  expect((await snapshot(page)).document.sketches).toEqual(model.document.sketches);
  const meshDownload=page.waitForEvent("download");
  await page.getByRole("button",{name:"Export STL",exact:true}).click();
  const stl=await meshDownload, stlPath=await stl.path();
  if (!stlPath) throw new Error("Missing STL");
  expect(stlVolume(await readFile(stlPath))).toBeCloseTo(2000,4);
  expect(errors).toEqual([]);
});

test("guided conflicting-dimension card opens the precise drawing control and permits explicit repair", async ({page}) => {
  await page.goto("/");
  await ready(page);
  const fixture=await page.evaluate(async()=>{
    const docPath="/src/cad/document/CadDocument.ts", sketchPath="/src/cad/sketch/SketchModel.ts";
    const docs=await import(docPath), sketches=await import(sketchPath);
    const sketch=sketches.addCircleAt(sketches.createXySketch("Conflicting circle"),"0mm","0mm","5mm");
    const circle=Object.values(sketch.entities).find((e:any)=>e.type==="circle") as {id:string};
    sketch.dimensions=[{id:"desired-size",type:"radius",entityIds:[circle.id],expression:{expression:"5mm",unit:"mm"}},{id:"conflicting-size",type:"radius",entityIds:[circle.id],expression:{expression:"10mm",unit:"mm"}}];
    return docs.upsertSketch(docs.createEmptyDocument("Dimension repair"),sketch);
  });
  await page.locator('input[type="file"]').setInputFiles({name:"conflict.pcaddoc",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(fixture))});
  await expect.poll(async()=> (await snapshot(page)).document.id).toBe(fixture.id);
  await expect.poll(async()=> (await snapshot(page)).status).toBe("failed");
  await page.getByLabel("Workspace layout").selectOption("focused");
  await page.getByLabel("Task panel").selectOption("issues");
  const card=page.locator(".repair-card").filter({hasText:"Repair a driving dimension"}).first();
  await card.getByRole("button",{name:"Show and repair",exact:true}).click();
  await expect(page.getByRole("region",{name:"Sketch canvas",exact:true})).toBeVisible();
  const dimension=page.getByLabel("Sketch size expression",{exact:true});
  await expect(dimension).not.toHaveValue("");
  const before=await snapshot(page);
  await page.getByRole("button",{name:"Delete this dimension",exact:true}).click();
  await ready(page);
  expect((await snapshot(page)).past).toBe(before.past+1);
  expect(Object.values((await snapshot(page)).document.sketches)[0].dimensions).toHaveLength(1);
  await page.getByRole("button",{name:"Finish Sketch",exact:true}).click();
  await page.getByRole("button",{name:"Extrude selected sketch",exact:true}).click();
  await applyExtrusion(page);
  const dimensionValue=Number(Object.values((await snapshot(page)).document.sketches)[0].dimensions[0].expression.expression.replace("mm",""));
  await ready(page, Math.PI*dimensionValue*dimensionValue*10);
});
