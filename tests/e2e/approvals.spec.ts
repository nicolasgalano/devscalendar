import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import {
  authenticate,
  createProjectFor,
  createUser,
  deleteProjectFixture,
  deleteUser,
  moveBooking,
  seedBooking,
  type TestUser,
} from "./session";
import { escapeForRegExp as rx, testName } from "../run-id";

/**
 * El flujo de aprobación de punta a punta: el desarrollador entra a su bandeja,
 * aprueba una reserva, rechaza otra con motivo, y el PM ve los dos estados en
 * el calendario. Más la carrera contra la edición del PM.
 *
 * Cada test trabaja sobre **su propia fecha**, en 2027 y lejos tanto del seed
 * como de `bookings.spec.ts` (que usa abril): `fullyParallel` está activo, así
 * que dos tests sobre el mismo día verían las reservas del otro.
 */
const APPROVE_DAY = "2027-05-12"; // miércoles laborable
const REJECT_DAY = "2027-05-19";
const RACE_DAY = "2027-05-26";

/** Mismo presupuesto que `bookings.spec.ts`, y por el mismo motivo: responder
 *  no termina con la respuesta de la API — después va un `router.refresh()` que
 *  vuelve a renderizar en el servidor. */
const AFTER_WRITE = { timeout: 45_000 };

const suffix = randomUUID().slice(0, 8);
const CLIENT_NAME = testName(`E2E aprob cliente ${suffix}`);
const PROJECT_NAME = testName(`E2E aprob proyecto ${suffix}`);

let pm: TestUser;
let dev: TestUser;
let fixture: { clientId: string; projectId: string };

/** `2027-05-12T09:00` en hora argentina (UTC-3) → 12:00Z. */
function at(day: string, hour: number): string {
  return `${day}T${String(hour + 3).padStart(2, "0")}:00:00.000Z`;
}

test.beforeAll(async () => {
  pm = await createUser("pm");
  dev = await createUser("developer");
  fixture = await createProjectFor(pm.userId, {
    client: CLIENT_NAME,
    project: PROJECT_NAME,
  });
});

test.afterAll(async () => {
  try {
    await deleteProjectFixture(fixture);
  } finally {
    await deleteUser(pm.userId);
    await deleteUser(dev.userId);
  }
});

/**
 * `next dev` compila cada route handler la primera vez que se lo invoca, y eso
 * se come la primera aserción del flujo (la lección de `004` T4.5). Va **con la
 * sesión del navegador**: el middleware corre también sobre `/api`, así que un
 * request anónimo se va por el redirect a `/login` y el handler nunca compila.
 * Con el body vacío corta en la validación y responde 400 sin tocar la base.
 */
async function warmUpResponseRoute(page: Page) {
  await page.request.patch("/api/bookings/00000000-0000-4000-8000-000000000000/response", {
    data: {},
  });
}

/** La fila de la bandeja de una reserva, ubicada por el nombre del proyecto. */
function inboxRow(page: Page, projectName: string) {
  return page.getByRole("row").filter({ hasText: new RegExp(rx(projectName)) });
}

/** El bloque del calendario, cuyo nombre accesible lleva el estado. */
function blockWithStatus(page: Page, status: string) {
  return page.getByRole("button", {
    name: new RegExp(`${rx(PROJECT_NAME)}.*${status}`),
  });
}

// AC-1.1, AC-2.1
test("a developer approves from the inbox and the PM sees it approved", async ({
  context,
  page,
}) => {
  await seedBooking({
    projectId: fixture.projectId,
    devId: dev.userId,
    startsAt: at(APPROVE_DAY, 9),
    endsAt: at(APPROVE_DAY, 13),
    status: "pending",
    note: "Migracion del checkout",
  });

  await authenticate(context, dev);
  await warmUpResponseRoute(page);
  await page.goto("/inbox");

  // AC-1.1: la reserva está en la bandeja, con su proyecto y su nota.
  const row = inboxRow(page, PROJECT_NAME);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Migracion del checkout");

  // AC-2.1: aprobar es un clic, sin diálogo.
  await row.getByRole("button", { name: "Aprobar" }).click();

  // Al aprobarse deja de estar pendiente, así que sale de la bandeja.
  await expect(inboxRow(page, PROJECT_NAME)).toHaveCount(0, AFTER_WRITE);

  // Y el PM la ve aprobada en el calendario.
  await authenticate(context, pm);
  await page.goto(`/calendar?view=day&date=${APPROVE_DAY}`);
  await expect(blockWithStatus(page, "Aprobada")).toBeVisible(AFTER_WRITE);
});

