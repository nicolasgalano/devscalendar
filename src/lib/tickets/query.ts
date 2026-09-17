import { cache } from "react";

import type { ProseMirrorNode } from "@/lib/editor/validate";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { formatTicketKey, parseTicketKey } from "./keys";
import type { TicketFilters } from "./url";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];
type TicketPriority = Database["public"]["Enums"]["ticket_priority"];

/**
 * Fila del listado. `key` viene armada acá para que el UI no tenga que
 * recomponerla en cada render (y no se le escape mal formada).
 */
export type TicketListItem = {
  id: string;
  key: string;
  numero: number;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  updatedAt: string;
  project: { id: string; key: string; name: string };
  // 018: datos del sprint (null si el ticket está en backlog). El name/numero
  // vienen del embed para que la tabla del backlog los muestre sin re-query.
  sprintId: string | null;
  sprintName: string | null;
  sprintNumero: number | null;
  sprintStatus: Database["public"]["Enums"]["sprint_status"] | null;
  estimatedHours: number | null;
};

/** Detalle de ticket para `/tickets/:key`. Suma `description` y datos del alta. */
export type TicketDetail = TicketListItem & {
  // 019: `descriptionDoc` es la fuente de verdad; `description` (markdown)
  // queda como fallback de lectura hasta la fase 2. El componente que muestra
  // el detalle elige la ruta (`<TicketDescription>`).
  descriptionDoc: ProseMirrorNode | null;
  description: string | null;
  createdBy: string;
  createdById: string;
  createdAt: string;
  project: TicketListItem["project"] & {
    pmId: string;
    active: boolean;
    client: { id: string; name: string } | null;
  };
};

const TICKET_DETAIL_SELECT = `
  id,
  numero,
  title,
  description,
  description_doc,
  status,
  priority,
  assignee_id,
  updated_at,
  created_at,
  created_by,
  estimated_hours,
  sprint_id,
  assignee:profiles!tickets_assignee_id_fkey ( full_name ),
  creator:profiles!tickets_created_by_fkey ( full_name ),
  sprint:sprints ( name, numero, status )
` as const;

/**
 * Listado de tickets. Todas las queries pasan por RLS: un usuario que no es
 * miembro de un proyecto no ve sus tickets aunque los pida explícitamente,
 * porque `tickets: read for project members` los filtra en silencio.
 *
 * `assigneeId = 'me'` se resuelve acá contra el `viewerId` que la page pasa
 * (leído con `getCurrentUser()`). `'unassigned'` va como `is null` a
 * PostgREST.
 *
 * Se hace `cache()` para que si dos componentes de la misma page piden el
 * listado con los mismos filtros, la query solo corra una vez.
 */
/**
 * Scope adicional que NO viene de la URL — usado por el tab Sprint para
 * filtrar por sprint id (que sale del path, no de query params), y por el
 * Backlog scoped para pedir "solo sin sprint activo" si algún día se decide
 * mostrar backlog "puro".
 *
 * `sprintId`:
 *   - `undefined` — sin filtro extra.
 *   - `null` — solo tickets con `sprint_id is null` (backlog "puro").
 *   - uuid — solo tickets de ese sprint.
 */
export type TicketQueryScope = {
  sprintId?: string | null;
};

