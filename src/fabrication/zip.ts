export interface ExportFile {
  filename: string;
  bytes: ArrayBuffer;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
/** Uncompressed ZIP, with deterministic names and timestamps; inputs are sanitized by the export planner. */
export function zipFiles(files: ExportFile[]): ArrayBuffer {
  const names = files.map((file) => new TextEncoder().encode(file.filename));
  const size = files.reduce(
    (n, file, i) =>
      n + 30 + names[i].length + file.bytes.byteLength + 46 + names[i].length,
    22,
  );
  if (
    files.length > 0xffff ||
    size > 0xffffffff ||
    names.some((name) => name.length > 0xffff)
  )
    throw new Error(
      "ZIP exceeds its file-count, filename, or byte-size limit.",
    );
  const output = new ArrayBuffer(size),
    view = new DataView(output),
    bytes = new Uint8Array(output);
  let offset = 0;
  const starts: number[] = [],
    checksums: number[] = [];
  const u16 = (at: number, n: number) => view.setUint16(at, n, true);
  const u32 = (at: number, n: number) => view.setUint32(at, n, true);
  for (const [i, file] of files.entries()) {
    starts.push(offset);
    const crc = crc32(new Uint8Array(file.bytes));
    checksums.push(crc);
    u32(offset, 0x04034b50);
    u16(offset + 4, 20);
    u16(offset + 6, 0x0800);
    u16(offset + 12, 33);
    u32(offset + 14, crc);
    u32(offset + 18, file.bytes.byteLength);
    u32(offset + 22, file.bytes.byteLength);
    u16(offset + 26, names[i].length);
    bytes.set(names[i], offset + 30);
    bytes.set(new Uint8Array(file.bytes), offset + 30 + names[i].length);
    offset += 30 + names[i].length + file.bytes.byteLength;
  }
  const central = offset;
  for (const [i, file] of files.entries()) {
    u32(offset, 0x02014b50);
    u16(offset + 4, 20);
    u16(offset + 6, 20);
    u16(offset + 8, 0x0800);
    u16(offset + 14, 33);
    u32(offset + 16, checksums[i]);
    u32(offset + 20, file.bytes.byteLength);
    u32(offset + 24, file.bytes.byteLength);
    u16(offset + 28, names[i].length);
    u32(offset + 42, starts[i]);
    bytes.set(names[i], offset + 46);
    offset += 46 + names[i].length;
  }
  u32(offset, 0x06054b50);
  u16(offset + 8, files.length);
  u16(offset + 10, files.length);
  u32(offset + 12, offset - central);
  u32(offset + 16, central);
  return output;
}
