import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/api/read-json";
import { requireBookingResponder } from "@/lib/api/require-booking-responder";
import { EXCLUSION_VIOLATION, findConflictingBooking } from "@/lib/bookings/conflicts";
import {
  explainBlockedAction,
  nextStatusAfterResponse,
  TRANSITION_VIOLATION,
} from "@/lib/bookings/transitions";
import type { createClient } from "@/lib/supabase/server";
import { respondBookingSchema } from "@/lib/validation/bookings";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * La reserva cambió entre que el dev la vio y que la respondió (`plan.md` §5).
 *
 * Se relee entera para devolverla en el cuerpo: la bandeja necesita mostrar lo
 * que la reserva dice **ahora**, no lo que decía cuando se abrió, o el dev
 * vuelve a apretar el mismo botón sobre los mismos datos viejos.
 */
async function staleBookingResponse(supabase: SupabaseServerClient, id: string) {
  const { data: booking } = await supabase.from("bookings").select().eq("id", id).maybeSingle();

  return NextResponse.json(
    {
      error: "La reserva cambió desde que la abriste. Revisala antes de responder",
      booking,
    },
    { status: 409 },
  );
}

/**
 * La respuesta del desarrollador (AC-2.1, AC-2.2).
 *
 * Ruta propia y no un `status` más en el PATCH del PM (`plan.md` §4): los dos
 * caminos comparten la tabla y nada más — distinto guard, distinta validación y
 * distinto manejo del conflicto.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = respondBookingSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const guard = await requireBookingResponder(id);
  if (!guard.ok) return guard.response;
  const { supabase, booking } = guard;

  const { status: response, note, expectedUpdatedAt } = parsed.data;

  // ── La carrera contra la edición del PM (F1 de 004, plan.md §5) ────────────
  // Chequeo temprano para el caso común: evita intentar la escritura y responde
  // sin ruido. `Date.parse` trunca a milisegundos, así que esto no es la palabra
  // final — la exacta es el `.eq("updated_at", …)` de más abajo, que además
  // cierra la ventana entre esta lectura y el update.
  if (Date.parse(expectedUpdatedAt) !== Date.parse(booking.updatedAt)) {
    return staleBookingResponse(supabase, id);
  }

  // ── Solo se responde una reserva pendiente (plan.md §3.3) ──────────────────
  const nextStatus = nextStatusAfterResponse(booking.status, response);
  if (!nextStatus) {
    return NextResponse.json(
      { error: explainBlockedAction("respond", booking.status) },
      { status: 409 },
    );
  }

  // No se manda `responded_at`: lo deriva el trigger, y el guard de columnas ni
  // siquiera lo tiene en la whitelist del dev. Mandarlo sería pedir un 403.
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: nextStatus, response_note: note ?? null })
    .eq("id", id)
    // La otra mitad de la protección contra la carrera, esta sí atómica: si el
    // PM escribió entre la lectura de arriba y esta línea, no hay fila que
    // actualizar y la respuesta no se pierde en silencio.
    .eq("updated_at", booking.updatedAt)
    .select()
    .maybeSingle();

  if (error) {
    // El constraint anti doble-booking, que **acá se dispara por primera vez**:
    // solo excluye entre `approved`, así que hasta que alguien aprueba nunca
    // tuvo dos filas que comparar (ADR 0008). No hay chequeo previo a propósito
    // — con dos aprobaciones en paralelo el árbitro tiene que ser el constraint,
    // y traducir el error da el mismo mensaje sin un round trip en el camino
    // feliz.
    if (error.code === EXCLUSION_VIOLATION) {
      const conflict = await findConflictingBooking(supabase, {
        devId: booking.devId,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        excludeId: id,
      });

      return NextResponse.json(
        {
          error: conflict
            ? "Ya tenés aprobada otra reserva en esa franja"
            : "Ya tenés aprobada otra reserva que se superpone con esta",
          conflict,
        },
        { status: 409 },
      );
    }

    // El guard de columnas o la regla de transición del trigger. Es un permiso
    // denegado por la base, no una falla: el mensaje ya viene en castellano y
    // dice exactamente qué se intentó hacer de más.
    if (error.code === TRANSITION_VIOLATION) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Cero filas sin error: el `.eq("updated_at", …)` no encontró nada, así que
  // alguien escribió la reserva en el medio.
  if (!data) return staleBookingResponse(supabase, id);

  return NextResponse.json(data);
}
