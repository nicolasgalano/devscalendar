import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Feature 029: borrar una estimación de capacidad por id.
 *
 * **Sin guard de ruta** — la RPC `delete_capacity_estimate` resuelve el
 * project_id adentro y valida autorización (admin O PM primario del
 * proyecto). Un guard de ruta exigiría un query previo solo para pasarle el
 * project_id a `requireProjectMembership`, y la RPC igual revalida — es
 * desperdicio.
 *
 * Costo: ante un id bien formado pero inexistente, el handler responde 404
 * vía `DC010`, y ante un id válido ajeno responde 403 vía 42501. El
 * atacante puede distinguir "no existe" de "existe pero no sos dueño"
 * mirando el status — aceptable para datos no sensibles como estimaciones
 * de capacidad.
 *
 * Códigos de la RPC → HTTP:
 *   - DC010 → 404 (estimación no encontrada)
 *   - 42501 → 403 (sin permiso)
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { error } = await supabase.rpc("delete_capacity_estimate", { p_id: id });

  if (error) {
    switch (error.code) {
      case "DC010":
        return NextResponse.json({ error: "Estimación no encontrada" }, { status: 404 });
      case "42501":
        return NextResponse.json(
          { error: "Solo admin o PM primario puede borrar estimaciones" },
          { status: 403 },
        );
      default:
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
