const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export function safeFilename(
  name: string,
  extension: string,
  suffix = "",
): string {
  let base = "";
  for (const char of name.normalize("NFC")) {
    const code = char.charCodeAt(0);
    base +=
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      char === "." ||
      char === "-" ||
      char === "_"
        ? char
        : "_";
  }
  base = base.replace(/_+/g, "_").replace(/^[._]+|[._]+$/g, "") || "PlainCAD";
  if (RESERVED.test(base)) base = `_${base}`;
  return `${base.slice(0, 180 - extension.length - suffix.length).replace(/[. ]+$/g, "")}${suffix}${extension}`;
}
export function uniqueFilenames(names: string[], extension = ".stl"): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let n = 1,
      filename = safeFilename(name, extension);
    while (used.has(filename.toLowerCase()))
      filename = safeFilename(name, extension, `-${++n}`);
    used.add(filename.toLowerCase());
    return filename;
  });
}
