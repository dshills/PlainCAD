import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import {
  SECURITY_HEADERS,
  staticHostHeaders,
  nginxSecurityHeaders,
} from "./deployment/securityHeaders";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { aiPlugin } from "./server/aiMiddleware";
import { liveSessionPlugin } from "./server/liveSessionMiddleware";
import { commandInstrumentation } from "./scripts/command-instrumentation";

// The ordinary unit suite exercises OpenCascade and fallback fixtures directly.
// PlainSolid has its own WASM contract suite.
const provider = process.env.VITEST === "true"
  ? "opencascade"
  : process.env.VITE_CAD_KERNEL ?? "plainsolid";
if (provider !== "opencascade" && provider !== "plainsolid") {
  throw new Error("VITE_CAD_KERNEL must be opencascade or plainsolid.");
}

function nativeKernel(): Plugin {
  const selected = fileURLToPath(new URL("./src/cad/kernel/PlainSolidKernel.ts", import.meta.url));
  return {
    name: "plaincad-native-kernel",
    enforce: "pre",
    resolveId(source) {
      if (provider === "plainsolid" && /(?:^|\/)NativeKernel$/.test(source)) return selected;
    },
  };
}

function plainSolidAssets(): Plugin {
  const check = fileURLToPath(new URL("./scripts/check-plainsolid-assets.mjs", import.meta.url));
  return {
    name: "plaincad-plainsolid-assets",
    buildStart() {
      execFileSync(process.execPath, [check], { stdio: "inherit" });
    },
    generateBundle() {
      for (const name of ["plainsolid-kernel.json", "plainsolid-NOTICE.txt"]) {
        this.emitFile({
          type: "asset",
          fileName: `kernel/${name}`,
          source: readFileSync(new URL(`./src/cad/kernel/${name}`, import.meta.url)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    nativeKernel(),
    ...(provider === "plainsolid" ? [plainSolidAssets()] : []),
    commandInstrumentation(),
    react(),
    aiPlugin(),
    liveSessionPlugin(),
    {
      name: "plaincad-deployment-headers",
      configurePreviewServer(server) {
        // Attach before static middleware, including conditional 304 and error responses.
        server.middlewares.use((_request, response, next) => {
          for (const [name, value] of Object.entries(SECURITY_HEADERS))
            response.setHeader(name, value);
          next();
        });
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "_headers",
          source: staticHostHeaders(),
        });
        this.emitFile({
          type: "asset",
          fileName: "nginx-security-headers.conf",
          source: nginxSecurityHeaders(),
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        // Keep module ownership predictable; avoid pulling renderer code into core.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const path = id.replaceAll("\\", "/");
          // Shared loader helpers must not import the application entry point.
          if (path.includes("commonjsHelpers.js") || path.includes("vite/preload-helper.js")) return "module-helpers";
          if (path.includes("/node_modules/three/build/three.core.js")) return "three-core";
          if (path.includes("/node_modules/three/")) return "three-renderer";
          if (/\/node_modules\/(react|react-dom|scheduler|zustand|use-sync-external-store)\//.test(path)) return "react-runtime";
          if (path.includes("/node_modules/opencascade.js/")) return "opencascade-loader";
          if (path.includes("/node_modules/@phosphor-icons/react/")) return "icons";
          // The core adapters are leaves; app command registration depends on
          // stores and file actions and must stay with the application entry.
          if (/\/src\/commands\/(registry|protocol|CommandHost|interactionEvents|inputDriver|nativeEvents|artifacts)\.tsx?$/.test(path)) return "command-runtime";
          if (/\/src\/commands\/(cadCommands|cadCommandOperations|commandSchemas)\.ts$/.test(path)) return "cad-command-model";
          if (/\/src\/commands\/(commandPlans|nativeCommandFaces)\.ts$/.test(path)) return "command-plan-runtime";
          if (path.endsWith("/src/commands/macros.ts")) return "macro-model";
          if (path.endsWith("/src/commands/liveSession.ts")) return "live-command-runtime";
          if (path.includes("/src/state/") || path.includes("/src/ui/themes/")) return "application-state";
          if (path.includes("/src/ai/") || path.includes("/src/templates/")) return "cad-recipes";
          // These persistence helpers are dependencies of CAD/worker modules.
          if (path.includes("/src/cad/") || /\/src\/persistence\/(importSafety|backgroundJob|projectCodec)\.ts$/.test(path)) return "cad";
        },
      },
    },
  },
  preview: { port: 5280, strictPort: true, headers: SECURITY_HEADERS },
  worker: {
    format: "es",
    plugins: () => [nativeKernel()],
  },
  server: {
    port: 5278,
    strictPort: true,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/tests/setup.ts",
    // Keep CPU contention from exhausting the production sketch solver's 50ms budget.
    maxWorkers: 2,
  },
});
