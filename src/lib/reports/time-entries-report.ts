import { createClient } from "@/lib/supabase/server";
import type { ExportQueryInput } from "@/lib/validation/time-entries";

/**
 * Pipeline del reporte "planilla" (021). Un helper único que fetchea desde
 * `time_entries` con todos los embeds que el reporte necesita, aplica los
 * filtros del `exportQuerySchema` y mapea a `ReportRow[]`. Dos serializers
 * (CSV, XLSX) lo consumen — el schema de columnas es el mismo en ambos.
 *
 * **Permisos.** El helper NO filtra por rol: asume que el caller (route
 * handler) ya autorizó. Lo que sí respeta es la RLS de `time_entries`
 * (viewer solo ve lo suyo, PM ve lo de sus proyectos, admin ve todo).
 *
 * **Zona horaria.** Fija en `America/Argentina/Buenos_Aires` por decisión
 * de producto (Q-5 del plan). `logged_at` + `start_time` se componen como
 * "wall clock" en esa TZ y se materializan como `Date` cuyos componentes
 * UTC coinciden con esa wall clock — así los dos serializers muestran la
 * hora que el usuario cargó, sin reconvertir por el TZ del cliente que
 * abre el archivo (mitigación de R-9 del plan).
 */

export type ReportRow = {
  cliente: string;
  proyecto: string;
  usuario: string;
  tarea: string | null;
  fechaInicio: Date;
  fechaFin: Date;
  zonaHoraria: string;
  duracion: string; // "HH:MM"
  horas: number; // minutes / 60, raw. El serializer formatea.
  notas: string | null;
  ticketKey: string | null; // "PROJ-N" o null
  ticketUrl: string | null; // `${NEXT_PUBLIC_SITE_URL}/tickets/<key>` o null
};

export const REPORT_COLUMNS: { key: keyof ReportRow; header: string }[] = [
  { key: "cliente", header: "Cliente" },
  { key: "proyecto", header: "Proyecto" },
  { key: "usuario", header: "Usuario" },
  { key: "tarea", header: "Tarea" },
  { key: "fechaInicio", header: "Fecha inicio" },
  { key: "fechaFin", header: "Fecha fin" },
  { key: "zonaHoraria", header: "Zona horaria" },
  { key: "duracion", header: "Duración" },
  { key: "horas", header: "Horas" },
  { key: "notas", header: "Notas" },
  { key: "ticketKey", header: "Ticket" },
];

const REPORT_TIMEZONE = "America/Argentina/Buenos_Aires";

type ReportEntryRow = {
  minutes: number;
  logged_at: string;
  start_time: string | null;
  description: string | null;
  user: { full_name: string | null; email: string | null } | null;
  project: {
    key: string;
    name: string;
    client: { id: string; name: string } | null;
  };
  ticket: { numero: number } | null;
  activity: { name: string } | null;
};

export async function queryTimeEntriesForReport(
  filters: ExportQueryInput,
): Promise<ReportRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("time_entries")
    .select(
      `
        minutes, logged_at, start_time, description,
        user:profiles!time_entries_user_id_fkey ( full_name, email ),
        project:projects!inner (
          key, name,
          client:clients ( id, name )
        ),
        ticket:tickets ( numero ),
        activity:project_activities ( name )
      `,
    )
    .gte("logged_at", filters.from)
    .lte("logged_at", filters.to)
    .order("logged_at", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: true });

  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.clientId) {
    // Filtro por cliente sobre el embed `!inner` de projects.
    query = query.eq("project.client_id", filters.clientId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? null;

  return (data as unknown as ReportEntryRow[] | null ?? []).map((row) =>
    mapRow(row, baseUrl),
  );
}

function mapRow(row: ReportEntryRow, baseUrl: string | null): ReportRow {
  const startHhmm = row.start_time ?? "00:00";
  const fechaInicio = composeBuenosAiresDate(row.logged_at, startHhmm);
  const fechaFin = new Date(fechaInicio.getTime() + row.minutes * 60_000);

  const ticketKey = row.ticket
    ? `${row.project.key}-${row.ticket.numero}`
    : null;
  const ticketUrl = ticketKey && baseUrl ? `${baseUrl}/tickets/${ticketKey}` : null;

  return {
    cliente: row.project.client?.name ?? "",
    proyecto: row.project.name,
    usuario: row.user?.full_name ?? row.user?.email ?? "",
    tarea: row.activity?.name ?? null,
    fechaInicio,
    fechaFin,
    zonaHoraria: REPORT_TIMEZONE,
    duracion: formatDurationHHMM(row.minutes),
    horas: row.minutes / 60,
    notas: row.description,
    ticketKey,
    ticketUrl,
  };
}

/**
 * Compone `logged_at` (YYYY-MM-DD) + `start_time` (HH:MM[:SS]) en un `Date`
 * cuyos componentes UTC son esos mismos — así los serializers lo muestran
 * sin reconvertir por el TZ del cliente (ver nota de arriba sobre R-9).
 *
 * Fallback: si `start_time` es null (entries previas al rediseño de 016 que
 * sumó la columna), cae a `00:00` — es la decisión documentada en AC-2.4
 * de la spec.
 */
function composeBuenosAiresDate(loggedAt: string, hhmm: string): Date {
  const [y, mo, d] = loggedAt.split("-").map(Number);
  const parts = hhmm.split(":");
  const h = Number(parts[0] ?? "0");
  const min = Number(parts[1] ?? "0");
  return new Date(Date.UTC(y!, (mo ?? 1) - 1, d ?? 1, h, min, 0));
}

function formatDurationHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
