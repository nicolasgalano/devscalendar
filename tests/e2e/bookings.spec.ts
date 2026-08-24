import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticate,
  createProjectFor,
  createUser,
  deleteProjectFixture,
  deleteUser,
  seedBooking,
  type TestUser,
} from "./session";

/**
 * El camino de escritura, de punta a punta: alta desde la grilla, edición,
 * cancelación y el conflicto.
 *
 * Cada test trabaja sobre **su propia fecha**, en 2027 y lejos de las fixtures
 * del seed: `fullyParallel` está activo, así que dos tests sobre el mismo día
 * verían las reservas del otro.
 */
const CREATE_DAY = "2027-04-14"; // miércoles laborable
const CONFLICT_DAY = "2027-04-21";
const SATURDAY = "2027-04-24";

/**
 * Presupuesto para las aserciones que esperan un guardado.
 *
 * Guardar no termina cuando responde la API: después va un `router.refresh()`
 * que vuelve a renderizar el calendario **en el servidor**. Medido acá, el
 * mismo POST tardó 421 ms con el stack sano y 14.3 s con Docker ahogado, y el
 * trace confirmaba 201 y 200 — fallaba la espera, no el producto. Va sobre las
 * aserciones que lo necesitan y no en `playwright.config.ts`, para no alargar
 * cada fallo del resto de la suite.
 */
const AFTER_WRITE = { timeout: 45_000 };

const suffix = randomUUID().slice(0, 8);
const CLIENT_NAME = `E2E cliente ${suffix}`;
const PROJECT_NAME = `E2E proyecto ${suffix}`;

let pm: TestUser;
let dev: TestUser;
let fixture: { clientId: string; projectId: string };

test.beforeAll(async () => {
  pm = await createUser("pm");
  dev = await createUser("developer");
  fixture = await createProjectFor(pm.userId, {
    client: CLIENT_NAME,
    project: PROJECT_NAME,
  });

});

/**
 * `next dev` compila cada route handler la primera vez que se lo invoca, y acá
 * eso medía **entre 7 y 10 segundos** que se comía la primera aserción del
 * flujo: el POST volvía en 14.7s contra un `expect` de 15s y el test fallaba por
 * el compilador, no por el producto.
 *
 * Va **con la sesión del navegador**, no con un `fetch` suelto: el middleware
 * corre también sobre `/api` (ver su `matcher`), así que un request anónimo se
 * va por el redirect a `/login` y el handler nunca llega a compilarse. Con el
 * body vacío los dos cortan en la validación y responden 400 sin tocar la base.
 */
async function warmUpApiRoutes(page: Page) {
  await Promise.all([
    page.request.post("/api/bookings", { data: {} }),
    page.request.patch("/api/bookings/00000000-0000-4000-8000-000000000000", {
      data: {},
    }),
  ]);
}

test.afterAll(async () => {
  try {
    await deleteProjectFixture(fixture);
  } finally {
    await deleteUser(pm.userId);
    await deleteUser(dev.userId);
  }
});

test.beforeEach(async ({ context, page }) => {
  await authenticate(context, pm);
  await warmUpApiRoutes(page);
});

/**
 * Todo se busca **dentro del diálogo**, nunca en la página: la barra de filtros
 * tiene sus propios selects de proyecto y desarrollador, y un locator global
 * los confunde con los del formulario. La lista de opciones sí es global, porque
 * Base UI la monta en un portal fuera del diálogo.
 */
async function choose(page: Page, dialog: Locator, label: string, option: string) {
  await dialog.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option }).click();
}

async function fillTimes(dialog: Locator, from: string, to: string) {
  await dialog.getByLabel("Desde").fill(from);
  await dialog.getByLabel("Hasta").fill(to);
}

/**
 * La acción primaria de la vista. `exact` importa: la capa clickeable de cada
 * carril se anuncia como "Crear reserva en <carril>", y sin él el locator
 * encuentra dos botones.
 */
function primaryCreate(page: Page) {
  return page.getByRole("button", { name: "Crear reserva", exact: true });
}

// AC-1.1, AC-2.1, AC-3.1
test("a PM creates, edits and cancels a booking", async ({ page }) => {
  await page.goto(`/calendar?view=day&date=${CREATE_DAY}`);

  // El empty state ya tiene su verbo: es la deuda F2 de 003.
  await expect(page.getByText("Sin reservas en este período")).toBeVisible();
  await primaryCreate(page).click();

  const dialog = page.getByRole("dialog", { name: "Nueva reserva" });
  await expect(dialog).toBeVisible();
  await choose(page, dialog, "Proyecto", PROJECT_NAME);
  await choose(page, dialog, "Desarrollador", dev.fullName);
  await fillTimes(dialog, "10:00", "13:00");
  await dialog.getByRole("button", { name: "Crear reserva" }).click();

  // AC-1.1: nace pendiente, y el bloque lo dice.
  const block = page.getByRole("button", {
    name: new RegExp(`${dev.fullName}.*${PROJECT_NAME}.*10:00–13:00.*Pendiente`),
  });
  await expect(block).toBeVisible(AFTER_WRITE);

  // ── Edición ───────────────────────────────────────────────────────────────
  await block.click();
  await page.getByRole("button", { name: "Editar" }).click();

  const editDialog = page.getByRole("dialog", { name: "Editar reserva" });
  await expect(editDialog).toBeVisible();
  // El proyecto no se mueve: el PATCH no lo acepta y el campo lo refleja.
  await expect(editDialog.getByLabel("Proyecto", { exact: true })).toBeDisabled();
  await fillTimes(editDialog, "10:00", "12:00");
  await editDialog.getByRole("button", { name: "Guardar cambios" }).click();

  const edited = page.getByRole("button", {
    name: new RegExp(`${dev.fullName}.*${PROJECT_NAME}.*10:00–12:00`),
  });
  await expect(edited).toBeVisible(AFTER_WRITE);

  // ── Cancelación ───────────────────────────────────────────────────────────
  await edited.click();
  await page.getByRole("button", { name: "Cancelar reserva" }).click();

  const confirm = page.getByRole("dialog", { name: "Cancelar la reserva" });
  await expect(confirm).toContainText("no se borra");
  await confirm.getByRole("button", { name: "Cancelar reserva" }).click();

  // Cancelada sale de la vista por defecto, pero sigue existiendo: vuelve con
  // el filtro de estado.
  await expect(page.getByText("Sin reservas en este período")).toBeVisible(AFTER_WRITE);
  await page.goto(`/calendar?view=day&date=${CREATE_DAY}&status=cancelled`);
  await expect(page.getByRole("button", { name: /Cancelada/ })).toBeVisible();
});

