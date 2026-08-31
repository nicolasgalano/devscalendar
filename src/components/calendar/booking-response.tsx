"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ConflictNotice } from "@/components/calendar/booking-conflict";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BookingConflict } from "@/lib/bookings/conflicts";
import { formatLongDate, formatTimeRange } from "@/lib/calendar/format";
import type { CalendarBooking } from "@/lib/calendar/query";
import { instantToIsoDate } from "@/lib/calendar/range";
import type { CalendarParams } from "@/lib/validation/calendar";

/**
 * Por qué el conflicto se le cuenta al dev en primera persona: la reserva que
 * bloquea es **suya**. "Malena ya tiene una reserva aprobada" cuando Malena sos
 * vos suena a que el problema es de otro.
 */
const CONFLICT_TITLE = "Ya tenés aprobada otra reserva en esa franja";

/** Lo que sale mal al responder, y que hay que contar en palabras (§8). */
type ResponseProblem =
  | { kind: "conflict"; conflict: BookingConflict | null; message: string }
  | { kind: "stale"; message: string }
  | { kind: "error"; message: string };

type BookingResponse = {
  /** AC-2.1: aprobar es un clic, sin diálogo. */
  approve: (booking: CalendarBooking) => void;
  /** AC-2.2: rechazar siempre pasa por el diálogo, porque el motivo es obligatorio. */
  reject: (booking: CalendarBooking) => void;
  /** Id de la reserva que está viajando, para el estado ocupado del botón. */
  busyId: string | null;
};

const Context = createContext<BookingResponse | null>(null);

export function useBookingResponse(): BookingResponse {
  const context = useContext(Context);
  if (!context) {
    throw new Error("useBookingResponse necesita estar dentro de BookingResponseProvider");
  }
  return context;
}

async function sendResponse(
  booking: CalendarBooking,
  body: { status: "approved" | "rejected"; note?: string },
): Promise<ResponseProblem | null> {
  let response: Response;
  try {
    response = await fetch(`/api/bookings/${booking.id}/response`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // plan.md §5: el `updated_at` que la vista tenía viaja de vuelta, y el
      // handler lo compara antes de escribir.
      body: JSON.stringify({ ...body, expectedUpdatedAt: booking.updatedAt }),
    });
  } catch {
    return { kind: "error", message: "No se pudo conectar con el servidor. Probá de nuevo." };
  }

  if (response.ok) return null;

  const payload = await response.json().catch(() => ({}));
  const message = typeof payload.error === "string" ? payload.error : null;

  if (response.status === 409) {
    // Las dos 409 son distintas y se resuelven distinto: una manda a mirar la
    // otra reserva, la otra manda a volver a leer esta.
    if (payload.conflict !== undefined) {
      return {
        kind: "conflict",
        conflict: payload.conflict ?? null,
        message: message ?? CONFLICT_TITLE,
      };
    }
    return {
      kind: "stale",
      message: message ?? "La reserva cambió desde que la abriste. Revisala antes de responder",
    };
  }

  return { kind: "error", message: message ?? "No se pudo responder la reserva. Probá de nuevo." };
}

/**
 * Hospeda los diálogos de la respuesta del desarrollador para toda una
 * pantalla, igual que `BookingActionsProvider` hace con los de la reserva y por
 * el mismo motivo: en el calendario el rechazo se dispara desde un popover, y
 * un diálogo montado adentro de ese popover se desmontaría al cerrarse.
 *
 * Lo usan las dos superficies —la bandeja y la grilla— para que aprobar sea la
 * misma operación en los dos lados: mismo endpoint, mismos errores traducidos y
 * mismo diálogo de rechazo.
 */
