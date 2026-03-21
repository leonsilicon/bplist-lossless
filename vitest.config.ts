// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,

    // Nice for one heavy fuzz file
    pool: "threads",
    isolate: false,
    fileParallelism: false,
  },
});
