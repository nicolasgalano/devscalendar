import type { Database } from "@/types/database";

type SprintStatus = Database["public"]["Enums"]["sprint_status"];

/**
 * Orden semántico para render. Coincide con el enum de la base pero se
 * declara acá porque el código compara por igualdad, no por posición (misma
 * razón que `TICKET_STATUS_ORDER` de 015).
 */
export const SPRINT_STATUS_ORDER = [
  "planned",
  "active",
  "completed",
] as const satisfies readonly SprintStatus[];

/**
 * Labels en español, `Record` para forzar que un enum nuevo tire error de tipo
 * si no se traduce (misma disciplina que `TICKET_STATUS_LABELS`).
 */
export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = {
  planned: "Planificado",
  active: "Activo",
  completed: "Cerrado",
};

/**
 * `PROJ Sprint N` o el name custom si existe. Puro; reusado en headers, filtros,
 * dropdowns y en el breadcrumb del reporte cerrado.
 */
export function formatSprintDisplayName(input: {
  numero: number;
  name: string | null;
}): string {
  return input.name ?? `Sprint ${input.numero}`;
}
