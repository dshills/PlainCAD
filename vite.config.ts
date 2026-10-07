import {
  SECURITY_HEADERS,
  staticHostHeaders,
  nginxSecurityHeaders,
} from "./deployment/securityHeaders";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { aiPlugin } from "./server/aiMiddleware";

export default defineConfig({
  plugins: [
    react(),
    aiPlugin(),
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
          // Shared CommonJS glue must not import the application entry point.
          if (path.includes("commonjsHelpers.js")) return "module-helpers";
          if (path.includes("/node_modules/three/build/three.core.js")) return "three-core";
          if (path.includes("/node_modules/three/")) return "three-renderer";
          if (/\/node_modules\/(react|react-dom|scheduler|zustand|use-sync-external-store)\//.test(path)) return "react-runtime";
          if (path.includes("/node_modules/opencascade.js/")) return "opencascade-loader";
          // These persistence helpers are dependencies of CAD/worker modules.
          if (path.includes("/src/cad/") || /\/src\/persistence\/(importSafety|backgroundJob)\.ts$/.test(path)) return "cad";
        },
      },
    },
  },
  preview: { port: 5280, strictPort: true, headers: SECURITY_HEADERS },
  worker: {
    format: "es",
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
