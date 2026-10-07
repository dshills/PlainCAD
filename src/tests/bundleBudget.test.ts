// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "plaincad-bundle-budget-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

function check() {
  return execFileSync(process.execPath, [resolve("scripts/check-bundle-size.mjs"), directory], { encoding: "utf8", stdio: "pipe" });
}

it("accepts the exact JavaScript budget and excludes binary kernel assets", () => {
  writeFileSync(join(directory, "index.js"), Buffer.alloc(500_000));
  writeFileSync(join(directory, "kernel.wasm"), Buffer.alloc(500_001));
  expect(check()).toContain("1 bundles, largest 500.00 kB");
});

it("rejects oversized worker bundles, including nested assets", () => {
  mkdirSync(join(directory, "workers"));
  writeFileSync(join(directory, "workers", "geometryWorker.js"), Buffer.alloc(500_001));
  expect(check).toThrow(/geometryWorker.js: 500.00 kB/);
});

it("rejects empty or missing build output", () => {
  expect(check).toThrow(/No JavaScript bundles found/);
  rmSync(directory, { recursive: true });
  expect(check).toThrow(/ENOENT/);
});
