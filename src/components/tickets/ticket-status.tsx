import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  EyeIcon,
  LoaderIcon,
  OctagonAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { TICKET_STATUS_LABELS } from "@/lib/tickets/status";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];

/**
 * DESIGN.md §8 aplicado a tickets: cada estado se comunica con icono + texto.
 * El color queda reservado para lo que reclama acción, así que solo `blocked`
 * suma `--attention` — un ticket bloqueado es exactamente eso, algo trabado que
 * necesita destrabarse. `done` y `cancelled` bajan a `--muted-foreground`
 * porque son terminales, y en un listado grande dejan pasar visualmente lo
 * abierto.
 */
const STATUS: Record<
  TicketStatus,
  { Icon: LucideIcon; className: string }
> = {
  todo: {
    Icon: CircleDashedIcon,
    className: "text-secondary-foreground",
  },
  in_progress: {
    Icon: LoaderIcon,
    className: "text-secondary-foreground",
  },
  in_review: {
    Icon: EyeIcon,
    className: "text-secondary-foreground",
  },
  blocked: {
    Icon: OctagonAlertIcon,
    className: "text-attention",
  },
  done: {
    Icon: CircleCheckIcon,
    className: "text-muted-foreground",
  },
  cancelled: {
    Icon: CircleSlashIcon,
    className: "text-muted-foreground",
  },
};

export function TicketStatusBadge({
  status,
  className,
}: {
  status: TicketStatus;
  className?: string;
}) {
  const { Icon, className: statusClassName } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5", statusClassName, className)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {TICKET_STATUS_LABELS[status]}
    </span>
  );
}
