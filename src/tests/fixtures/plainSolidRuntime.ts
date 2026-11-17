import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Explicit test-only initialization; never changes the default/fallback suite. */
export async function initializePlainSolidRuntime() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (!String(input).endsWith("/plainsolid-kernel.wasm")) return originalFetch(input, init);
    const bytes = await readFile(join(process.cwd(), "src/cad/kernel/plainsolid-kernel.wasm"));
    return new Response(bytes, { headers: { "Content-Type": "application/wasm" } });
  };
  try {
    const { PlainSolidKernel } = await import("../../cad/kernel/PlainSolidKernel");
    await PlainSolidKernel.initialize();
    return PlainSolidKernel;
  } finally {
    globalThis.fetch = originalFetch;
  }
}
