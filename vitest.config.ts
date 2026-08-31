import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(__dirname, "./src") };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      // Pure functions: no DOM, no database, no env. They have to keep running
      // without any Supabase at all — that is the point of splitting the projects,
      // and why they are the only level that runs on the dev machine.
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      // Against the ephemeral stack that lives and dies inside the CI job — not
      // against any hosted project, and `tests/env.ts` refuses a non-local URL:
      // RLS, triggers and the query layer.
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
      // Smoke: lo que solo PostgREST y GoTrue pueden confirmar (embeds, `!inner`,
      // filtros sobre columnas embebidas, login con contraseña). Proyecto propio
      // para poder correrlo suelto y para que se lea, en el workflow, como un
      // nivel distinto del de integración.
      {
        resolve: { alias },
        test: {
          name: "smoke",
          environment: "node",
          include: ["tests/smoke/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      // Timing budgets. Outside `pnpm test` on purpose: the integration files
      // run in parallel against one Postgres, and under that contention
      // the same query measured 372 ms instead of 69 ms. A timing assertion
      // competing with other tests measures the machine, not the product.
      // Run with `pnpm test:perf`, alone. Los números se calibraron contra Postgres
      // local; contra la nube miden latencia de red y hay que recalibrarlos.
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
