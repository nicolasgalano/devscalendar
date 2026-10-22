import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Descartar el cronómetro corriendo sin guardar nada.
 *
 * A diferencia de `/stop` (que llama al RPC `stop_timer` y crea una
 * `time_entry`), este endpoint **borra la fila de `active_timers`
 * directamente via RLS** (`user_id = auth.uid()` por la policy
 * "active_timers: only own") sin crear registro de tiempo.
 *
 * Por qué existe: en 2026-10-22 apareció un bug donde `getMyActiveTimer`
 * leía una fila (vía RLS con auth.uid()) pero `stop_timer(p_user_id =
 * profile.id)` no la encontraba — y el usuario quedaba con la pill
 * atascada sin forma de pararla, aunque fuera la misma identidad en
 * teoría. Este endpoint sale del medio y ataca la fila directo con el
 * mismo criterio que la lee la UI.
 *
 * Idempotente: si no hay fila, DELETE no afecta nada y responde 200.
 */
export async function POST() {
  const supabase = await createClient();

  // PostgREST exige un filtro para DELETE. El `.neq` con un UUID imposible
  // matchea todas las filas existentes; la RLS ("active_timers: only own",
  // `user_id = auth.uid()`) la restringe a la del usuario — exactamente la
  // que la pill vio.
  const { error } = await supabase
    .from("active_timers")
    .delete()
    .neq("user_id", "00000000-0000-0000-0000-000000000000");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
