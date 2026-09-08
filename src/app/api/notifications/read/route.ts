import { NextResponse } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/api/read-json";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";

const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

/**
 * Marca notificaciones como leídas.
 *
 * **No hay guard de rol ni de `active`, y es deliberado.** La única regla es "son
 * mías", y esa la impone `mark_notifications_read()` comparando contra
 * `auth.uid()` adentro de la función: mandar ids ajenos no falla, simplemente no
 * afecta ninguna fila. Un usuario desactivado también puede marcar leído lo que
 * ya le llegó — el chequeo de `active` corta lo que podés hacer, no lo que te
 * pasó (misma línea que la policy de lectura, `…0011` §1).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const parsed = markReadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_notifications_read", {
    ids: parsed.data.ids,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ marked: data ?? 0 });
}
