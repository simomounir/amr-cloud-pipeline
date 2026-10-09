import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  // DuckDB-WASM's JS glue is ~600 kB (about 200 kB gzipped); the WASM itself loads from the CDN.
  build: { chunkSizeWarningLimit: 800 },
  test: { include: ["tests/**/*.test.{ts,tsx}"], testTimeout: 30_000 },
});
