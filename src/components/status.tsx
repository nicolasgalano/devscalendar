import { CircleCheckIcon, CircleDashedIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * DESIGN.md §3.2 / §8: el estado de un registro NO se comunica con color —
 * solo con icono de línea y texto. El color queda reservado para urgencia.
 */
export function RecordStatus({ active }: { active: boolean }) {
  const Icon = active ? CircleCheckIcon : CircleDashedIcon;
  return (
    <span className="inline-flex items-center gap-1.5 text-secondary-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {active ? "Activo" : "Inactivo"}
    </span>
  );
}

/**
 * §8: la prioridad de proyecto es uno de los sistemas cromáticos del producto.
 * Dos niveles, como pide la spec funcional §7. El común usa el gris neutro a
 * propósito — si todo tiene color, nada resalta.
 * §11: se nombra como lo nombra el PM (`prioritario`), no como la DB (`high`).
 */
export function PriorityBadge({ priority }: { priority: string }) {
  const isHigh = priority === "high";
  return (
    <Badge variant={isHigh ? "priority-high" : "priority-normal"}>
      {isHigh ? "Prioritario" : "Común"}
    </Badge>
  );
}
