"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  BookingDialog,
  type BookingDialogSession,
} from "@/components/calendar/booking-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { blankForm, fromBooking } from "@/lib/bookings/form";
import type { BookingFormOptions } from "@/lib/bookings/options";
import { canCreateBookings, type BookingViewer } from "@/lib/bookings/permissions";
import { formatLongDate, formatTimeRange } from "@/lib/calendar/format";
import type { CalendarBooking } from "@/lib/calendar/query";
import { instantToIsoDate } from "@/lib/calendar/range";
import { WORKDAY_START_HOUR } from "@/lib/calendar/workdays";
import type { CalendarParams } from "@/lib/validation/calendar";

export type CreatePrefill = {
  date?: string;
  /** Minutes from local midnight, from the clicked grid slot. */
  startMinute?: number;
  devId?: string;
  projectId?: string;
};

type BookingActions = {
  /** Rol habilitado para reservar: decide si existe la acción primaria. */
  canCreate: boolean;
  /**
   * Además hay con qué reservar. Se distingue de `canCreate` a propósito: el
   * botón de la vista se muestra igual y explica el problema al usarse
   * (DESIGN.md §7), pero no tiene sentido cubrir toda la grilla de zonas
   * clickeables que solo llevan a ese mismo cartel.
   */
  hasBookableOptions: boolean;
  createBooking: (prefill?: CreatePrefill) => void;
  editBooking: (booking: CalendarBooking) => void;
  cancelBooking: (booking: CalendarBooking) => void;
};

const Context = createContext<BookingActions | null>(null);

/**
 * Owns the booking dialogs for the whole calendar screen.
 *
 * They live here, above the grid, rather than inside each block: the edit action
 * is triggered from a popover, and a dialog rendered inside that popover would
 * unmount the moment the popover closes. Hoisting them also keeps a single
 * instance on the page no matter how many blocks are drawn.
 *
 * The views themselves stay Server Components — they come through as `children`.
 */
export function BookingActionsProvider({
  children,
  viewer,
  options,
  params,
  tz,
}: {
  children: ReactNode;
  viewer: BookingViewer | null;
  options: BookingFormOptions;
  params: CalendarParams;
  tz: string;
}) {
  const router = useRouter();
  const canCreate = canCreateBookings(viewer);

  // `key` fuerza el remount del diálogo en cada apertura: el formulario arranca
  // siempre de `initial` sin un efecto que lo sincronice. `open` va aparte para
  // que la animación de salida alcance a correr antes de desmontar.
  const [session, setSession] = useState<(BookingDialogSession & { key: number }) | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CalendarBooking | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  function openSession(next: BookingDialogSession) {
    setSession({ ...next, key: Date.now() });
    setDialogOpen(true);
  }

  const actions: BookingActions = {
    canCreate,
    hasBookableOptions:
      canCreate && options.projects.length > 0 && options.devs.length > 0,
    createBooking(prefill) {
      // Un carril puede pertenecer a un desarrollador desactivado o a un
      // proyecto archivado: en ese caso el select no lo ofrece, así que el
      // precargado se descarta en vez de dejar un valor que no existe.
      const devId = options.devs.some((dev) => dev.id === prefill?.devId)
        ? prefill!.devId
        : undefined;
      const projectId = options.projects.some(
        (project) => project.id === prefill?.projectId,
      )
        ? prefill!.projectId
        : undefined;

      openSession({
        kind: "create",
        initial: blankForm({
          date: prefill?.date ?? params.date,
          startMinute: prefill?.startMinute ?? WORKDAY_START_HOUR * 60,
          devId,
          projectId,
        }),
      });
    },
    editBooking(booking) {
      openSession({
        kind: "edit",
        bookingId: booking.id,
        snapshot: {
          status: booking.status,
          devId: booking.dev.id,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
        },
        initial: fromBooking(booking, tz),
      });
    },
    cancelBooking(booking) {
      setCancelTarget(booking);
      setCancelOpen(true);
    },
  };

  return (
    <Context.Provider value={actions}>
      {children}

      {session && (
        <BookingDialog
          key={session.key}
          session={session}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={() => {
            setDialogOpen(false);
            router.refresh();
          }}
          options={options}
          tz={tz}
          params={params}
        />
      )}

      {cancelTarget && (
        <CancelBookingDialog
          key={cancelTarget.id}
          booking={cancelTarget}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          onCancelled={() => {
            setCancelOpen(false);
            router.refresh();
          }}
          tz={tz}
        />
      )}
    </Context.Provider>
  );
}

export function useBookingActions(): BookingActions {
  const context = useContext(Context);
  if (!context) {
    throw new Error("useBookingActions necesita estar dentro de BookingActionsProvider");
  }
  return context;
}

/**
 * La única acción primaria de la vista calendario (DESIGN.md §7). Vive en el
 * encabezado cuando hay reservas y en el empty state cuando no las hay — nunca
 * en los dos lugares a la vez.
 */
export function CreateBookingButton({ prefill }: { prefill?: CreatePrefill }) {
  const { canCreate, createBooking } = useBookingActions();
  if (!canCreate) return null;

  return <Button onClick={() => createBooking(prefill)}>Crear reserva</Button>;
}

/**
 * AC-3.1. Cancelar es terminal —una reserva cancelada no se edita ni se
 * reactiva— así que pasa por confirmación, y el texto dice qué deja de estar
 * reservado y qué pasa con la reserva.
 *
 * No se borra nada: cancelar es un `update` de estado. La reserva sigue en el
 * calendario con su tratamiento propio (DESIGN.md §8) y es lo que después
 * audita `010`.
 */
function CancelBookingDialog({
  booking,
  open,
  onOpenChange,
  onCancelled,
  tz,
}: {
  booking: CalendarBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled: () => void;
  tz: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });

      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "No se pudo cancelar la reserva. Probá de nuevo.");
        return;
      }

      onCancelled();
    } catch {
      setError("No se pudo conectar con el servidor. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar la reserva</DialogTitle>
          <DialogDescription>
            {booking.dev.name} deja de tener reservado{" "}
            {formatTimeRange(booking.startsAt, booking.endsAt, tz)} del{" "}
            {formatLongDate(instantToIsoDate(booking.startsAt, tz), tz)} para{" "}
            {booking.project.name}. La reserva queda cancelada en el calendario, no se
            borra.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-ui text-danger">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Volver</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={submitting}>
            {submitting ? "Cancelando…" : "Cancelar reserva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
