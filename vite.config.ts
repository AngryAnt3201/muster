import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// The hosted match server, if one is set (server.config.json; VITE_MUSTER_SERVER overrides). src/net/client.ts reads it.
let server = process.env.VITE_MUSTER_SERVER ?? "";
if (!server) { try { server = JSON.parse(readFileSync("server.config.json", "utf8")).url ?? ""; } catch { /* none set */ } }

export default defineConfig({
  base: "./",
  define: { "import.meta.env.VITE_MUSTER_SERVER": JSON.stringify(server) },
  build: { target: "es2020", outDir: "dist", assetsInlineLimit: 0 },
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 60000 },
} as any);