// AC-2.2
test("a developer rejects with a mandatory comment", async ({ context, page }) => {
  await seedBooking({
    projectId: fixture.projectId,
    devId: dev.userId,
    startsAt: at(REJECT_DAY, 9),
    endsAt: at(REJECT_DAY, 13),
    status: "pending",
  });

  await authenticate(context, dev);
  await warmUpResponseRoute(page);
  await page.goto("/inbox");

  await inboxRow(page, PROJECT_NAME).getByRole("button", { name: "Rechazar" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  /**
   * T4.4 y la misma decisión que `004` T3.1: el motivo obligatorio **se valida
   * al usar el botón, no deshabilitándolo**. Este intento en vacío es lo que
   * prueba esa diferencia — con un botón apagado no habría nada que clickear ni
   * mensaje que leer.
   */
  await dialog.getByRole("button", { name: "Rechazar reserva" }).click();
  await expect(dialog.getByText("Escribí el motivo del rechazo")).toBeVisible();
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Motivo").fill("Esa semana estoy con el release");
  await dialog.getByRole("button", { name: "Rechazar reserva" }).click();

  await expect(inboxRow(page, PROJECT_NAME)).toHaveCount(0, AFTER_WRITE);

  // El PM la ve rechazada, que es la señal que lo manda a reasignar (§8).
  await authenticate(context, pm);
  await page.goto(`/calendar?view=day&date=${REJECT_DAY}`);
  await expect(blockWithStatus(page, "Rechazada")).toBeVisible(AFTER_WRITE);
});

/**
 * R-2 / F1 de `004` — la carrera entre la edición y la aprobación.
 *
 * El dev abre la bandeja y ve un horario. El PM lo mueve mientras decide, y la
 * reserva sigue pendiente y con el mismo aspecto. Si aprobara ahí, se estaría
 * comprometiendo a un horario que nunca vio: la respuesta tiene que rebotar.
 */
test("a stale approval is refused instead of committing the developer", async ({
  context,
  page,
}) => {
  const bookingId = await seedBooking({
    projectId: fixture.projectId,
    devId: dev.userId,
    startsAt: at(RACE_DAY, 9),
    endsAt: at(RACE_DAY, 13),
    status: "pending",
  });

  await authenticate(context, dev);
  await warmUpResponseRoute(page);
  await page.goto("/inbox");
  await expect(inboxRow(page, PROJECT_NAME)).toBeVisible();

  // El PM la mueve por debajo: la página del dev ya tiene el `updated_at` viejo.
  await moveBooking(bookingId, {
    startsAt: at(RACE_DAY, 15),
    endsAt: at(RACE_DAY, 19),
  });

  await inboxRow(page, PROJECT_NAME).getByRole("button", { name: "Aprobar" }).click();

  // T4.6: el motivo en palabras, no un error genérico.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible(AFTER_WRITE);
  await expect(dialog).toContainText("La reserva cambió");
  await dialog.getByRole("button", { name: "Entendido" }).click();

  // Y lo que importa: sigue pendiente, con el horario nuevo a la vista.
  await expect(inboxRow(page, PROJECT_NAME)).toBeVisible(AFTER_WRITE);
  await expect(inboxRow(page, PROJECT_NAME)).toContainText("15:00–19:00");
});

// T4.1: la bandeja es del desarrollador. Esconder el link no alcanza — el guard
// tiene que sostener una navegación a mano.
test("a PM has no inbox, by link or by URL", async ({ context, page }) => {
  await authenticate(context, pm);

  await page.goto("/calendar");
  await expect(page.getByRole("link", { name: "Pendientes" })).toHaveCount(0);

  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/calendar/);
});
