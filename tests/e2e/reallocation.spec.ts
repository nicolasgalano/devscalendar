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
import { escapeForRegExp as rx, testName } from "../run-id";

/**
 * `006` de punta a punta: el PM de un proyecto prioritario le saca la franja a
 * uno común, y el PM desplazado se entera.
 *
 * **La segunda mitad es la que importa.** Que el desplazamiento funcione lo
 * prueban los tests de integración contra la función; lo que solo se puede ver
 * acá es si al PM desplazado le llega la noticia por algún lado. Con las
 * notificaciones diferidas a `010`, el calendario es ese único lado — y por eso
 * el `goto` final va **sin ningún filtro en la URL**. Si `displaced` se cayera
 * de `DEFAULT_STATUSES`, este test se rompe, que es exactamente lo que le pasó
 * a `rejected` en `005` (F7).
 *
 * Cada test sobre su propia fecha, en junio de 2027 y lejos del seed y de los
 * otros specs: `fullyParallel` está activo.
 */
const DISPLACE_DAY = "2027-06-09"; // miércoles laborable
const BLOCKED_DAY = "2027-06-16";

/** Mismo presupuesto que `bookings.spec.ts` y `approvals.spec.ts`. */
const AFTER_WRITE = { timeout: 45_000 };

const suffix = randomUUID().slice(0, 8);
const HIGH_PROJECT = testName(`E2E realoc prioritario ${suffix}`);
const COMMON_PROJECT = testName(`E2E realoc comun ${suffix}`);

let pmHigh: TestUser;
let pmCommon: TestUser;
let dev: TestUser;
let highFixture: { clientId: string; projectId: string };
let commonFixture: { clientId: string; projectId: string };

/** `2027-06-09T09:00` en hora argentina (UTC-3) → 12:00Z. */
function at(day: string, hour: number): string {
  return `${day}T${String(hour + 3).padStart(2, "0")}:00:00.000Z`;
}

test.beforeAll(async () => {
  pmHigh = await createUser("pm");
  pmCommon = await createUser("pm");
  dev = await createUser("developer");

  highFixture = await createProjectFor(pmHigh.userId, {
    client: testName(`E2E realoc cliente A ${suffix}`),
    project: HIGH_PROJECT,
    priority: "high",
  });
  commonFixture = await createProjectFor(pmCommon.userId, {
    client: testName(`E2E realoc cliente B ${suffix}`),
    project: COMMON_PROJECT,
    priority: "normal",
  });
});

test.afterAll(async () => {
  try {
    await deleteProjectFixture(highFixture);
    await deleteProjectFixture(commonFixture);
  } finally {
    await deleteUser(pmHigh.userId);
    await deleteUser(pmCommon.userId);
    await deleteUser(dev.userId);
  }
});

/**
 * `next dev` compila cada route handler la primera vez que se lo invoca, y eso
 * se come la primera aserción del flujo (la lección de `004` T4.5). Va con la
 * sesión del navegador, porque el middleware corre también sobre `/api`. El
 * body vacío corta en la validación y responde 400 sin tocar la base.
 */
async function warmUpReallocateRoute(page: Page) {
  await page.request.post("/api/bookings/reallocate", { data: {} });
}

async function choose(page: Page, dialog: Locator, label: string, option: string) {
  await dialog.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option }).click();
}

function primaryCreate(page: Page) {
  return page.getByRole("button", { name: "Crear reserva", exact: true });
}

function blockWithStatus(page: Page, projectName: string, status: string) {
  return page.getByRole("button", {
    name: new RegExp(`${rx(projectName)}.*${status}`),
  });
}

