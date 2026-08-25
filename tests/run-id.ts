import { randomUUID } from "node:crypto";

/**
 * Identificador único de la corrida de tests.
 *
 * En CI se arma con `GITHUB_RUN_ID` y `GITHUB_RUN_ATTEMPT`: el segundo importa
 * porque un re-run de un workflow fallido conserva el `RUN_ID`, y sin él dos
 * intentos del mismo workflow compartirían identificador. Fuera de CI cae a un
 * uuid corto.
 *
 * Sirve para dos cosas distintas:
 *
 * 1. **Aislamiento entre tests que corren en paralelo.** Vitest y Playwright
 *    ejecutan archivos concurrentemente, y varios crean usuarios y proyectos.
 * 2. **Identificación de los registros como datos de prueba**, que es lo que
 *    hace posible una limpieza quirúrgica cuando se toca un proyecto remoto a
 *    mano (ver `docs/testing.md`).
 *
 * Dentro del stack efímero de CI la garantía final no es la limpieza: es que el
 * stack entero se descarta al terminar el job. El identificador está igual,
 * porque la convención tiene que ser la misma en los dos lados.
 */
export const TEST_RUN_ID =
  process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
    ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
    : `local-${randomUUID().slice(0, 8)}`;

/** `test-<runId>-<label>@example.com` */
export function testEmail(label: string): string {
  return `test-${TEST_RUN_ID}-${slug(label)}@example.com`;
}

/** `[test:<runId>] <label>` — para nombres, títulos y slugs. */
export function testName(label: string): string {
  return `[test:${TEST_RUN_ID}] ${label}`;
}

/**
 * Un identificador de corrida válido. Las funciones de limpieza lo exigen: sin
 * esto, un borrado "de lo de test" es un borrado a secas.
 */
export function isValidRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{3,}$/.test(value);
}

/**
 * Escapa un valor para interpolarlo dentro de un `new RegExp(...)`.
 *
 * Hace falta porque el prefijo de `testName()` son corchetes, y `[test:123]`
 * dentro de una expresión regular es una **clase de caracteres**: matchearía un
 * solo carácter en vez del texto literal, y el locator pasaría a encontrar
 * cualquier cosa. Los specs que arman locators por regex tienen que usar esto.
 */
export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Deja solo lo que es seguro dentro de la parte local de un email. */
function slug(label: string): string {
  const cleaned = label
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "fixture";
}
