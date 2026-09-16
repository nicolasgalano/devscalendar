import type { Database } from "@/types/database";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];
type TicketPriority = Database["public"]["Enums"]["ticket_priority"];

/**
 * Orden semántico para render (tabla, dropdowns, filtros). Coincide con el
 * orden del enum de la base, pero se declara acá porque el orden del enum
 * es documental — el código compara por igualdad, no por posición (misma
 * razón que el `project_member_role` de la migration 14).
 */
export const TICKET_STATUS_ORDER = [
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const satisfies readonly TicketStatus[];

/** Estados "abiertos" — lo que el listado muestra por default (AC-3.3). */
export const TICKET_STATUS_OPEN = [
  "todo",
  "in_progress",
  "in_review",
  "blocked",
] as const satisfies readonly TicketStatus[];

/** Estados cerrados — se agregan con el toggle "incluir cerrados". */
export const TICKET_STATUS_CLOSED = [
  "done",
  "cancelled",
] as const satisfies readonly TicketStatus[];

/**
 * Labels en español para la UI. Definidos como Record para forzar que TS
 * marque errores si mañana se agrega un estado al enum sin traducirlo.
 */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  todo: "Por hacer",
  in_progress: "En progreso",
  in_review: "En revisión",
  blocked: "Bloqueado",
  done: "Hecho",
  cancelled: "Cancelado",
};

export const TICKET_PRIORITY_ORDER = [
  "low",
  "medium",
  "high",
  "critical",
] as const satisfies readonly TicketPriority[];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};
