import { expect, test, type Page } from "@playwright/test";

import { authenticate, createUser, deleteUser, type TestUser } from "./session";

/**
 * Runs against the seed fixtures (`supabase/seed.sql`), which are anchored to
 * the Monday of the current week: 2 clients, 2 projects, 3 developers and 9
 * bookings covering the five states, an overlap, an out-of-hours booking and a
 * Saturday one.
 */
const NIMBUS = "00000000-0000-4000-8000-000000000032";

let pm: TestUser;

test.beforeAll(async () => {
  pm = await createUser("pm");
});

test.afterAll(async () => {
  await deleteUser(pm.userId);
});

function mondayOfThisWeek() {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
    ),
  )
    .toISOString()
    .slice(0, 10);
}

/** Lane headers of the day grid. */
function lanes(page: Page) {
  return page.locator("[data-lane-header]");
}

test.beforeEach(async ({ context }) => {
  await authenticate(context, pm);
});

test("the calendar is the landing screen", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("heading", { name: "Calendario" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Calendario" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

// AC-1.1, AC-1.2, AC-1.3, AC-4.1
test("navigates year → month → day without losing the filter", async ({ page }) => {
  const monday = mondayOfThisWeek();
  const year = monday.slice(0, 4);
  await page.goto(`/calendar?view=year&date=${monday}&client=${NIMBUS}`);

  // Year → month.
  const monthName = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(`${monday}T12:00:00Z`));
  await page.getByRole("link", { name: new RegExp(monthName, "i") }).first().click();
  // `view=month` no viaja en la URL: `calendarHref` omite lo que coincide con
  // el default, así que se verifica el estado, no la string.
  await expect(page.getByRole("link", { name: "Mes", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page).toHaveURL(new RegExp(`client=${NIMBUS}`));

  // Month → day.
  await page.getByRole("link", { name: new RegExp(`^${Number(monday.slice(8, 10))}/`) }).first().click();
  await expect(page).toHaveURL(/view=day/);
  await expect(page).toHaveURL(new RegExp(`client=${NIMBUS}`));

  // AC-1.3: back up a level, filter intact.
  await page.getByRole("link", { name: "Mes", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`client=${NIMBUS}`));

  // Moving the range keeps it too.
  await page.getByRole("link", { name: "Período siguiente" }).click();
  await expect(page).toHaveURL(new RegExp(`client=${NIMBUS}`));
  await expect(page).toHaveURL(new RegExp(`date=${year}`));
});

// AC-3.1, AC-3.2
test("groups the day into lanes by developer or by project", async ({ page }) => {
  const monday = mondayOfThisWeek();

  await page.goto(`/calendar?view=day&date=${monday}&group=dev`);
  await expect(lanes(page)).toHaveCount(3);

  await page.getByRole("link", { name: "Por proyecto" }).click();
  await expect(lanes(page)).toHaveCount(2);
  await expect(lanes(page).first()).toContainText("Portal de reservas");
});

// AC-2.1, AC-2.2, AC-2.3
test("positions blocks by time and puts overlaps side by side", async ({ page }) => {
  await page.goto(`/calendar?view=day&date=${mondayOfThisWeek()}&group=project`);

  const fourHours = page.getByRole("button", {
    name: /Cristian Soto.*Website Revamp.*09:00–13:00/,
  });
  const oneHour = page.getByRole("button", {
    name: /Cristian Soto.*Website Revamp.*15:00–16:00/,
  });
  const overlapping = page.getByRole("button", {
    name: /Malena Rojas.*Website Revamp.*09:00–12:00/,
  });

  const long = (await fourHours.boundingBox())!;
  const short = (await oneHour.boundingBox())!;
  const parallel = (await overlapping.boundingBox())!;

  // Height is proportional to duration: a 30-minute slot is 24px.
  expect(Math.round(long.height)).toBe(192);
  expect(Math.round(short.height)).toBe(48);
  // A later booking sits lower.
  expect(short.y).toBeGreaterThan(long.y);

  // Two overlapping bookings share the same rows but not the same columns.
  expect(parallel.y).toBe(long.y);
  expect(
    long.x + long.width <= parallel.x + 1 || parallel.x + parallel.width <= long.x + 1,
  ).toBe(true);

  // AC-2.3: priority is not carried by colour alone — the accessible name says it.
  await expect(
    page.getByRole("button", { name: /Portal de reservas.*proyecto prioritario/ }).first(),
  ).toBeVisible();
});

test("opens a read-only detail from a block", async ({ page }) => {
  await page.goto(`/calendar?view=day&date=${mondayOfThisWeek()}`);

  const block = page.getByRole("button", {
    name: /Cristian Soto.*Website Revamp.*09:00–13:00/,
  });

  // El bloque muestra cliente, no horario: la posición en la grilla ya dice la
  // hora, y una cuarta línea no entra en una reserva de una hora.
  await expect(block).toContainText("Acme Corp");
  await expect(block).not.toContainText("09:00");

  await block.click();

  // El detalle sí trae todo, incluido el horario.
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("Acme Corp");
  await expect(detail).toContainText("09:00–13:00");
  await expect(detail).toContainText("WEB-142");
  await expect(detail).toContainText("Migración del checkout");
});

test("a one-hour block still shows developer, project and client", async ({ page }) => {
  await page.goto(`/calendar?view=day&date=${mondayOfThisWeek()}&group=project`);

  const short = page.getByRole("button", {
    name: /Cristian Soto.*Website Revamp.*15:00–16:00/,
  });
  const box = (await short.boundingBox())!;
  expect(Math.round(box.height)).toBe(48);

  // Nada recortado verticalmente: el contenido entra en el alto del bloque.
  const overflows = await short.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(overflows).toBe(false);
  await expect(short).toContainText("Cristian Soto");
  await expect(short).toContainText("Acme Corp");

  /**
   * El cliente tiene que verse entero, no reducido a puntos suspensivos. Con
   * una columna `auto` de grid, su `max-width` porcentual se resolvía contra un
   * tamaño que dependía del propio contenido y el navegador la colapsaba a
   * 25px: el texto estaba en el DOM y en el nombre accesible, así que solo una
   * medición lo detecta.
   */
  const client = await short.evaluate((el) => {
    const span = [...el.querySelectorAll<HTMLElement>("span")].find(
      (node) => node.innerText.trim() === "Acme Corp",
    );
    if (!span) return null;
    return { width: span.getBoundingClientRect().width, truncated: span.scrollWidth > span.clientWidth + 1 };
  });

  expect(client).not.toBeNull();
  expect(client!.truncated).toBe(false);
  expect(client!.width).toBeGreaterThan(40);
});

test("the select keeps its label visible and offers 'Todos' first", async ({ page }) => {
  await page.goto(`/calendar?view=day&date=${mondayOfThisWeek()}`);

  const trigger = page.getByLabel("Desarrollador");
  const triggerBox = (await trigger.boundingBox())!;
  await trigger.click();

  const options = page.getByRole("option");
  await expect(options.first()).toHaveText("Todos");

  // El desplegable se abre DEBAJO del trigger, no encima: con el default de
  // Base UI la opción activa se posiciona sobre el trigger y tapa la etiqueta.
  const firstOptionBox = (await options.first().boundingBox())!;
  expect(firstOptionBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 1);
  await expect(trigger).toContainText("Desarrollador");
});

/**
 * Cierra el desplegable abierto y **espera a que desaparezca de verdad**.
 *
 * `getByRole("option")` es global: mientras el popup anterior siga montado —se
 * cierra con una animación de 120ms— devuelve *sus* opciones. Sin esta espera el
 * test lee el select equivocado, y el síntoma es desconcertante: pide
 * desarrolladores y recibe nombres de clientes. Pasaba en una máquina rápida y
 * fallaba en el runner.
 */
async function closeSelect(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
}

test("filters are interconnected", async ({ page }) => {
  await page.goto(`/calendar?view=day&date=${mondayOfThisWeek()}`);

  // Sin filtros, los dos clientes del seed están disponibles.
  await page.getByLabel("Cliente").click();
  await expect(page.getByRole("option", { name: "Acme Corp" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Nimbus SRL" })).toBeVisible();
  await closeSelect(page);

  // Malena solo tiene reservas de Portal de reservas (Nimbus) ese día, más una
  // pendiente de Website; Rodrigo es el que acota de verdad.
  await page.getByLabel("Desarrollador").click();
  await page.getByRole("option", { name: "Cristian Soto" }).click();

  await page.getByLabel("Cliente").click();
  const clientOptions = await page.getByRole("option").allTextContents();
  // Cristian tiene reservas en los dos clientes; el PM sí se acota.
  expect(clientOptions).toContain("Todos");
  await closeSelect(page);

  // El propio filtro de desarrollador sigue ofreciendo a todos: si se acotara a
  // sí mismo, no habría forma de cambiar de dev sin limpiar.
  await page.getByLabel("Desarrollador").click();
  await expect(page.getByRole("option", { name: "Malena Rojas" })).toBeVisible();
  const devOptions = await page.getByRole("option").allTextContents();
  expect(devOptions).toContain("Malena Rojas");
  expect(devOptions).toContain("Rodrigo Paz");
});

// AC-4.1 and DESIGN.md §9
test("filters narrow the grid and can be cleared", async ({ page }) => {
  const monday = mondayOfThisWeek();
  await page.goto(`/calendar?view=day&date=${monday}`);
  await expect(page.getByRole("button", { name: /Website Revamp/ }).first()).toBeVisible();

  await page.getByLabel("Cliente").click();
  await page.getByRole("option", { name: "Nimbus SRL" }).click();

  await expect(page.getByRole("button", { name: /Website Revamp/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Portal de reservas/ }).first()).toBeVisible();

  await page.getByRole("button", { name: /Limpiar filtros/ }).click();
  await expect(page.getByRole("button", { name: /Website Revamp/ }).first()).toBeVisible();
});

test("hidden states come back through the status filter", async ({ page }) => {
  await page.goto(`/calendar?view=day&date=${mondayOfThisWeek()}`);

  // Terminal states are out by default: they clutter the grid with time nobody
  // is going to work.
  await expect(page.getByRole("button", { name: /Cancelada/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Estado" }).click();
  await page.getByRole("menuitem", { name: "Cancelada" }).click();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("button", { name: /Cancelada/ }).first()).toBeVisible();
});

test("tells apart an empty range from a filtered-out one", async ({ page }) => {
  const monday = mondayOfThisWeek();

  // Nothing at all in the range.
  await page.goto("/calendar?view=day&date=2027-03-10");
  await expect(page.getByText("Sin reservas en este período")).toBeVisible();

  // Data exists, the filters hide it — and the message names the filter.
  await page.goto(`/calendar?view=day&date=${monday}&client=${NIMBUS}&priority=normal`);
  await expect(page.getByText(/Ninguna reserva coincide con cliente Nimbus SRL/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Limpiar filtros" })).toBeVisible();
});

test("survives a mangled query string instead of erroring", async ({ page }) => {
  await page.goto("/calendar?view=decade&date=9999-99-99&client=nope&status=inventado");

  await expect(page.getByRole("heading", { name: "Calendario" })).toBeVisible();
  // Falls back to the month view default.
  await expect(page.getByRole("link", { name: "Mes", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
});