// T3.3
test("clicking an empty slot prefills the lane and the time", async ({ page }) => {
  await seedBooking({
    projectId: fixture.projectId,
    devId: dev.userId,
    // 09:00–10:00 hora local (UTC-3), para que exista el carril del dev.
    startsAt: `${CONFLICT_DAY}T12:00:00.000Z`,
    endsAt: `${CONFLICT_DAY}T13:00:00.000Z`,
    status: "pending",
  });

  await page.goto(`/calendar?view=day&date=${CONFLICT_DAY}`);

  // La capa de alta cubre el carril; se clickea una franja libre de la tarde.
  const slots = page.locator(`[data-lane-slots="${dev.userId}"]`);
  const box = (await slots.boundingBox())!;
  // Franja de 30 min = 24px, y la ventana arranca a las 09:00: 8 franjas abajo
  // es 13:00.
  await slots.click({ position: { x: box.width / 2, y: 8 * 24 + 12 } });

  const dialog = page.getByRole("dialog", { name: "Nueva reserva" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Desde")).toHaveValue("13:00");
  await expect(dialog.getByLabel("Hasta")).toHaveValue("14:00");
  // El carril precarga al desarrollador; el proyecto lo elige el PM.
  await expect(dialog.getByLabel("Desarrollador", { exact: true })).toContainText(
    dev.fullName,
  );
});

// AC-1.2
test("refuses a booking that overlaps an approved one, and names it", async ({ page }) => {
  const day = "2027-04-28";
  await seedBooking({
    projectId: fixture.projectId,
    devId: dev.userId,
    startsAt: `${day}T12:00:00.000Z`, // 09:00 local
    endsAt: `${day}T16:00:00.000Z`, // 13:00 local
    status: "approved",
  });

  await page.goto(`/calendar?view=day&date=${day}`);
  await primaryCreate(page).click();

  const dialog = page.getByRole("dialog", { name: "Nueva reserva" });
  await choose(page, dialog, "Proyecto", PROJECT_NAME);
  await choose(page, dialog, "Desarrollador", dev.fullName);
  await fillTimes(dialog, "12:00", "14:00");
  await dialog.getByRole("button", { name: "Crear reserva" }).click();

  // DESIGN.md §8: el motivo en palabras, con la reserva que bloquea, no solo el
  // color ni un "hay un conflicto" que obligue a buscarla a mano.
  const conflict = page.locator('[data-slot="booking-conflict"]');
  await expect(conflict).toContainText(`${dev.fullName} ya tiene una reserva aprobada`);
  await expect(conflict).toContainText(PROJECT_NAME);
  await expect(conflict).toContainText("09:00–13:00");
  await expect(conflict.getByRole("link", { name: /Ver ese día/ })).toBeVisible();

  // El diálogo sigue abierto con los datos cargados: el PM corrige el horario,
  // no vuelve a empezar.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Desde")).toHaveValue("12:00");
});

// AC-1.4, Q-G
test("warns about a Saturday and about hours, without blocking the save", async ({ page }) => {
  await page.goto(`/calendar?view=day&date=${SATURDAY}`);
  await primaryCreate(page).click();

  const dialog = page.getByRole("dialog", { name: "Nueva reserva" });
  await choose(page, dialog, "Proyecto", PROJECT_NAME);
  await choose(page, dialog, "Desarrollador", dev.fullName);
  await fillTimes(dialog, "19:00", "21:00");

  await expect(dialog.locator('[data-warning="non-workday"]')).toContainText("Sábado");
  await expect(dialog.locator('[data-warning="outside-hours"]')).toContainText(
    "Fuera del horario habitual",
  );

  // Lo importante: advertir no es bloquear.
  const save = dialog.getByRole("button", { name: "Crear reserva" });
  await expect(save).toBeEnabled();
  await save.click();

  await expect(
    page.getByRole("button", {
      name: new RegExp(`${dev.fullName}.*${PROJECT_NAME}.*19:00–21:00`),
    }),
  ).toBeVisible(AFTER_WRITE);
});

test("a developer gets no write actions at all", async ({ page, context }) => {
  await context.clearCookies();
  await authenticate(context, dev);

  await page.goto(`/calendar?view=day&date=${CREATE_DAY}`);

  await expect(page.getByRole("heading", { name: "Calendario" })).toBeVisible();
  await expect(primaryCreate(page)).toHaveCount(0);
  await expect(page.locator("[data-lane-slots]")).toHaveCount(0);
});
