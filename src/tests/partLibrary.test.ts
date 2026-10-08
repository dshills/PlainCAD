import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoxTemplate } from "../templates/templates";
import { createEmptyDocument } from "../cad/document/CadDocument";
import { serializeProject } from "../persistence/exportProject";
import { importProjectText } from "../persistence/projectCodec";
import { rebuildDocument } from "../cad/features/rebuildGraph";
import { withComponentPlacement } from "../cad/document/componentPlacement";
import { assertLibraryBudget, createLibraryEntry, decodeLibraryEntry, extractLibraryComponent, listLibraryParts, PART_LIBRARY_LIMITS, partLibraryName, readPartLibraryDragId, saveLibraryPart, validateLibraryThumbnail } from "../persistence/partLibrary";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWv4sAAAAASUVORK5CYII=";
afterEach(() => vi.unstubAllGlobals());
describe("bounded local reusable-part data", () => {
  it("extracts independent editable geometry, discards empty root/cameras/metadata and retains authored units and placement", () => {
    const original = createBoxTemplate();
    const source = withComponentPlacement({ ...original, metadata: { private: true }, viewState: { cameraPosition: [4, 5, 6] } }, original.rootComponentId, { translation: [10, 20, 0], rotation: [0, 0, 0.2] });
    const before = serializeProject(source);
    const copied = extractLibraryComponent(source, source.rootComponentId, "  Library block  ");
    expect(copied.name).toBe("Library block");
    expect(Object.keys(copied.components)).toEqual([copied.rootComponentId]);
    expect(copied.components[copied.rootComponentId].placement).toEqual(source.components[source.rootComponentId].placement);
    expect(copied.id).not.toBe(source.id);
    expect(copied.features[0].id).not.toBe(source.features[0].id);
    expect(copied.viewState).toBeUndefined(); expect(copied.metadata).toBeUndefined();
    expect(serializeProject(source)).toBe(before);
    const entry = createLibraryEntry(source, source.rootComponentId, "Block", png);
    expect(decodeLibraryEntry(entry)).toEqual(entry);
    expect(importProjectText(entry.text).parameters.width.expression).toBe(source.parameters.width.expression);
  });
  it("roundtrips self-contained parameters and real authored profile geometry", () => {
    const source = createBoxTemplate(), copied = extractLibraryComponent(source, source.rootComponentId, "Block");
    const rebuilt = rebuildDocument(importProjectText(serializeProject(copied)));
    expect(rebuilt.success).toBe(true); expect(rebuilt.meshes).toHaveLength(1);
    expect(rebuilt.meshes[0].bounds).toEqual(rebuildDocument(source).meshes[0].bounds);
    const feature = copied.features[0];
    expect(feature).toMatchObject({ type: "extrude", distance: { expression: "depth", parameterRefs: { depth: copied.parameters.depth.id } } });
  });
  it("rejects a selected component with geometry references outside its scope", () => {
    const source = createBoxTemplate();
    source.components.child = { id: "child", name: "Dependent child" };
    source.sketches.childSketch = { id: "childSketch", name: "Dependent drawing", componentId: "child", timelineStep: 3, plane: { type: "face", featureId: source.features[0].id, stableFaceId: `extrude:${source.features[0].id}:endCap` }, entities: {}, constraints: [], dimensions: [] };
    expect(() => extractLibraryComponent(source, "child", "Child")).toThrow(/outside the selected component/);
  });
  it("rejects empty components and source IDs lost since selection", () => {
    const source = createEmptyDocument();
    expect(() => extractLibraryComponent(source, source.rootComponentId, "Empty")).toThrow(/no sketches or features/);
    expect(() => extractLibraryComponent(source, "missing", "Empty")).toThrow(/no longer exists/);
  });
  it("treats saved JSON as untrusted and rejects damaged entry metadata", () => {
    const source = createBoxTemplate(), entry = createLibraryEntry(source, source.rootComponentId, "Block", png);
    expect(() => decodeLibraryEntry({ ...entry, text: '{"__proto__": {}}' })).toThrow(/unsafe key/);
    expect(() => decodeLibraryEntry({ ...entry, id: "../../part" })).toThrow(/metadata/);
    expect(() => decodeLibraryEntry({ ...entry, savedAt: NaN })).toThrow(/metadata/);
    expect(() => decodeLibraryEntry({ ...entry, name: " Block " })).toThrow(/metadata/);
    const multiple = { ...source, components: { ...source.components, another: { id: "another", name: "Another" } } };
    expect(() => decodeLibraryEntry({ ...entry, text: serializeProject(multiple) })).toThrow(/one self-contained component/);
  });
  it("bounds names and drag identifiers before reading external drop data", () => {
    expect(partLibraryName("  Gear hub  ")).toBe("Gear hub");
    expect(() => partLibraryName(" ")).toThrow(/1–120/);
    expect(() => partLibraryName("x".repeat(121))).toThrow(/1–120/);
    expect(readPartLibraryDragId("library_123:4")).toBe("library_123:4");
    expect(readPartLibraryDragId("x".repeat(161))).toBeUndefined();
    expect(readPartLibraryDragId('{"text":"evil"}')).toBeUndefined();
  });
  it("requires bounded PNG thumbnails and refuses oversized dimensions and text", () => {
    expect(() => validateLibraryThumbnail(png)).not.toThrow();
    expect(() => validateLibraryThumbnail("data:image/svg+xml,<svg/>")).toThrow(/bounded PNG/);
    expect(() => validateLibraryThumbnail("data:image/png;base64,AAAA")).toThrow(/header/);
    expect(() => validateLibraryThumbnail("data:image/png;base64," + "A".repeat(400000))).toThrow(/bounded PNG/);
    const bytes = atob(png.slice(22));
    const oversized = bytes.slice(0, 16) + String.fromCharCode(0, 0, 1, 1) + bytes.slice(20);
    expect(() => validateLibraryThumbnail("data:image/png;base64," + btoa(oversized))).toThrow(/dimensions/);
  });
  it("enforces both entry count and combined UTF-8 text budgets", () => {
    const source = createBoxTemplate(), entry = createLibraryEntry(source, source.rootComponentId, "Block", png);
    expect(() => assertLibraryBudget(Array.from({ length: PART_LIBRARY_LIMITS.entries + 1 }, (_, index) => ({ ...entry, id: `entry${index}` })))).toThrow(/50 parts/);
    expect(() => assertLibraryBudget([{ ...entry, text: "€".repeat(Math.ceil(PART_LIBRARY_LIMITS.totalBytes / 3)) }])).toThrow(/25 MiB/);
  });
  it("reports unavailable or quota-limited storage and cancels before opening it", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(listLibraryParts()).rejects.toThrow(/unavailable/);
    const open = vi.fn(() => { throw new DOMException("No quota", "QuotaExceededError"); });
    vi.stubGlobal("indexedDB", { open });
    await expect(listLibraryParts()).rejects.toThrow(/Browser storage is full/);
    const controller = new AbortController(); controller.abort();
    await expect(listLibraryParts(controller.signal)).rejects.toThrow(/cancelled/);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("reports invalid saves as rejected promises rather than synchronous exceptions", async () => {
    const source = createBoxTemplate(), entry = createLibraryEntry(source, source.rootComponentId, "Block", png);
    const operation = saveLibraryPart({ ...entry, text: '{"__proto__":{}}' });
    expect(operation).toBeInstanceOf(Promise);
    await expect(operation).rejects.toThrow(/unsafe key/);
  });
});
