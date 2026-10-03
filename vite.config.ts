import {
  SECURITY_HEADERS,
  staticHostHeaders,
  nginxSecurityHeaders,
} from "./deployment/securityHeaders";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
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