// AC-1.1, AC-2.2, AC-3.1
test("a priority project displaces a common booking and the displaced PM sees it", async ({
  context,
  page,
}) => {
  await seedBooking({
    projectId: commonFixture.projectId,
    devId: dev.userId,
    startsAt: at(DISPLACE_DAY, 9),
    endsAt: at(DISPLACE_DAY, 13),
    status: "approved",
  });

  await authenticate(context, pmHigh);
  await warmUpReallocateRoute(page);
  await page.goto(`/calendar?view=day&date=${DISPLACE_DAY}`);

  await primaryCreate(page).click();
  const dialog = page.getByRole("dialog", { name: "Nueva reserva" });
  await choose(page, dialog, "Proyecto", HIGH_PROJECT);
  await choose(page, dialog, "Desarrollador", dev.fullName);
  await dialog.getByLabel("Desde").fill("10:00");
  await dialog.getByLabel("Hasta").fill("12:00");
  await dialog.getByRole("button", { name: "Crear reserva" }).click();

  /**
   * T4.1: el conflicto que se puede desplazar **no se pinta como el que impide
   * seguir**. El `data-tone` es lo que se afirma y no el color: un test que
   * mirara clases de Tailwind se rompería con cualquier refactor de estilos sin
   * que hubiera cambiado nada de lo que el PM ve.
   */
  const conflict = page.locator('[data-slot="booking-conflict"]');
  await expect(conflict).toHaveAttribute("data-tone", "displaceable", AFTER_WRITE);
  await expect(conflict).toContainText(COMMON_PROJECT);

  await conflict.getByRole("button", { name: "Desplazar y reservar" }).click();

  // T4.2: la confirmación nombra a quién le está pasando por encima, y dice lo
  // que nadie diría solo — que esto no se deshace.
  const confirm = page.getByRole("dialog", { name: "Desplazar la reserva de otro proyecto" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(COMMON_PROJECT);
  await expect(confirm).toContainText(pmCommon.fullName);
  await expect(confirm).toContainText("no se restaura sola");

  await confirm.getByRole("button", { name: "Desplazar y reservar" }).click();

  // AC-3.1: la nueva nace pendiente. Desplazar decide de quién es la franja,
  // no que el desarrollador ya haya aceptado darla.
  await expect(blockWithStatus(page, HIGH_PROJECT, "Pendiente")).toBeVisible(AFTER_WRITE);

  /**
   * AC-2.2, y la parte que justifica este test: **el PM desplazado la ve sin
   * tocar ningún filtro.** La URL va pelada a propósito. Hasta que exista `010`
   * esta es la única forma que tiene de enterarse de que le sacaron una reserva
   * que ya estaba confirmada.
   */
  await authenticate(context, pmCommon);
  await page.goto(`/calendar?view=day&date=${DISPLACE_DAY}`);
  await expect(blockWithStatus(page, COMMON_PROJECT, "Desplazada")).toBeVisible(AFTER_WRITE);
});

// AC-1.2
test("a common project is refused, with no way to displace", async ({ context, page }) => {
  await seedBooking({
    projectId: highFixture.projectId,
    devId: dev.userId,
    startsAt: at(BLOCKED_DAY, 9),
    endsAt: at(BLOCKED_DAY, 13),
    status: "approved",
  });

  await authenticate(context, pmCommon);
  await page.goto(`/calendar?view=day&date=${BLOCKED_DAY}`);

  await primaryCreate(page).click();
  const dialog = page.getByRole("dialog", { name: "Nueva reserva" });
  await choose(page, dialog, "Proyecto", COMMON_PROJECT);
  await choose(page, dialog, "Desarrollador", dev.fullName);
  await dialog.getByLabel("Desde").fill("10:00");
  await dialog.getByLabel("Hasta").fill("12:00");
  await dialog.getByRole("button", { name: "Crear reserva" }).click();

  // El mismo conflicto de siempre, con el tratamiento de siempre: acá no hay
  // salida, y ofrecer un botón que va a fallar sería peor que no ofrecerlo.
  const conflict = page.locator('[data-slot="booking-conflict"]');
  await expect(conflict).toHaveAttribute("data-tone", "blocking", AFTER_WRITE);
  await expect(conflict.getByRole("button", { name: "Desplazar y reservar" })).toHaveCount(0);

  // Y la reserva no se creó: el diálogo sigue abierto con los datos cargados.
  await expect(dialog).toBeVisible();
});
