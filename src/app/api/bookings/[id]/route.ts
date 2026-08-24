import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireBookingAccess } from "@/lib/api/require-booking-access";
import { EXCLUSION_VIOLATION, findConflictingBooking } from "@/lib/bookings/conflicts";
import {
  canCancel,
  canEdit,
  explainBlockedAction,
  nextStatusAfterEdit,
} from "@/lib/bookings/transitions";
import { createClient } from "@/lib/supabase/server";
import { updateBookingSchema } from "@/lib/validation/bookings";
import type { BookingStatus } from "@/lib/validation/calendar";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = updateBookingSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // La reserva se lee antes del guard: hace falta su `project_id` para saber
  // quién puede tocarla. La lectura es pública para el equipo (003), así que no
  // filtra nada que el usuario no pudiera ver en el calendario.
  const reader = await createClient();
  const { data: current } = await reader
    .from("bookings")
    .select("id, project_id, dev_id, starts_at, ends_at, status")
    .eq("id", id)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 });
  }

  const guard = await requireBookingAccess(current.project_id);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const snapshot = {
    status: current.status as BookingStatus,
    devId: current.dev_id,
    startsAt: current.starts_at,
    endsAt: current.ends_at,
  };

  // ── Cancelación (AC-3.1) ───────────────────────────────────────────────────
  if (parsed.data.status === "cancelled") {
    if (!canCancel(snapshot.status)) {
      return NextResponse.json(
        { error: explainBlockedAction("cancel", snapshot.status) },
        { status: 409 },
      );
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // ── Edición (AC-2.1, AC-2.2) ───────────────────────────────────────────────
  if (!canEdit(snapshot.status)) {
    return NextResponse.json(
      { error: explainBlockedAction("edit", snapshot.status) },
      { status: 409 },
    );
  }

  const { devId, startsAt, endsAt, note, ticketRef } = parsed.data;
  const merged = {
    devId: devId ?? snapshot.devId,
    startsAt: startsAt ?? snapshot.startsAt,
    endsAt: endsAt ?? snapshot.endsAt,
  };

  // Con un solo extremo en el payload, el otro sale de la fila actual: el
  // schema no puede compararlos porque solo ve lo que llegó.
  if (Date.parse(merged.endsAt) <= Date.parse(merged.startsAt)) {
    return NextResponse.json(
      { error: "La reserva tiene que terminar después de empezar" },
      { status: 400 },
    );
  }

  if (devId) {
    const { data: dev } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", devId)
      .maybeSingle();

    if (dev?.role !== "developer") {
      return NextResponse.json(
        { error: "La reserva tiene que asignarse a un usuario con rol desarrollador" },
        { status: 400 },
      );
    }
  }

  // Q-E: mover el horario o cambiar el desarrollador invalida la aprobación;
  // tocar nota o ticket, no.
  const status = nextStatusAfterEdit(snapshot, parsed.data);

  // Mismo caso que en el alta (AC-1.2): mover una reserva *pendiente* encima de
  // una aprobada no dispara el constraint, porque este solo excluye entre
  // aprobadas. Si el horario cambió, hay que preguntarlo explícitamente.
  if (startsAt !== undefined || endsAt !== undefined || devId !== undefined) {
    const conflict = await findConflictingBooking(supabase, {
      devId: merged.devId,
      startsAt: merged.startsAt,
      endsAt: merged.endsAt,
      excludeId: id,
    });

    if (conflict) {
      return NextResponse.json(
        {
          error: `${conflict.devName} ya tiene una reserva aprobada en esa franja`,
          conflict,
        },
        { status: 409 },
      );
    }
  }

  const { data, error } = await supabase
    .from("bookings")
    .update({
      ...(devId !== undefined && { dev_id: devId }),
      ...(startsAt !== undefined && { starts_at: startsAt }),
      ...(endsAt !== undefined && { ends_at: endsAt }),
      ...(note !== undefined && { note }),
      ...(ticketRef !== undefined && { ticket_ref: ticketRef }),
      ...(status !== snapshot.status && { status }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      const conflict = await findConflictingBooking(supabase, {
        devId: merged.devId,
        startsAt: merged.startsAt,
        endsAt: merged.endsAt,
        // Una reserva aprobada no puede entrar en conflicto consigo misma.
        excludeId: id,
      });
      return NextResponse.json(
        {
          error: conflict
            ? `${conflict.devName} ya tiene una reserva aprobada en esa franja`
            : "El desarrollador ya tiene una reserva aprobada que se superpone",
          conflict,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ...data, requiresReapproval: status !== snapshot.status });
}
