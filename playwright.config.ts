import { defineConfig, devices } from "@playwright/test";

import { loadTestEnv } from "./tests/env";

/**
 * Credenciales del stack efímero de Supabase. Se cargan acá arriba a propósito:
 * si faltan —o si apuntan a un proyecto alojado— la corrida falla al
 * configurarse y no a mitad de un test.
 */
const testEnv = loadTestEnv();

/**
 * Puerto propio, distinto del 3000 de desarrollo.
 *
 * El server que levanta Playwright apunta al **stack efímero**, y las fixtures
 * de `tests/e2e/session.ts` escriben en esa misma base. Si los E2E reusaran el
 * `pnpm dev` de todos los días, el navegador estaría leyendo del proyecto remoto
 * mientras las fixtures crean usuarios en el efímero: los tests fallarían por
 * datos que no aparecen, y el motivo real sería invisible.
 */
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  // Un `test.only` olvidado hace pasar la suite entera corriendo un solo test.
  // En local es cómodo; en CI es un falso verde.
  forbidOnly: !!process.env.CI,
  // Sin reintentos, también en CI: esta suite ya nos hizo perder tiempo con
  // fallos de entorno disfrazados de bugs, y al revés también vale — un retry
  // que "arregla" un test tapa exactamente la clase de problema que hay que ver.
  retries: 0,
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
    baseURL,
  },
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: baseURL,
    // Las variables ya presentes en el entorno le ganan a `.env.local` en Next
    // (verificado contra `@next/env`), así que esto alcanza para apuntar el
    // server al stack efímero sin tocar ningún archivo — incluso si en la
    // máquina existe un `.env.local` con el proyecto remoto.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: testEnv.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: testEnv.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: testEnv.serviceRoleKey,
    },
    // En local se reusa entre corridas: levantarlo cuesta ~25s y esta máquina
    // lo siente. Si alguna vez levantás algo a mano en el 3100, los E2E lo van
    // a adoptar tal como esté. En CI nunca: cada corrida arranca el suyo.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
