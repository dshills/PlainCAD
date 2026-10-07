import { readdir, stat } from "node:fs/promises";
import { resolve, join, relative } from "node:path";

// Match Vite's default uncompressed JavaScript chunk warning threshold.
const limit = 500_000;
const directory = resolve(process.argv[2] ?? "dist/assets");

async function scriptsIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await scriptsIn(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

try {
  const files = await scriptsIn(directory);
  if (!files.length) throw new Error("No JavaScript bundles found; build the app first.");
  const sizes = await Promise.all(files.map(async (path) => ({
    name: relative(directory, path),
    bytes: (await stat(path)).size,
  })));
  sizes.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  const oversized = sizes.filter(({ bytes }) => bytes > limit);
  if (oversized.length) {
    throw new Error(`JavaScript bundles exceed the ${limit / 1000} kB budget:\n${oversized.map(({ name, bytes }) => `  ${name}: ${(bytes / 1000).toFixed(2)} kB`).join("\n")}`);
  }
  console.log(`JavaScript bundle budget passed (${sizes.length} bundles, largest ${(sizes[0].bytes / 1000).toFixed(2)} kB; limit ${limit / 1000} kB).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
