/**
 * Vitest rather than Jest: it shares Vite's transform pipeline, so there is no
 * second module-resolution config to keep in sync with tsconfig, and the watch
 * loop is fast enough that people actually leave it running.
 */
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    // Threads rather than the default forked processes: on Windows the fork pool
    // regularly fails to hand back a worker and the run dies with "Timeout
    // waiting for worker to respond". Threads are also faster here because the
    // suite is CPU-light and startup-dominated.
    pool: "threads",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // The pieces where a mistake is invisible in review: error parsing,
      // formatting of legal values, and the API client's CSRF wiring.
      include: ["src/lib/**", "src/components/**", "src/providers/**"],
      exclude: ["**/*.d.ts", "**/*.test.*"],
    },
  },
});
