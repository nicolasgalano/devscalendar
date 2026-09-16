import { Badge } from "@/components/ui/badge";
import { TICKET_PRIORITY_LABELS } from "@/lib/tickets/status";
import type { Database } from "@/types/database";

type TicketPriority = Database["public"]["Enums"]["ticket_priority"];

/**
 * DESIGN.md §8: prioridad es uno de los dos sistemas cromáticos permitidos
 * fuera del calendario. En bookings hay dos niveles (`común`/`prioritario`);
 * los tickets tienen cuatro, y la escala se estira usando los tokens que ya
 * existen — sin agregar nuevos, para respetar la nota de §3 (extender la
 * escala se hace agregando tokens intermedios *si* se resuelve pasar a P0–P3;
 * este archivo no decide esa pregunta, solo mapea los 4 niveles actuales a lo
 * disponible).
 *
 *   - `low` / `medium`: gris neutro; medium con badge relleno, low outline —
 *     el default "no reclama nada" es medium.
 *   - `high`: `--attention` (naranja/ámbar) — pide atención.
 *   - `critical`: `--danger` (rojo) — bloqueo o urgencia.
 *
 * "Prioridad común no lleva color" (§3.7): low y medium son gris a propósito.
 */
const VARIANT: Record<
  TicketPriority,
  "outline" | "priority-normal" | "priority-high" | "danger"
> = {
  low: "outline",
  medium: "priority-normal",
  high: "priority-high",
  critical: "danger",
};

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return <Badge variant={VARIANT[priority]}>{TICKET_PRIORITY_LABELS[priority]}</Badge>;
}