export function BookingResponseProvider({
  children,
  params,
  tz,
}: {
  children: ReactNode;
  params: CalendarParams;
  tz: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CalendarBooking | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [problem, setProblem] = useState<ResponseProblem | null>(null);

  async function submit(booking: CalendarBooking, note?: string) {
    setBusyId(booking.id);
    try {
      const failure = await sendResponse(
        booking,
        note === undefined ? { status: "approved" } : { status: "rejected", note },
      );

      if (failure) {
        setProblem(failure);
        // Si la reserva quedó vieja, refrescar es parte de la respuesta y no
        // una cortesía: el próximo intento tiene que salir con el `updated_at`
        // nuevo o vuelve a rebotar por lo mismo.
        if (failure.kind === "stale") router.refresh();
        return false;
      }

      router.refresh();
      return true;
    } finally {
      setBusyId(null);
    }
  }

  const value: BookingResponse = {
    busyId,
    approve(booking) {
      void submit(booking);
    },
    reject(booking) {
      setRejectTarget(booking);
      setRejectOpen(true);
    },
  };

  return (
    <Context.Provider value={value}>
      {children}

      {rejectTarget && (
        <RejectBookingDialog
          key={rejectTarget.id}
          booking={rejectTarget}
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          onSubmit={async (note) => {
            const ok = await submit(rejectTarget, note);
            if (ok) setRejectOpen(false);
          }}
          busy={busyId === rejectTarget.id}
          tz={tz}
        />
      )}

      <ResponseProblemDialog
        problem={problem}
        onClose={() => setProblem(null)}
        params={params}
        tz={tz}
      />
    </Context.Provider>
  );
}

/**
 * AC-2.2 — el comentario es obligatorio al rechazar (acordado el 2026-08-12).
 *
 * DESIGN.md §7 y misma decisión que `004` T3.1: **se valida al usar el botón,
 * no deshabilitándolo.** Un botón apagado no dice por qué lo está; uno que
 * responde "escribí el motivo" sí.
 */
function RejectBookingDialog({
  booking,
  open,
  onOpenChange,
  onSubmit,
  busy,
  tz,
}: {
  booking: CalendarBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (note: string) => void;
  busy: boolean;
  tz: string;
}) {
  const fieldId = useId();
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);

  function attempt() {
    if (note.trim().length === 0) {
      setMissing(true);
      return;
    }
    setMissing(false);
    onSubmit(note.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rechazar la reserva</DialogTitle>
          <DialogDescription>
            {booking.project.name} · {booking.project.client.name},{" "}
            {formatTimeRange(booking.startsAt, booking.endsAt, tz)} del{" "}
            {formatLongDate(instantToIsoDate(booking.startsAt, tz), tz)}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${fieldId}-note`}>Motivo</Label>
          <Textarea
            id={`${fieldId}-note`}
            value={note}
            placeholder="Esa semana estoy con el release de facturación"
            maxLength={500}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? `${fieldId}-error` : undefined}
            onChange={(event) => {
              setNote(event.target.value);
              if (missing) setMissing(false);
            }}
          />
          {/* El motivo es lo único que el PM va a tener para replanificar: sin
              él, "no puedo" lo obliga a preguntar por otro canal, que es
              justo lo que la app viene a evitar. */}
          <p
            id={missing ? `${fieldId}-error` : undefined}
            role={missing ? "alert" : undefined}
            className={missing ? "text-ui text-danger" : "text-caption text-muted-foreground"}
          >
            {missing
              ? "Escribí el motivo del rechazo"
              : "El PM lo necesita para reasignar la reserva."}
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Volver</DialogClose>
          <Button variant="destructive" onClick={attempt} disabled={busy}>
            {busy ? "Rechazando…" : "Rechazar reserva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * T4.6 — el 409 del constraint y el de la carrera, en palabras.
 *
 * Los dos son diálogos y no un cartel al pie porque la respuesta se puede
 * disparar desde el popover del calendario, que se cierra al hacer clic: un
 * error renderizado ahí adentro desaparecería con él.
 */
function ResponseProblemDialog({
  problem,
  onClose,
  params,
  tz,
}: {
  problem: ResponseProblem | null;
  onClose: () => void;
  params: CalendarParams;
  tz: string;
}) {
  return (
    <Dialog open={problem !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {problem?.kind === "conflict"
              ? "No se pudo aprobar"
              : problem?.kind === "stale"
                ? "La reserva cambió"
                : "No se pudo responder"}
          </DialogTitle>
          <DialogDescription>
            {problem?.kind === "conflict"
              ? "Aprobarla te dejaría con dos reservas encima de la misma franja."
              : problem?.kind === "stale"
                ? "El PM la editó mientras la mirabas, así que la respuesta no se guardó. Revisá el horario nuevo antes de contestar."
                : (problem?.message ?? "")}
          </DialogDescription>
        </DialogHeader>

        {problem?.kind === "conflict" && problem.conflict && (
          <ConflictNotice
            conflict={problem.conflict}
            title={problem.message}
            params={params}
            tz={tz}
          />
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Entendido</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Las dos acciones, juntas, para no repetirlas entre la bandeja y el popover.
 *
 * DESIGN.md §7: `Aprobar` es la acción primaria; `Rechazar` es secundaria con
 * texto en `--danger` — nunca un botón rojo sólido fuera de un diálogo de
 * confirmación.
 */
export function BookingResponseActions({
  booking,
  size = "sm",
}: {
  booking: CalendarBooking;
  size?: "sm" | "default";
}) {
  const { approve, reject, busyId } = useBookingResponse();
  const busy = busyId === booking.id;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button size={size} onClick={() => approve(booking)} disabled={busy}>
        {busy ? "Aprobando…" : "Aprobar"}
      </Button>
      <Button
        variant="ghost"
        size={size}
        className="text-danger"
        onClick={() => reject(booking)}
        disabled={busy}
      >
        Rechazar
      </Button>
    </div>
  );
}
