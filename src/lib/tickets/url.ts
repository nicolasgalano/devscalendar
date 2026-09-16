import { z } from "zod";

import type { Database } from "@/types/database";

import { TICKET_STATUS_CLOSED, TICKET_STATUS_OPEN } from "./status";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];
type TicketPriority = Database["public"]["Enums"]["ticket_priority"];

/**
 * Base default del listado: la vista personal cross-project. En `017` se
 * renombró de `/tickets` (donde vivía en `015`) a `/my-work`, porque `/tickets`
 * dejó de existir como listado y `/projects/[projectKey]/backlog` es la
 * variante scopeada por proyecto.
 *
 * Los helpers aceptan `basePath` para que un `<TicketListFilters>` embebido en
 * el backlog construya URLs con `/projects/[projectKey]/backlog` en vez de
 * `/my-work`.
 */
export const TICKETS_PATH = "/my-work";

const ticketStatusSchema = z.enum([
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
]);

const ticketPrioritySchema = z.enum(["low", "medium", "high", "critical"]);

const uuidSchema = z.string().uuid();

/**
 * `assigneeId` acepta dos alias además de un uuid:
 *   - `me` → resuelve a `auth.uid()` en tiempo de query.
 *   - `unassigned` → filtra `assignee_id is null`.
 */
export type AssigneeFilter = string | "me" | "unassigned" | null;

export type TicketFilters = {
  projectId: string | null;
  statuses: TicketStatus[];
  assigneeId: AssigneeFilter;
  priorities: TicketPriority[];
  q: string | null;
  /**
   * Toggle "incluir cerrados": cuando es `true` y no hay `?status=` explícito,
   * el listado suma `done` y `cancelled` a los cuatro abiertos. Si el usuario
   * pasa `?status=...` con una lista explícita, este flag no afecta nada.
   */
  includeClosed: boolean;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseCsv<T>(value: string | undefined, itemSchema: z.ZodType<T>): T[] {
  if (!value) return [];
  return value.split(",").flatMap((entry) => {
    const parsed = itemSchema.safeParse(entry.trim());
    return parsed.success ? [parsed.data] : [];
  });
}

function parseAssignee(value: string | undefined): AssigneeFilter {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "me" || trimmed === "unassigned") return trimmed;
  const parsed = uuidSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

function sameStatuses(a: readonly TicketStatus[], b: readonly TicketStatus[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

/**
 * Lee el estado del listado desde el URL. Igual que `parseCalendarParams`,
 * **nunca tira** — una query string mal formada cae a los defaults, en vez
 * de dejar la pantalla en 500.
 */
export function parseTicketFilters(raw: RawSearchParams): TicketFilters {
  const explicitStatuses = [...new Set(parseCsv(first(raw.status), ticketStatusSchema))];
  const includeClosed = first(raw.includeClosed) === "1";

  const statuses =
    explicitStatuses.length > 0
      ? explicitStatuses
      : includeClosed
        ? [...TICKET_STATUS_OPEN, ...TICKET_STATUS_CLOSED]
        : [...TICKET_STATUS_OPEN];

  const q = (first(raw.q) ?? "").trim();

  return {
    projectId: uuidSchema.safeParse(first(raw.projectId)).data ?? null,
    statuses,
    assigneeId: parseAssignee(first(raw.assigneeId)),
    priorities: [...new Set(parseCsv(first(raw.priority), ticketPrioritySchema))],
    q: q.length > 0 ? q : null,
    includeClosed,
  };
}

/**
 * ¿El usuario acotó la vista? Se usa para distinguir el empty state ("no hay
 * tickets") del no-results ("los filtros no matchean nada"). Mismo criterio
 * que `hasActiveFilters` del calendario.
 */
export function hasActiveTicketFilters(filters: TicketFilters): boolean {
  return (
    filters.projectId !== null ||
    filters.assigneeId !== null ||
    filters.priorities.length > 0 ||
    filters.q !== null ||
    filters.includeClosed ||
    !sameStatuses(filters.statuses, TICKET_STATUS_OPEN)
  );
}

export type TicketFiltersPatch = Partial<TicketFilters>;

/**
 * Construye la URL desde el estado actual + un patch. Los valores iguales al
 * default no se escriben, para que la URL común quede corta y legible.
 *
 * La representación del status filter usa el `?includeClosed=1` shortcut
 * cuando `statuses` es exactamente `OPEN ∪ CLOSED` — más legible que
 * `?status=todo,in_progress,in_review,blocked,done,cancelled`.
 */
export function buildTicketsHref(
  current: TicketFilters,
  patch: TicketFiltersPatch = {},
  basePath: string = TICKETS_PATH,
): string {
  const next: TicketFilters = { ...current, ...patch };
  const params = new URLSearchParams();

  if (next.projectId) params.set("projectId", next.projectId);
  if (next.assigneeId !== null) params.set("assigneeId", next.assigneeId);

  const allStatuses = [...TICKET_STATUS_OPEN, ...TICKET_STATUS_CLOSED];
  if (sameStatuses(next.statuses, TICKET_STATUS_OPEN)) {
    // Default: nada en el URL.
  } else if (sameStatuses(next.statuses, allStatuses)) {
    params.set("includeClosed", "1");
  } else {
    params.set("status", next.statuses.join(","));
  }

  if (next.priorities.length > 0) params.set("priority", next.priorities.join(","));
  if (next.q) params.set("q", next.q);

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** Limpia todos los filtros. La URL queda en `basePath` sin querystring. */
export function clearTicketFiltersHref(basePath: string = TICKETS_PATH): string {
  return basePath;
}
