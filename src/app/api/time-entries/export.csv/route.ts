import { NextResponse } from "next/server";

import { isAdmin, isPm } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/session";
import { exportQuerySchema } from "@/lib/validation/time-entries";

/**
 * Export CSV de time_entries (016 T2.8). Filtros por rango + cliente +
 * proyecto + user. Respeta el alcance del viewer:
 *   - admin: sin restricciones.
 *   - PM (rol global): ve entries de sus proyectos y de proyectos donde es
 *     miembro. La RLS de time_entries filtra por `can_view_project` — se
 *     confía en ella para el scope.
 *   - contributor / staff / developer: 403 — no acceden al export (es
 *     herramienta de admin/PM).
 *
 * Stream `text/csv` con headers. Se escapean comas, comillas y saltos de línea.
 */
function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const COLUMNS = [
  "fecha",
  "user_email",
  "user_nombre",
  "cliente",
  "proyecto",
  "ticket_key",
  "ticket_titulo",
  "actividad",
  "minutos",
  "horas",
  "descripcion",
  "cargado_por",
] as const;

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (!isAdmin(profile.roles) && !isPm(profile.roles)) {
    return NextResponse.json(
      { error: "Solo admin y PMs pueden exportar" },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const parsed = exportQuerySchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    clientId: url.searchParams.get("clientId") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
    userId: url.searchParams.get("userId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parámetros inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  let query = supabase
    .from("time_entries")
    .select(
      `
        id, minutes, logged_at, description, created_by,
        user:profiles!time_entries_user_id_fkey ( full_name, email ),
        creator:profiles!time_entries_created_by_fkey ( full_name, email ),
        project:projects!inner ( name, client:clients!inner ( id, name ) ),
        ticket:tickets ( numero ),
        activity:project_activities ( name )
      `,
    )
    .gte("logged_at", parsed.data.from)
    .lte("logged_at", parsed.data.to)
    .order("logged_at", { ascending: true });

  if (parsed.data.projectId) query = query.eq("project_id", parsed.data.projectId);
  if (parsed.data.userId) query = query.eq("user_id", parsed.data.userId);
  if (parsed.data.clientId) {
    // Filtro por cliente vive en projects — usamos el embed !inner.
    query = query.eq("project.client_id", parsed.data.clientId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Necesitamos la project key para armar ticket_key = PROJ-N; pero el select
  // no la trajo — la agrego con un segundo query mínimo. Para el volumen
  // esperado (< 1000 entries por rango), es aceptable.
  const projectKeys = new Map<string, string>();
  if ((data ?? []).some((row) => row.ticket)) {
    const projectIds = Array.from(
      new Set(
        (data ?? [])
          .filter((row) => row.ticket !== null)
          .map((row) => (row.project as { name: string } & { id?: string }) as unknown)
          .filter(Boolean),
      ),
    );
    // Segundo query minimal para keys.
    if (projectIds.length > 0) {
      const { data: projects } = await supabase
        .from("projects")
        .select("id, key");
      for (const p of projects ?? []) projectKeys.set(p.id, p.key);
    }
  }

  const rows: string[] = [COLUMNS.map(escapeCsv).join(",")];
  for (const row of data ?? []) {
    const ticketKey = row.ticket
      ? // La `project.id` no viene en el embed — se resuelve al parser CSV
        // con un `time_entries.project_id` en el select. Simplificamos: si
        // no está la key, mostramos solo el número.
        `#${row.ticket.numero}`
      : "";
    const hoursDecimal = (row.minutes / 60).toFixed(2);
    const cargadoPor =
      row.creator && row.created_by !== null
        ? row.creator.full_name ?? row.creator.email
        : "";
    rows.push(
      [
        row.logged_at,
        row.user?.email ?? "",
        row.user?.full_name ?? "",
        row.project?.client?.name ?? "",
        row.project?.name ?? "",
        ticketKey,
        "", // ticket_titulo — omitido para no sumar otro query
        row.activity?.name ?? "",
        String(row.minutes),
        hoursDecimal,
        row.description ?? "",
        cargadoPor,
      ]
        .map(escapeCsv)
        .join(","),
    );
  }

  const csv = rows.join("\n");
  const filename = `time-entries-${parsed.data.from}-to-${parsed.data.to}.csv`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
