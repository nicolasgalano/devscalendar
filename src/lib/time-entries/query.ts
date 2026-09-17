import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type TimeEntryRow = Database["public"]["Tables"]["time_entries"]["Row"];
type ActiveTimerRow = Database["public"]["Tables"]["active_timers"]["Row"];

/**
 * Fila del listado "Mi Semana" y del detalle del ticket. Los joins traen
 * project, ticket, actividad, autor y `created_by` para que el UI decida
 * qué mostrar sin re-query.
 */
export type TimeEntryListItem = {
  id: string;
  userId: string;
  userName: string;
  createdBy: string | null;
  createdByName: string | null;
  minutes: number;
  loggedAt: string;
  /** 016 T8: hora del día en que arrancó ese bloque (HH:MM). Null para
   *  entries viejas o cargas sin hora exacta. */
  startTime: string | null;
  description: string | null;
  project: { id: string; name: string; key: string };
  ticket: { id: string; numero: number; title: string } | null;
  activity: { id: string; name: string; active: boolean } | null;
  createdAt: string;
  updatedAt: string;
};

type EmbedShape = TimeEntryRow & {
  user: { full_name: string | null; email: string } | null;
  creator: { full_name: string | null; email: string } | null;
  project: { id: string; name: string; key: string } | null;
  ticket: { id: string; numero: number; title: string } | null;
  activity: { id: string; name: string; active: boolean } | null;
};

const ENTRY_SELECT = `
  id, user_id, created_by, minutes, logged_at, start_time, description, created_at, updated_at,
  user:profiles!time_entries_user_id_fkey ( full_name, email ),
  creator:profiles!time_entries_created_by_fkey ( full_name, email ),
  project:projects!inner ( id, name, key ),
  ticket:tickets ( id, numero, title ),
  activity:project_activities ( id, name, active )
` as const;

function toListItem(row: EmbedShape): TimeEntryListItem {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user?.full_name ?? row.user?.email ?? row.user_id,
    createdBy: row.created_by,
    createdByName:
      row.creator && row.created_by !== null
        ? row.creator.full_name ?? row.creator.email
        : null,
    minutes: row.minutes,
    loggedAt: row.logged_at,
    // start_time viene como "HH:MM:SS" desde Postgres; el UI usa HH:MM. Se
    // normaliza acortando.
    startTime: row.start_time ? row.start_time.slice(0, 5) : null,
    description: row.description,
    project: {
      id: row.project!.id,
      name: row.project!.name,
      key: row.project!.key,
    },
    ticket: row.ticket
      ? { id: row.ticket.id, numero: row.ticket.numero, title: row.ticket.title }
      : null,
    activity: row.activity
      ? { id: row.activity.id, name: row.activity.name, active: row.activity.active }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Entries de una semana (lunes → domingo) para un user. La RLS filtra por
 * `can_view_project`, así que un admin viendo la semana de otro user sí ve
 * sus entries si tiene acceso a los proyectos correspondientes.
 *
 * Cacheado por request.
 */
export const getTimeEntriesForWeek = cache(
  async (userId: string, weekStart: string, weekEndInclusive: string): Promise<TimeEntryListItem[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("time_entries")
      .select(ENTRY_SELECT)
      .eq("user_id", userId)
      .gte("logged_at", weekStart)
      .lte("logged_at", weekEndInclusive)
      .order("logged_at", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as unknown as EmbedShape[]).map(toListItem);
  },
);

/**
 * Entries de un ticket específico — para la sección "Horas cargadas" del
 * detalle. Cualquier miembro del proyecto ve todas las entries del ticket.
 */
export const getTimeEntriesForTicket = cache(
  async (ticketId: string): Promise<TimeEntryListItem[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("time_entries")
      .select(ENTRY_SELECT)
      .eq("ticket_id", ticketId)
      .order("logged_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as unknown as EmbedShape[]).map(toListItem);
  },
);

/**
 * Cronómetro activo del usuario logueado, si hay. `useSyncIndicator` en el
 * cliente pueden reflejar el estado.
 */
export type ActiveTimer = {
  userId: string;
  projectId: string;
  projectName: string;
  ticketId: string | null;
  ticketKey: string | null;
  ticketTitle: string | null;
  activityId: string | null;
  activityName: string | null;
  startedAt: string;
};

type ActiveTimerEmbed = ActiveTimerRow & {
  project: { name: string; key: string } | null;
  ticket: { numero: number; title: string } | null;
  activity: { name: string } | null;
};

export const getMyActiveTimer = cache(async (): Promise<ActiveTimer | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("active_timers")
    .select(
      `
        user_id, project_id, ticket_id, activity_id, started_at,
        project:projects!inner ( name, key ),
        ticket:tickets ( numero, title ),
        activity:project_activities ( name )
      `,
    )
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as ActiveTimerEmbed;
  const projectKey = row.project?.key ?? "";
  return {
    userId: row.user_id,
    projectId: row.project_id,
    projectName: row.project?.name ?? "",
    ticketId: row.ticket_id,
    ticketKey: row.ticket ? `${projectKey}-${row.ticket.numero}` : null,
    ticketTitle: row.ticket?.title ?? null,
    activityId: row.activity_id,
    activityName: row.activity?.name ?? null,
    startedAt: row.started_at,
  };
});

/**
 * Proyectos donde el usuario puede cargar tiempo — para el `<Select>` del
 * dialog de alta. Se filtra al server side por `can_view_project` + `active`.
 * Un miembro de un proyecto inactivo lo ve para editar entries viejas, pero
 * no aparece acá porque no debería cargar nuevas.
 */
export type ProjectForLogging = {
  id: string;
  key: string;
  name: string;
  clientName: string | null;
};

export const getMyLoggableProjects = cache(async (): Promise<ProjectForLogging[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, key, name, active, client:clients ( name )")
    .eq("active", true)
    .order("name", { ascending: true });
  if (error) throw error;
  // La RLS ya filtró — quedaron solo los que puedo ver.
  return (data ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    clientName: row.client?.name ?? null,
  }));
});

