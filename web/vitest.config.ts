import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    exclude: ["tests/**", "node_modules/**"],
    // PBKDF2 uses the production-strength 600k iteration count in tests.
    testTimeout: 20_000,
  },
});
