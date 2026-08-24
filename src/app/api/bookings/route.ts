import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireBookingAccess } from "@/lib/api/require-booking-access";
import { EXCLUSION_VIOLATION, findConflictingBooking } from "@/lib/bookings/conflicts";
import { createBookingSchema } from "@/lib/validation/bookings";

export async function POST(request: Request) {
  const parsed = createBookingSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { projectId, devId, startsAt, endsAt, note, ticketRef } = parsed.data;

  const guard = await requireBookingAccess(projectId);
  if (!guard.ok) return guard.response;
  const { supabase, userId } = guard;

  // Mismo criterio que `projects.pm_id` en 002: Postgres no puede exigir que la
  // FK apunte a un profile con cierto rol, así que se valida acá.
  const { data: dev } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", devId)
    .maybeSingle();

  if (dev?.role !== "developer") {
    return NextResponse.json(
      { error: "La reserva tiene que asignarse a un usuario con rol desarrollador" },
      { status: 400 },
    );
  }

  if (!dev.active) {
    return NextResponse.json(
      { error: "Ese desarrollador está desactivado" },
      { status: 400 },
    );
  }

  /**
   * AC-1.2: no se puede proponer una franja donde el desarrollador ya tiene un
   * compromiso confirmado.
   *
   * Esto **no** lo cubre el `exclusion constraint`, y conviene entender por qué:
   * toda reserva nace `pending`, y el constraint solo excluye entre `approved`.
   * O sea que el constraint nunca se dispara en un alta. Hace falta este chequeo
   * explícito.
   *
   * Es un chequeo aplicativo, con la ventana de carrera que eso implica: entre
   * el `select` y el `insert` alguien podría aprobar otra reserva. La
   * consecuencia sería una `pending` superpuesta a una `approved`, que es
   * exactamente lo que AC-4.2 permite y lo que el constraint va a bloquear
   * cuando el dev intente aprobarla (feature 005). La garantía dura sigue
   * estando donde tiene que estar; esto es para no hacerle perder el viaje al PM.
   */
  const conflict = await findConflictingBooking(supabase, { devId, startsAt, endsAt });
  if (conflict) {
    return NextResponse.json(
      {
        error: `${conflict.devName} ya tiene una reserva aprobada en esa franja`,
        conflict,
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      project_id: projectId,
      dev_id: devId,
      created_by: userId,
      starts_at: startsAt,
      ends_at: endsAt,
      note: note ?? null,
      ticket_ref: ticketRef ?? null,
      // AC-1.1: nace pendiente. El estado no se acepta del cliente.
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    // Defensa en profundidad: hoy no puede dispararse en un alta (la reserva
    // nace `pending`), pero si alguna vez se insertara ya aprobada, el
    // constraint es el que manda y la respuesta tiene que ser la misma.
    if (error.code === EXCLUSION_VIOLATION) {
      const raced = await findConflictingBooking(supabase, { devId, startsAt, endsAt });
      return NextResponse.json(
        {
          error: raced
            ? `${raced.devName} ya tiene una reserva aprobada en esa franja`
            : "El desarrollador ya tiene una reserva aprobada que se superpone",
          conflict: raced,
        },
        { status: 409 },
      );
    }

    if (error.code === "23503") {
      return NextResponse.json({ error: "Proyecto o desarrollador inválido" }, { status: 400 });
    }

    if (error.code === "23514") {
      return NextResponse.json(
        { error: "La reserva tiene que terminar después de empezar" },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
