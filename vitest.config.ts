import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(__dirname, "./src") };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      // Pure functions: no DOM, no database, no env. They have to keep running
      // without a local Supabase — that is the point of splitting the projects.
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      // Against the local Supabase: RLS, triggers and the query layer.
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      // Timing budgets. Outside `pnpm test` on purpose: the integration files
      // run in parallel against one local Postgres, and under that contention
      // the same query measured 372 ms instead of 69 ms. A timing assertion
      // competing with other tests measures the machine, not the product.
      // Run with `pnpm test:perf`, alone.
      {
        resolve: { alias },
        test: {
          name: "perf",
          environment: "node",
          include: ["tests/perf/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 90_000,
        },
      },
    ],
  },
});
