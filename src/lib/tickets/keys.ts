/**
 * Parser y formatter de claves de ticket `PROJ-N`.
 *
 * El regex acepta lo que la base valida en `projects.key_format` (una letra
 * seguida de 1-7 alfanuméricos), seguido de guión y uno o más dígitos. El
 * parser tolera mayúsculas y minúsculas y espacios en los extremos; el
 * formatter siempre devuelve mayúsculas.
 *
 * `parseTicketKey` **nunca tira**: input inválido → `null`. Es la promesa que
 * las pages `/tickets/[key]` necesitan para responder 404 sin explotar. La
 * ruta `catch()` de la home haría cualquier error visible como un 500.
 */
const TICKET_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,7})-(\d+)$/;

export type TicketKey = {
  /** Project key en mayúsculas, canónico. */
  projectKey: string;
  numero: number;
};

export function parseTicketKey(input: string | null | undefined): TicketKey | null {
  if (typeof input !== "string") return null;
  const match = TICKET_KEY_PATTERN.exec(input.trim());
  // Los dos grupos son obligatorios en el pattern; si `match` no es null, los
  // dos están definidos. TS con `noUncheckedIndexedAccess` no lo sabe, por eso
  // van los checks explícitos.
  if (!match || !match[1] || !match[2]) return null;
  const numero = Number.parseInt(match[2], 10);
  // `\d+` ya garantiza dígitos, pero 0 y negativos no tienen sentido (el
  // trigger empieza en 1).
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return { projectKey: match[1].toUpperCase(), numero };
}

/**
 * Arma la clave canónica `PROJ-N` a partir del proyecto y el número.
 *
 * Acepta `key` (nombre de la columna en `projects`) para que se pueda pasar
 * directo la row del proyecto sin renombrar. `numero` va tal cual — sin
 * padding, sin ceros a la izquierda; el ticket 42 es `WDW-42`, no `WDW-0042`.
 */
export function formatTicketKey(input: { key: string; numero: number }): string {
  return `${input.key.toUpperCase()}-${input.numero}`;
}
