// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { commandInstrumentation } from "../../scripts/command-instrumentation";
const plugin = commandInstrumentation();
function transform(code: string, path: string) { const hook = plugin.transform; if (typeof hook !== "function")
  throw new Error("Missing source instrumentation"); return hook.call({} as never, code, path) as {
  code: string;
} | undefined; }
describe("command coverage instrumentation", () => {
  it("preserves adjacent/nested/keyed JSX, spread callbacks and native listener capture", () => {
    const result = transform('const x = <><button key={id} onClick={save}>Save<input {...fields}/></button><button onClick={cancel}>Cancel</button></>; window.addEventListener("keydown", handler, true); window.removeEventListener("keydown", handler, true);', resolve("src/ui/example.tsx"));
    expect(result?.code).toContain("PlainCadCommandHost key={id}");
    expect(result?.code.match(/site=\{/g)).toHaveLength(3);
    expect(result?.code).toContain('plaincadRemoveCommandListenerArgs(window, ["keydown", handler, true])');
    expect((ts.createSourceFile("example.tsx", result!.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) as ts.SourceFile & {
      parseDiagnostics: unknown[];
    }).parseDiagnostics).toHaveLength(0);
    expect(transform("const x = <button onClick={save}/>;", resolve("src/commands/example.tsx"))).toBeUndefined();
  });
  it("preserves optional targets, spread options, nested listener/JSX coverage, directives and source maps", () => {
    const code = '"use client"; window.addEventListener("pointerdown", () => { window.addEventListener("pointerup", handler, ...options); return <button onClick={save}>Save</button>; }); missing?.addEventListener("click", handler);';
    const result = transform(code, resolve("src/ui/example.tsx"))!;
    expect(result.code.startsWith('"use client";')).toBe(true);
    expect(result.code.match(/plaincadAddCommandListenerArgs\(/g)).toHaveLength(3);
    expect(result.code).toContain('handler, ...options]');
    expect(result.code).toContain("plaincadTarget == null ? undefined");
    expect(result.code).toContain("PlainCadCommandHost");
    expect((ts.createSourceFile("example.tsx", result.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) as ts.SourceFile & {
      parseDiagnostics: unknown[];
    }).parseDiagnostics).toHaveLength(0);
    expect((result as unknown as {
      map: {
        sourcesContent: string[];
      };
    }).map.sourcesContent).toEqual([code]);
    expect(() => transform('missing?.child.addEventListener("click", handler);', resolve("src/ui/optional.ts"))).toThrow("guarded EventTarget");
  });
  it("covers every current JSX interaction and input listener without syntax errors", async () => {
    let covered = 0;
    async function inspect(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name).replaceAll("\\", "/");
        if (entry.isDirectory()) {
          if (!["tests", "commands"].includes(entry.name) || path.endsWith("ui/commands"))
            await inspect(path);
          continue;
        }
        if (!/\.tsx?$/.test(path))
          continue;
        const code = await readFile(path, "utf8"), result = transform(code, path);
        let expected = 0;
        const original = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        function count(node: ts.Node) { if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          const opening = ts.isJsxElement(node) ? node.openingElement : node, tag = opening.tagName.getText(original);
          if (["button", "summary", "a", "input", "select", "textarea"].includes(tag) || opening.attributes.properties.some(attribute => ts.isJsxSpreadAttribute(attribute) || ts.isJsxAttribute(attribute) && /^on[A-Z]/.test(attribute.name.getText(original))))
            expected++;
        } ts.forEachChild(node, count); }
        count(original);
        if (!result) { expect(expected, `${path}: interactive source skipped`).toBe(0); continue; }
        expect((result.code.match(/site=\{/g) ?? []).length, path).toBe(expected);
        const parsed = ts.createSourceFile(path, result.code, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) as ts.SourceFile & {
          parseDiagnostics: {
            messageText: string;
          }[];
        };
        expect(parsed.parseDiagnostics, path).toEqual([]);
        covered += (result.code.match(/site=\{/g) ?? []).length;
        expect(result.code, path).not.toMatch(/\.addEventListener\("(?:click|keydown|pointerdown|drop)"/);
      }
    }
    await inspect(resolve("src"));
    expect(covered).toBeGreaterThan(0);
  });
});
