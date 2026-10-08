import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { createLibraryEntry, importLibraryCopies } from "../persistence/partLibrary";
import { decodeLibraryPack, LIBRARY_PACK_MAX_BYTES, serializeLibraryPack } from "../persistence/partLibraryPack";
import { importLibraryPackFile } from "../persistence/libraryPackFile";
import { importProjectText } from "../persistence/projectCodec";
import { rebuildDocument } from "../cad/features/rebuildGraph";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWv4sAAAAASUVORK5CYII=";
function entry() { const source = createBoxTemplate(); return createLibraryEntry(source, source.rootComponentId, "Transfer block", png); }
function pack(entries: unknown[]) { return JSON.stringify({ format: "plaincad-part-library", version: 1, entries }); }
afterEach(() => vi.unstubAllGlobals());
describe("portable library pack validation", () => {
  it("roundtrips thumbnail and editable parameter bindings without changing authored geometry", () => {
    const source = entry(), [copy] = decodeLibraryPack(serializeLibraryPack([source]));
    expect(copy).toEqual(source);
    const doc = importProjectText(copy.text), before = rebuildDocument(doc);
    expect(before.success).toBe(true); expect(before.meshes[0].bounds.max[0] - before.meshes[0].bounds.min[0]).toBe(80);
    const changed = rebuildDocument({ ...doc, parameters: { ...doc.parameters, width: { ...doc.parameters.width, expression: "100mm" } } });
    expect(changed.success).toBe(true); expect(changed.meshes[0].bounds.max[0] - changed.meshes[0].bounds.min[0]).toBe(100);
    expect(rebuildDocument(importProjectText(source.text)).meshes[0].bounds).toEqual(before.meshes[0].bounds);
  });
  it("accepts an empty complete backup but rejects unsupported, extra or malformed envelopes", () => {
    expect(decodeLibraryPack(serializeLibraryPack([]))).toEqual([]);
    expect(() => decodeLibraryPack('{"format":"plaincad-part-library","version":2,"entries":[]}')).toThrow(/unsupported/);
    expect(() => decodeLibraryPack('{"format":"plaincad-part-library","version":1,"entries":[],"other":true}')).toThrow(/envelope/);
    expect(() => decodeLibraryPack("[]")).toThrow(/envelope/);
    expect(() => decodeLibraryPack("{")).toThrow(/not valid JSON/);
  });
  it("rejects unsafe keys at both pack and individual project boundaries", () => {
    expect(() => decodeLibraryPack('{"format":"plaincad-part-library","version":1,"entries":[],"__proto__":{}}')).toThrow(/unsafe key/);
    expect(() => decodeLibraryPack(pack([{ ...entry(), text: '{"constructor":{}}' }]))).toThrow(/unsafe key/);
    expect(() => decodeLibraryPack(pack([{ ...entry(), thumbnail: "data:image/svg+xml,<svg/>" }]))).toThrow(/bounded PNG/);
  });
  it("rejects duplicate identities, extraneous part data, overfilled packs and excessive nesting", () => {
    const source = entry();
    expect(() => decodeLibraryPack(pack([source, source]))).toThrow(/duplicate/);
    expect(() => serializeLibraryPack([source, source])).toThrow(/duplicate/);
    expect(() => decodeLibraryPack(pack([{ ...source, extra: true }]))).toThrow(/invalid fields/);
    expect(() => decodeLibraryPack(pack(Array.from({ length: 51 }, () => source)))).toThrow(/more than 50/);
    expect(() => decodeLibraryPack("[".repeat(65) + "0" + "]".repeat(65))).toThrow(/nested too deeply/);
  });
  it("bounds the actual combined UTF-8 stored data after safe project parsing", () => {
    const source = entry(), doc = importProjectText(source.text);
    const large = { ...source, text: JSON.stringify({ ...doc, metadata: { note: "x".repeat(1024 * 1024) } }) };
    expect(() => decodeLibraryPack(pack(Array.from({ length: 25 }, (_, index) => ({ ...large, id: `large${index}` }))))).toThrow(/25 MiB/);
  });
  it("rejects excessive File sizes and cancellation before reading or opening storage", async () => {
    const text = vi.fn();
    await expect(importLibraryPackFile({ size: LIBRARY_PACK_MAX_BYTES + 1, text } as unknown as File)).rejects.toThrow(/too large/);
    expect(text).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(importLibraryPackFile({ size: 1, text } as unknown as File, controller.signal)).rejects.toThrow(/cancelled/);
    const open = vi.fn(); vi.stubGlobal("indexedDB", { open });
    await expect(importLibraryCopies([entry()], controller.signal)).rejects.toThrow(/cancelled/);
    expect(open).not.toHaveBeenCalled();
  });
  it("rejects cancellation after an asynchronous file read and invalid imports as promises", async () => {
    vi.stubGlobal("Worker", undefined);
    const controller = new AbortController();
    const text = vi.fn(async () => { controller.abort(); return pack([entry()]); });
    await expect(importLibraryPackFile({ size: 1, text } as unknown as File, controller.signal)).rejects.toThrow(/cancelled/);
    await expect(importLibraryCopies([{ ...entry(), text: "bad" }])).rejects.toThrow(/not valid JSON/);
    await expect(importLibraryCopies([entry(), { ...entry(), id: "duplicate" }, { ...entry(), id: "duplicate" }])).rejects.toThrow(/duplicate/);
  });
});
