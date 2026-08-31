import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import type { BookingStatus } from "@/lib/validation/calendar";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** La reserva que se está respondiendo, ya en el vocabulario del handler. */
export type RespondableBooking = {
  id: string;
  projectId: string;
  devId: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  updatedAt: string;
};

export type BookingResponderGuard =
  | {
      ok: true;
      supabase: SupabaseServerClient;
      userId: string;
      booking: RespondableBooking;
    }
  | { ok: false; response: NextResponse };

/**
 * Verifica que quien llama sea el desarrollador asignado a la reserva, que es
 * el único que puede responderla (`plan.md` §4).
 *
 * Hermano de `requireBookingAccess()`, con **una diferencia que importa: acá el
 * admin no es un atajo.** En el resto de la app el rol admin pasa por arriba de
 * cualquier chequeo de pertenencia, pero aprobar no es una operación
 * administrativa: es un compromiso personal sobre el tiempo de alguien. El
 * trigger de la base dice lo mismo —compara `auth.uid()` contra `dev_id`, sin
 * mirar el rol— así que un admin que se saltara este guard igual chocaría
 * contra un `check_violation`. Mejor un 403 legible que ese 403 traducido.
 *
 * Un admin que además **es** el desarrollador asignado sí puede responder: el
 * chequeo es de identidad, no de rol.
 *
 * Devuelve la reserva ya leída porque el handler la necesita entera —estado
 * para la transición, `updated_at` para la carrera de `plan.md` §5, franja para
 * el conflicto— y volver a pedirla sería un round trip regalado.
 */
export async function requireBookingResponder(bookingId: string): Promise<BookingResponderGuard> {
  const profile = await getCurrentProfile();

  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No autenticado" }, { status: 401 }),
    };
  }

  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, project_id, dev_id, starts_at, ends_at, status, updated_at")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 }),
    };
  }

  if (booking.dev_id !== profile.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Solo el desarrollador asignado puede responder esta reserva" },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    supabase,
    userId: profile.id,
    booking: {
      id: booking.id,
      projectId: booking.project_id,
      devId: booking.dev_id,
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      status: booking.status as BookingStatus,
      updatedAt: booking.updated_at,
    },
  };
}
