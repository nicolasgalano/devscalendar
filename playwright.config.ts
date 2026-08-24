import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  // Contra `next dev` cada ruta compila en frío la primera vez que se visita,
  // y eso puede tardar decenas de segundos. Los defaults de Playwright (30s por
  // test, 5s por assertion) dan falsos negativos en flujos multi-pantalla.
  //
  // El 15s se deja quieto a propósito: los flujos de escritura de `004` esperan
  // más, pero lo piden ellos (ver `AFTER_WRITE` en `bookings.spec.ts`). Subirlo
  // acá alargaría *toda* aserción que falla, y los tests largos —el de admin,
  // que recorre tres secciones— se quedarían sin presupuesto de test antes de
  // llegar al final.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