export const getTicketsList = cache(
  async (
    filters: TicketFilters,
    viewerId: string | null,
    scope: TicketQueryScope = {},
  ): Promise<TicketListItem[]> => {
    const supabase = await createClient();

    let query = supabase
      .from("tickets")
      .select(
        `
          id,
          numero,
          title,
          status,
          priority,
          assignee_id,
          updated_at,
          estimated_hours,
          sprint_id,
          project:projects!inner ( id, key, name ),
          assignee:profiles!tickets_assignee_id_fkey ( full_name ),
          sprint:sprints ( name, numero, status )
        `,
      )
      .order("updated_at", { ascending: false });

    if (filters.projectId) query = query.eq("project_id", filters.projectId);
    if (filters.statuses.length > 0) query = query.in("status", filters.statuses);
    if (filters.priorities.length > 0) query = query.in("priority", filters.priorities);

    if (filters.assigneeId === "me" && viewerId) {
      query = query.eq("assignee_id", viewerId);
    } else if (filters.assigneeId === "unassigned") {
      query = query.is("assignee_id", null);
    } else if (filters.assigneeId && filters.assigneeId !== "me") {
      query = query.eq("assignee_id", filters.assigneeId);
    }

    // ILIKE con % en ambos extremos: para 6 personas y ~100 tickets/mes es más
    // que suficiente. Full-text (pg_trgm) queda para cuando duela.
    if (filters.q) {
      query = query.ilike("title", `%${filters.q}%`);
    }

    // 018: scope de sprint. `undefined` = sin filtro (default). `null` = solo
    // los sin sprint asignado. uuid = solo ese sprint.
    if (scope.sprintId === null) {
      query = query.is("sprint_id", null);
    } else if (scope.sprintId !== undefined) {
      query = query.eq("sprint_id", scope.sprintId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map((row): TicketListItem => {
      // `project` y `assignee` son embeds — PostgREST los devuelve como objeto
      // o array según la cardinalidad; el `!inner` de project fuerza objeto,
      // pero assignee es nullable así que puede venir null.
      const project = row.project;
      const assignee = row.assignee;
      const sprint = row.sprint;
      return {
        id: row.id,
        numero: row.numero,
        key: formatTicketKey({ key: project.key, numero: row.numero }),
        title: row.title,
        status: row.status,
        priority: row.priority,
        assigneeId: row.assignee_id,
        assigneeName: assignee?.full_name ?? null,
        updatedAt: row.updated_at,
        project: {
          id: project.id,
          key: project.key,
          name: project.name,
        },
        sprintId: row.sprint_id,
        sprintName: sprint?.name ?? null,
        sprintNumero: sprint?.numero ?? null,
        sprintStatus: sprint?.status ?? null,
        estimatedHours: row.estimated_hours,
      };
    });
  },
);

/**
 * Detalle por `PROJ-N`. Devuelve `null` en tres casos que la page trata
 * igual — todos como 404 (AC-6.1 del spec, R-4 del plan):
 *
 *   - La clave no parsea (`parseTicketKey` devuelve null).
 *   - El proyecto con esa `key` no existe (o RLS lo esconde).
 *   - El ticket con ese `numero` en ese proyecto no existe (o RLS lo esconde).
 *
 * La API no revela cuál de los tres es; una page que respondiera 403 en el
 * tercer caso pero 404 en el segundo estaría diciendo "el ticket existe pero
 * no lo podés ver", que es exactamente lo que la feature no puede hacer.
 */
export const getTicketByKey = cache(async (rawKey: string): Promise<TicketDetail | null> => {
  const parsed = parseTicketKey(rawKey);
  if (!parsed) return null;

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, key, name, pm_id, active, client:clients ( id, name )")
    .eq("key", parsed.projectKey)
    .maybeSingle();

  if (!project) return null;

  const { data: ticket } = await supabase
    .from("tickets")
    .select(TICKET_DETAIL_SELECT)
    .eq("project_id", project.id)
    .eq("numero", parsed.numero)
    .maybeSingle();

  if (!ticket) return null;

  return {
    id: ticket.id,
    numero: ticket.numero,
    key: formatTicketKey({ key: project.key, numero: ticket.numero }),
    title: ticket.title,
    description: ticket.description,
    descriptionDoc: (ticket.description_doc as ProseMirrorNode | null) ?? null,
    status: ticket.status,
    priority: ticket.priority,
    assigneeId: ticket.assignee_id,
    assigneeName: ticket.assignee?.full_name ?? null,
    updatedAt: ticket.updated_at,
    createdAt: ticket.created_at,
    createdBy: ticket.creator?.full_name ?? ticket.created_by,
    createdById: ticket.created_by,
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
      pmId: project.pm_id,
      active: project.active,
      client: project.client
        ? { id: project.client.id, name: project.client.name }
        : null,
    },
    sprintId: ticket.sprint_id,
    sprintName: ticket.sprint?.name ?? null,
    sprintNumero: ticket.sprint?.numero ?? null,
    sprintStatus: ticket.sprint?.status ?? null,
    estimatedHours: ticket.estimated_hours,
  };
});
