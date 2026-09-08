import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import {
  authenticate,
  cleanupByName,
  createUser,
  deactivateUser,
  deleteInvite,
  deleteUser,
  type TestUser,
} from "./session";
import { testEmail, testName } from "../run-id";

/**
 * Los botones se renderizan en el servidor pero el handler recién se engancha
 * al hidratar: un click anterior a eso se pierde en silencio. `toPass` reintenta
 * el bloque hasta que el diálogo realmente aparece.
 */
async function openDialog(page: Page, buttonName: string) {
  await expect(async () => {
    await page.getByRole("button", { name: buttonName }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * T4.5 — feature 002. Flujo feliz completo: un admin da de alta un cliente, un
 * proyecto sobre ese cliente y un usuario, y los ve listados.
 */
test.describe("admin entity management", () => {
  // Etiquetados con el identificador de corrida: acá los nombres se tipean en
  // el formulario, así que lo que crea la app es exactamente esta constante.
  const suffix = randomUUID().slice(0, 8);
  const clientName = testName(`E2E Cliente ${suffix}`);
  const projectName = testName(`E2E Proyecto ${suffix}`);
  const invitedEmail = testEmail(`invited-${suffix}`);

  let admin: TestUser;
  let pm: TestUser;

  test.beforeEach(async ({ context }) => {
    admin = await createUser("admin");
    // El combo de PM solo lista perfiles con rol pm: hace falta uno para poder
    // crear un proyecto. Cómo llegó a existir no es lo que prueba este test.
    pm = await createUser("pm");
    await authenticate(context, admin);
  });

  test.afterEach(async () => {
    await cleanupByName(clientName, projectName);
    await deleteInvite(invitedEmail);
    await deleteUser(admin.userId);
    await deleteUser(pm.userId);
  });

  test("creates a client, a project and a user from the admin panel", async ({ page }) => {
    // ── Cliente ────────────────────────────────────────────────
    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();

    await openDialog(page, "Crear cliente");
    await page.getByLabel("Nombre").fill(clientName);
    // Esperar la respuesta del POST antes de mirar la tabla. Sin esto, la
    // aserción compite con el `router.refresh()` y con la compilación en frío
    // del dev server, y el test falla de forma intermitente cuando corre en
    // paralelo con otros.
    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/clients") && response.request().method() === "POST",
      ),
      page.getByRole("dialog").getByRole("button", { name: "Crear cliente" }).click(),
    ]);
    expect(created.ok()).toBe(true);

    await expect(page.getByRole("cell", { name: clientName })).toBeVisible();

    // ── Proyecto sobre ese cliente ─────────────────────────────
    await page.goto("/admin/projects");
    await expect(page.getByRole("heading", { name: "Proyectos" })).toBeVisible();

    await openDialog(page, "Crear proyecto");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre").fill(projectName);

    await dialog.getByText("Elegí un cliente").click();
    await page.getByRole("option", { name: clientName }).click();

    await dialog.getByText("Elegí un PM").click();
    await page.getByRole("option", { name: pm.fullName }).click();

    const [projectCreated] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/projects") && response.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Crear proyecto" }).click(),
    ]);
    expect(projectCreated.ok()).toBe(true);

    await expect(page.getByRole("cell", { name: projectName })).toBeVisible();
    // El cliente y el PM elegidos aparecen en la fila del proyecto.
    const row = page.getByRole("row").filter({ hasText: projectName });
    await expect(row).toContainText(clientName);
    await expect(row).toContainText(pm.fullName);

    // ── Usuario ────────────────────────────────────────────────
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();

    await openDialog(page, "Invitar usuario");
    await page.getByLabel("Email").fill(invitedEmail);
    const [invited] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/users") && response.request().method() === "POST",
      ),
      page.getByRole("dialog").getByRole("button", { name: "Invitar usuario" }).click(),
    ]);
    expect(invited.ok()).toBe(true);

    // Nunca ingresó: queda como invitación pendiente, no como perfil.
    await expect(page.getByRole("heading", { name: "Invitaciones pendientes" })).toBeVisible();
    await expect(page.getByRole("cell", { name: invitedEmail })).toBeVisible();
  });

  test("keeps the sidebar item active on the matching section", async ({ page }) => {
    await page.goto("/admin/projects");

    await expect(page.getByRole("link", { name: "Proyectos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("link", { name: "Clientes" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("redirects a non-admin away from the admin panel", async ({ page, context }) => {
    await context.clearCookies();
    const developer = await createUser("developer");
    try {
      await authenticate(context, developer);
      await page.goto("/admin/clients");

      // `/` redirige al calendario desde `003`: es la pantalla principal del
      // producto (spec funcional §4), no la home de bienvenida de `002`.
      await expect(page).toHaveURL(/\/calendar/);
      // La sección de administración no existe en la nav de un dev.
      await expect(page.getByRole("link", { name: "Clientes" })).toHaveCount(0);
    } finally {
      await deleteUser(developer.userId);
    }
  });

  /**
   * `012` / D-09 — el caso que antes no se podía ni escribir: una persona que es
   * PM **y** admin. Con `profiles.role` singular había que elegir, y elegir
   * `admin` significaba que ninguno de sus proyectos podía nombrarla
   * responsable, porque `pm_id` exigía `role = 'pm'` exacto.
   */
  test("a pm+admin keeps the panel and can be named responsible for a project", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    const both = await createUser(["pm", "admin"]);
    try {
      await authenticate(context, both);

      // Sigue entrando al panel: sumar `pm` no le sacó nada (AC-2.2).
      await page.goto("/admin/projects");
      await expect(page.getByRole("heading", { name: "Proyectos" })).toBeVisible();

      // Y ahora aparece en el desplegable de PM responsable (AC-2.1).
      await openDialog(page, "Crear proyecto");
      const dialog = page.getByRole("dialog");
      await dialog.getByText("Elegí un PM").click();
      await expect(page.getByRole("option", { name: both.fullName })).toBeVisible();
    } finally {
      await deleteUser(both.userId);
    }
  });

  /**
   * AC-4.1 — la navegación es unión y no `else if`. Antes, quien fuera dev y
   * admin perdía una de las dos secciones según el orden en que estaba escrito
   * el ternario.
   */
  test("a developer+admin sees both the inbox and the admin section", async ({ page, context }) => {
    await context.clearCookies();
    const both = await createUser(["developer", "admin"]);
    try {
      await authenticate(context, both);
      await page.goto("/calendar");

      await expect(page.getByRole("link", { name: "Pendientes", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Clientes" })).toBeVisible();
    } finally {
      await deleteUser(both.userId);
    }
  });

  /**
   * AC-3.1 / D-01 — desactivar a alguien le saca el acceso de verdad. Hasta
   * `012`, un admin desactivado conservaba `/api/*` entero: el único chequeo de
   * `active` vivía en un layout de UI, y las rutas de API no tienen layout.
   */
  test("a deactivated admin is bounced and refused by the API", async ({ page, context }) => {
    await context.clearCookies();
    const admin = await createUser("admin");
    try {
      await deactivateUser(admin.userId);
      await authenticate(context, admin);

      await page.goto("/admin/clients");
      await expect(page).toHaveURL(/\/pending-access/);

      const status = await page.evaluate(async () => {
        const response = await fetch("/api/clients", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "no deberia crearse" }),
        });
        return response.status;
      });
      expect(status).toBe(403);
    } finally {
      await deleteUser(admin.userId);
    }
  });
});
