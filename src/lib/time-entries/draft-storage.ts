/**
 * Persistencia de borradores de formulario a localStorage (feature 030).
 *
 * El bug que lo motiva: `<TimeEntryDialog>` y `<TimerStartDialog>` guardan
 * su form en `useState`. Al tabear/minimizar, Next re-rehydrata y el
 * `useEffect([open, initial])` de los diálogos dispara con un `initial`
 * nuevo (identity cambió porque el parent lo arma en cada render), y los
 * campos se resetean aunque el dialog siga abierto. Esto dejaba al equipo
 * perdiendo lo que acababa de escribir.
 *
 * Diseño:
 *   - El valor se envuelve en `{ value, writtenAt }`. Un draft más viejo
 *     que `TTL_MS` se descarta al leer y se devuelve `null`.
 *   - La key efectiva mezcla `baseKey + userId` para que una máquina
 *     compartida (un dev usando el equipo de otro) no revele borradores
 *     entre cuentas.
 *   - Guards SSR: todas las operaciones son no-op si `window` no está
 *     definido (los componentes son client, pero el import puede llegar
 *     a cargar en un edge-case de SSR).
 *   - Catch silencioso de `localStorage` fallando (modo privado restrictivo,
 *     cuota llena) — no vale la pena romper el dialog porque no se pudo
 *     persistir el borrador.
 */

type DraftEnvelope<T> = { value: T; writtenAt: number };

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function fullKey(baseKey: string, userId: string): string {
  return `${baseKey}:${userId}`;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readDraft<T>(baseKey: string, userId: string): T | null {
  if (!hasStorage()) return null;
  const key = fullKey(baseKey, userId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as DraftEnvelope<T>;
    if (
      !envelope ||
      typeof envelope.writtenAt !== "number" ||
      !Number.isFinite(envelope.writtenAt)
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    if (Date.now() - envelope.writtenAt > DRAFT_TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return envelope.value;
  } catch {
    return null;
  }
}

export function writeDraft<T>(baseKey: string, userId: string, value: T): void {
  if (!hasStorage()) return;
  const key = fullKey(baseKey, userId);
  try {
    const envelope: DraftEnvelope<T> = { value, writtenAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // ignoré — ver docstring.
  }
}

export function clearDraft(baseKey: string, userId: string): void {
  if (!hasStorage()) return;
  const key = fullKey(baseKey, userId);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // idem.
  }
}
