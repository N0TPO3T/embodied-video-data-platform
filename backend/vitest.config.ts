import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup/database-safety.ts"],
    include: ["test/**/*.spec.ts", "test/**/*.e2e-spec.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    maxWorkers: 1,
  },
});
