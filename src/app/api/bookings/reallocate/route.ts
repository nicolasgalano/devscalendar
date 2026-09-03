import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireBookingAccess } from "@/lib/api/require-booking-access";
import { EXCLUSION_VIOLATION, findConflictingBooking } from "@/lib/bookings/conflicts";
import { REALLOCATION_ERRORS } from "@/lib/bookings/priority";
import { reallocateBookingSchema } from "@/lib/validation/bookings";

/** What `reallocate_booking()` returns: the new booking and what it displaced. */
type ReallocationResult = {
  booking: Record<string, unknown>;
  displaced: Record<string, unknown>[];
};

/**
 * El alta que desplaza (AC-1.1).
 *
 * Ruta propia y no un flag en `POST /api/bookings`, con el precedente de `005`
 * y por tres motivos (`plan.md` §4): la respuesta tiene otra forma —además de
 * la reserva creada devuelve las que pisó—, tiene modos de falla que el alta
 * normal no conoce, y `confirmedDisplacing` obliga al cliente a nombrar lo que
 * acepta desplazar.
 *
 * **Todo el trabajo pasa adentro de `reallocate_booking()`, y no acá.** No es
 * una preferencia de estilo: desplazar es escribir una reserva de otro PM, que
 * la RLS filtra sin fallar —cero filas, sin error—, así que hacerlo desde el
 * handler daría un 201 con dos reservas aprobadas superpuestas y nada en los
 * logs. Ver `plan.md` §3.2, que es el R-1 de la spec.
 */
export async function POST(request: Request) {
  const parsed = reallocateBookingSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { projectId, devId, startsAt, endsAt, note, ticketRef, confirmedDisplacing } = parsed.data;

  // La función chequea lo mismo adentro —tiene que hacerlo, es `security
  // definer`— pero este guard responde con un motivo legible en vez del 500 en
  // que PostgREST convierte una excepción.
  const guard = await requireBookingAccess(projectId);
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const { data, error } = await supabase.rpc("reallocate_booking", {
    target_project: projectId,
    target_dev: devId,
    starts: startsAt,
    ends: endsAt,
    confirmed_displacing: confirmedDisplacing,
    // `undefined` y no `null`: los dos parámetros tienen `default null` en el
    // SQL, y el generador los tipa como opcionales, no como nullables. Un
    // `undefined` desaparece al serializar el body, el argumento no viaja y
    // Postgres aplica su default — que es exactamente lo que queremos.
    booking_note: note ?? undefined,
    ticket: ticketRef ?? undefined,
  });

  if (error) {
    // El conflicto se relee para que el cliente pueda repintar el diálogo con lo
    // que hay **ahora**. Si volviera solo el mensaje, el PM apretaría el mismo
    // botón sobre los mismos datos viejos — la lección de `005` §5.
    const conflict = async () =>
      findConflictingBooking(supabase, { devId, startsAt, endsAt });

    // `reason` es lo que la UI mira, no el texto: T4.3 pide que el empate y la
    // prioridad insuficiente se lean distinto, y un mensaje reescrito no puede
    // ser lo que sostenga esa diferencia.
    switch (error.code) {
      case REALLOCATION_ERRORS.notManager:
        return NextResponse.json({ error: error.message }, { status: 403 });

      case REALLOCATION_ERRORS.insufficient:
        return NextResponse.json(
          { error: error.message, reason: "insufficient", conflict: await conflict() },
          { status: 409 },
        );

      case REALLOCATION_ERRORS.tie:
        return NextResponse.json(
          { error: error.message, reason: "tie", conflict: await conflict() },
          { status: 409 },
        );

      case REALLOCATION_ERRORS.stale:
        return NextResponse.json(
          {
            error: "Lo que ocupa esa franja cambió desde que lo confirmaste. Revisalo",
            reason: "stale",
            conflict: await conflict(),
          },
          { status: 409 },
        );

      case REALLOCATION_ERRORS.invalidTarget:
        return NextResponse.json({ error: error.message }, { status: 400 });

      // Defensa en profundidad: la función inserta `pending`, y el constraint
      // solo excluye entre `approved`, así que hoy no puede dispararse. Si
      // alguna vez pudiera, el constraint es el que manda.
      case EXCLUSION_VIOLATION:
        return NextResponse.json(
          {
            error: "El desarrollador ya tiene una reserva aprobada que se superpone",
            conflict: await conflict(),
          },
          { status: 409 },
        );

      default:
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const result = data as unknown as ReallocationResult;

  return NextResponse.json(result, { status: 201 });
}
