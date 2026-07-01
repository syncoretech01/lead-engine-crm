import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests run against a real Postgres (see tests/integration/*.test.ts).
// They are isolated from the fast unit lane so the DB-free unit suite never
// depends on a database. Enabled only when SYNCORE_RUN_DB_INTEGRATION=1.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60000,
    // A single shared Postgres schema — do not parallelize across files.
    fileParallelism: false
  }
});
