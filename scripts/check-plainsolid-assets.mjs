import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const files = [
  ["wasmSha256", "src/cad/kernel/plainsolid-kernel.wasm"],
  ["runtimeSha256", "src/cad/kernel/wasm_exec.js"],
  ["noticeSha256", "src/cad/kernel/plainsolid-NOTICE.txt"],
];
try {
  const manifest = JSON.parse(await readFile(new URL("src/cad/kernel/plainsolid-kernel.json", root), "utf8"));
  const pin = JSON.parse(await readFile(new URL("scripts/plainsolid-pin.json", root), "utf8"));
  if (manifest.revision !== pin.revision || manifest.go !== pin.go)
    throw new Error("The installed kernel was built from a different PlainSolid revision or Go version.");
  for (const [field, path] of files) {
    const bytes = await readFile(new URL(path, root));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== manifest[field]) throw new Error(`Manifest hash mismatch for ${path}.`);
  }
} catch (error) {
  console.error(`${error.message} Run npm run kernel:plainsolid to install a matching WASM and Go runtime.`);
  process.exitCode = 1;
}
