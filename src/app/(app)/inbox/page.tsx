import { PageHeader } from "@/components/page-header";
import { getPendingBookingsForDev } from "@/lib/calendar/query";
import { todayInTimeZone } from "@/lib/calendar/range";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import { parseCalendarParams } from "@/lib/validation/calendar";

import { InboxList } from "./inbox-list";

export const dynamic = "force-dynamic";

// Q-10: mismo default que el calendario. La conversión a hora local vive en un
// solo lugar y esta pantalla la hereda.
const TIMEZONE = "America/Argentina/Buenos_Aires";

export default async function InboxPage() {
  // El layout ya garantizó rol `developer`, y `getCurrentProfile()` está
  // memorizada: esto reusa lo que resolvió el guard.
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const bookings = await getPendingBookingsForDev(supabase, profile.id);

  return (
    <>
      <PageHeader
        title="Reservas pendientes"
        description="Lo que te reservaron y todavía no respondiste."
      />
      {/* Params por default: la bandeja no es filtrable, pero el aviso de
          conflicto linkea al día del calendario y necesita desde dónde
          construir ese href. `parseCalendarParams` nunca tira. */}
      <InboxList
        bookings={bookings}
        params={parseCalendarParams({}, { today: todayInTimeZone(TIMEZONE) })}
        tz={TIMEZONE}
      />
    </>
  );
}
