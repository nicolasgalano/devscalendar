import {
  ArrowRightLeftIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/lib/validation/calendar";

/**
 * DESIGN.md §8: the five booking states are communicated with a line icon plus
 * text, never with a background colour.
 *
 * Only `rechazada` and `desplazada` carry colour, because they are the two that
 * force the PM to reassign. Pending, approved and cancelled are the normal
 * course of events and stay neutral — if everything is coloured, nothing stands
 * out.
 *
 * DESIGN.md §14 had this component down as part of 004, but the calendar has to
 * show the state on every block (functional spec §4.2), so it is born here and
 * 004/005 reuse it.
 */
const STATUS: Record<
  BookingStatus,
  { label: string; Icon: LucideIcon; className: string }
> = {
  pending: {
    label: "Pendiente",
    Icon: CircleDashedIcon,
    className: "text-secondary-foreground",
  },
  approved: {
    label: "Aprobada",
    Icon: CircleCheckIcon,
    className: "text-secondary-foreground",
  },
  cancelled: {
    label: "Cancelada",
    Icon: CircleSlashIcon,
    className: "text-muted-foreground",
  },
  rejected: {
    label: "Rechazada",
    Icon: CircleXIcon,
    className: "text-attention",
  },
  displaced: {
    label: "Desplazada",
    Icon: ArrowRightLeftIcon,
    className: "text-attention",
  },
};

/** §11: the product's vocabulary, never the database's (`pendiente`, not `pending`). */
export function bookingStatusLabel(status: BookingStatus): string {
  return STATUS[status].label;
}

export function BookingStatusTag({
  status,
  className,
  iconOnly = false,
}: {
  status: BookingStatus;
  className?: string;
  /** For tight blocks: keeps the icon, moves the text to the accessible name. */
  iconOnly?: boolean;
}) {
  const { label, Icon, className: statusClassName } = STATUS[status];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", statusClassName, className)}
      {...(iconOnly ? { "aria-label": label } : {})}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {iconOnly ? null : label}
    </span>
  );
}