/**
 * 016 T7.1 — horas cargadas contra los tickets de un sprint, live-queried.
 * Comparación con estimadas se hace en el componente que consume esto (tiene
 * el snapshot del reporte de sprint).
 *
 * El rango de fechas es `[sprint.starts_at, min(sprint.closed_at, today)]`
 * — para sprints activos, entries de "hoy" cuentan; para cerrados, se corta
 * en la fecha de cierre (una entry cargada post-cierre a fecha post-cierre
 * NO cuenta como del sprint; una cargada post-cierre a fecha PRE-cierre sí
 * — la fecha de la entry es la que manda).
 */
export type SprintActualHours = {
  totalMinutes: number;
  byUser: Array<{ userId: string; userName: string; minutes: number }>;
};

export async function getSprintActualHours(
  sprintId: string,
  startsAt: string,
  closedAtOrNow: string,
): Promise<SprintActualHours> {
  const supabase = await createClient();

  // Traigo las entries cuyos tickets pertenecen al sprint. Filtro por fecha
  // en el rango del sprint. El `tickets!inner` con `.eq("tickets.sprint_id", ...)`
  // podría matchear solo los actuales; para el reporte queremos los que
  // ESTUVIERON en el sprint en algún momento — pero el snapshot ya guarda
  // eso, y post-cierre los tickets se mueven al siguiente sprint. Para el
  // MVP: solo tickets que ESTÁN en el sprint AHORA. Follow-up si el reporte
  // se ve inconsistente con el snapshot.
  const { data, error } = await supabase
    .from("time_entries")
    .select(
      `
        user_id, minutes,
        user:profiles!time_entries_user_id_fkey ( full_name, email ),
        ticket:tickets!inner ( sprint_id )
      `,
    )
    .eq("ticket.sprint_id", sprintId)
    .gte("logged_at", startsAt)
    .lte("logged_at", closedAtOrNow);

  if (error) throw error;

  const buckets = new Map<string, { userName: string; minutes: number }>();
  let totalMinutes = 0;
  for (const row of (data ?? []) as unknown as Array<{
    user_id: string;
    minutes: number;
    user: { full_name: string | null; email: string } | null;
  }>) {
    totalMinutes += row.minutes;
    const name = row.user?.full_name ?? row.user?.email ?? row.user_id;
    const existing = buckets.get(row.user_id);
    if (existing) {
      existing.minutes += row.minutes;
    } else {
      buckets.set(row.user_id, { userName: name, minutes: row.minutes });
    }
  }

  const byUser = Array.from(buckets.entries())
    .map(([userId, { userName, minutes }]) => ({ userId, userName, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  return { totalMinutes, byUser };
}

// Reportes ─────────────────────────────────────────────────────

/**
 * Reporte de consumo (016 US-9): total de horas cargadas en un rango,
 * agrupado por Cliente > Proyecto > Persona.
 *
 * Filtros opcionales: clientId, projectId, userId. Sin filtros el scope lo
 * pone la RLS (admin ve todo, PM sus proyectos + membresías).
 */
export type ConsumoRow = {
  clientId: string | null;
  clientName: string;
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  totalMinutes: number;
};

export const getConsumoReport = cache(
  async (filters: {
    from: string;
    to: string;
    clientId?: string | null;
    projectId?: string | null;
    userId?: string | null;
  }): Promise<ConsumoRow[]> => {
    const supabase = await createClient();

    let query = supabase
      .from("time_entries")
      .select(
        `
          user_id, minutes, project_id,
          user:profiles!time_entries_user_id_fkey ( full_name, email ),
          project:projects!inner ( id, name, client_id, client:clients ( id, name ) )
        `,
      )
      .gte("logged_at", filters.from)
      .lte("logged_at", filters.to);

    if (filters.projectId) query = query.eq("project_id", filters.projectId);
    if (filters.userId) query = query.eq("user_id", filters.userId);
    if (filters.clientId) query = query.eq("project.client_id", filters.clientId);

    const { data, error } = await query;
    if (error) throw error;

    // Agregación en cliente — para el volumen esperado (< 5k entries por mes)
    // es más simple que armar la agregación en Postgres. Si crece, se migra
    // a un `select project_id, user_id, sum(minutes) group by`.
    const bucket = new Map<string, ConsumoRow>();
    for (const row of (data ?? []) as unknown as Array<{
      user_id: string;
      minutes: number;
      project_id: string;
      user: { full_name: string | null; email: string } | null;
      project: {
        id: string;
        name: string;
        client_id: string | null;
        client: { id: string; name: string } | null;
      };
    }>) {
      const key = `${row.project_id}|${row.user_id}`;
      const existing = bucket.get(key);
      if (existing) {
        existing.totalMinutes += row.minutes;
      } else {
        bucket.set(key, {
          clientId: row.project.client?.id ?? null,
          clientName: row.project.client?.name ?? "Sin cliente",
          projectId: row.project.id,
          projectName: row.project.name,
          userId: row.user_id,
          userName: row.user?.full_name ?? row.user?.email ?? row.user_id,
          totalMinutes: row.minutes,
        });
      }
    }

    return Array.from(bucket.values()).sort((a, b) => {
      const clientCmp = a.clientName.localeCompare(b.clientName, "es-AR");
      if (clientCmp !== 0) return clientCmp;
      const projectCmp = a.projectName.localeCompare(b.projectName, "es-AR");
      if (projectCmp !== 0) return projectCmp;
      return a.userName.localeCompare(b.userName, "es-AR");
    });
  },
);

/**
 * Reporte plan-vs-real (016 US-10): horas comprometidas (`bookings.duration`
 * con status approved) vs cargadas (`time_entries.minutes`), agrupado por
 * (proyecto × persona) en el rango.
 *
 * Dos queries agregadas — una a bookings, una a time_entries — y se unen en
 * cliente. Sin join transitorio para no arrastrar filtros.
 */
export type PlanVsRealRow = {
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  planMinutes: number;
  realMinutes: number;
};

export const getPlanVsRealReport = cache(
  async (filters: {
    from: string;
    to: string;
    clientId?: string | null;
    projectId?: string | null;
    userId?: string | null;
  }): Promise<PlanVsRealRow[]> => {
    const supabase = await createClient();

    // Query 1: bookings aprobados en el rango — suma de duración por
    // (proyecto × dev).
    let bookingsQuery = supabase
      .from("bookings")
      .select(
        `
          dev_id, starts_at, ends_at, project_id,
          dev:profiles!bookings_dev_id_fkey ( full_name, email ),
          project:projects!inner ( id, name, client_id )
        `,
      )
      .eq("status", "approved")
      .gte("starts_at", `${filters.from}T00:00:00`)
      .lte("starts_at", `${filters.to}T23:59:59`);

    if (filters.projectId) bookingsQuery = bookingsQuery.eq("project_id", filters.projectId);
    if (filters.userId) bookingsQuery = bookingsQuery.eq("dev_id", filters.userId);
    if (filters.clientId) bookingsQuery = bookingsQuery.eq("project.client_id", filters.clientId);

    const { data: bookingsData, error: bookingsError } = await bookingsQuery;
    if (bookingsError) throw bookingsError;

    // Query 2: time entries en el rango — reuso de la lógica del consumo
    // pero devuelvo solo lo necesario.
    const consumo = await getConsumoReport(filters);

    // Merge en un solo mapa por (projectId × userId).
    const bucket = new Map<string, PlanVsRealRow>();

    // Sumar plan de bookings.
    for (const row of (bookingsData ?? []) as unknown as Array<{
      dev_id: string;
      starts_at: string;
      ends_at: string;
      project_id: string;
      dev: { full_name: string | null; email: string } | null;
      project: { id: string; name: string };
    }>) {
      const start = new Date(row.starts_at);
      const end = new Date(row.ends_at);
      const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
      const key = `${row.project_id}|${row.dev_id}`;
      const existing = bucket.get(key);
      if (existing) {
        existing.planMinutes += durationMin;
      } else {
        bucket.set(key, {
          projectId: row.project.id,
          projectName: row.project.name,
          userId: row.dev_id,
          userName: row.dev?.full_name ?? row.dev?.email ?? row.dev_id,
          planMinutes: durationMin,
          realMinutes: 0,
        });
      }
    }

    // Sumar real del consumo.
    for (const row of consumo) {
      const key = `${row.projectId}|${row.userId}`;
      const existing = bucket.get(key);
      if (existing) {
        existing.realMinutes += row.totalMinutes;
      } else {
        bucket.set(key, {
          projectId: row.projectId,
          projectName: row.projectName,
          userId: row.userId,
          userName: row.userName,
          planMinutes: 0,
          realMinutes: row.totalMinutes,
        });
      }
    }

    return Array.from(bucket.values()).sort((a, b) => {
      const projectCmp = a.projectName.localeCompare(b.projectName, "es-AR");
      if (projectCmp !== 0) return projectCmp;
      return a.userName.localeCompare(b.userName, "es-AR");
    });
  },
);
