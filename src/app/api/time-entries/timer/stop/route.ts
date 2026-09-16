import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";

/**
 * Parar cronómetro (016 T2.6). Llama a la RPC `stop_timer` que atómicamente
 * calcula los minutos (mínimo 15, redondeado a múltiplo de 15), crea la
 * time_entry y borra la fila de active_timers. Devuelve el id de la entry
 * creada o `null` si no había timer.
 */
export async function POST() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("stop_timer", {
    p_user_id: profile.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data === null) {
    return NextResponse.json(
      { error: "No hay cronómetro corriendo", reason: "no_timer" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, entry_id: data });
}
