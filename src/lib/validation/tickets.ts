import { z } from "zod";

import { richTextDocSchema } from "@/lib/validation/rich-text";
import type { Database } from "@/types/database";

// Los tres enums copiados desde el schema generado. Se re-exportan como
// arrays de Zod porque los tipos generados por Supabase son sólo TypeScript
// y no dan validación runtime.
const TICKET_STATUS_VALUES = [
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const satisfies readonly Database["public"]["Enums"]["ticket_status"][];

const TICKET_PRIORITY_VALUES = [
  "low",
  "medium",
  "high",
  "critical",
] as const satisfies readonly Database["public"]["Enums"]["ticket_priority"][];

const PROJECT_MEMBER_ROLE_VALUES = [
  "viewer",
  "contributor",
  "lead",
] as const satisfies readonly Database["public"]["Enums"]["project_member_role"][];

export const ticketStatus = z.enum(TICKET_STATUS_VALUES);
export const ticketPriority = z.enum(TICKET_PRIORITY_VALUES);
export const projectMemberRole = z.enum(PROJECT_MEMBER_ROLE_VALUES);

/**
 * Alta de ticket. `status` no viaja: nace `todo` por el default de la tabla
 * (los estados iniciales distintos son ruido; si mañana un flujo necesita
 * "empezar en in_progress", se agrega explícito).
 *
 * `assignee_id` puede llegar `null` (ticket sin asignar) o un uuid — pero la
 * pertenencia real del asignado al proyecto NO se valida acá: la RLS de
 * `tickets: contributor+ insert` sabe qué es el proyecto, no quién es el
 * assignee. El chequeo `assignee is member` vive en el handler antes del
 * insert (AC-2.3 del spec).
 *
 * 019: `description` (string markdown) salió del schema. La descripción ahora
 * es un doc de ProseMirror validado por `richTextDocSchema`; la columna vieja
 * queda como fallback de lectura hasta la fase 2. Un cliente que mande
 * `description` recibe un 400 por "campo desconocido" — es lo que
 * corresponde: el sistema pasó a `description_doc`.
 */
export const createTicketSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1, "El título es obligatorio").max(200, "Máximo 200 caracteres"),
  description_doc: richTextDocSchema.nullable().optional(),
  priority: ticketPriority.default("medium"),
  assignee_id: z.string().uuid().nullable().optional(),
});

/**
 * PATCH de ticket. Todos los campos opcionales, pero al menos uno tiene que
 * viajar — un PATCH vacío no es idempotencia, es un bug del cliente.
 *
 * `status = 'cancelled'` es la única forma de "borrar" un ticket (D-7 del
 * plan): el grant `delete` a `authenticated` no existe. La granularidad de
 * quién puede editar qué (contributor edita propios, transiciona ajenos, no
 * reasigna) la hace el trigger `enforce_ticket_contributor_scope` — el
 * schema no la conoce a propósito, para no duplicar la regla en dos lugares.
 *
 * 019: `expected_updated_at` opcional para el hidratador de checkboxes del
 * `<RichTextViewer>`. Si viaja, el handler compara con `ticket.updated_at`
 * antes del `.update()` y responde 409 si difieren — es la protección contra
 * la carrera entre la edición completa y el toggle del checklist. No lo
 * cuenta el `.refine("Nada para actualizar")` porque es metadata de la
 * escritura, no un campo a actualizar.
 */
export const updateTicketSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description_doc: richTextDocSchema.nullable().optional(),
    status: ticketStatus.optional(),
    priority: ticketPriority.optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    // 018: sprint_id nullable => backlog. Solo lead+ puede tocarlo (trigger
    // enforce_ticket_contributor_scope extendido en migration 16).
    sprint_id: z.string().uuid().nullable().optional(),
    // 018: horas estimadas para el reporte de sprint. numeric(5,2) en la
    // base => max 999.99. Opcional (Q-1: fricción cero al alta).
    estimated_hours: z.number().nonnegative().max(999.99).nullable().optional(),
    // 019: hint de carrera. No cuenta como campo actualizable — ver `.refine`.
    // `{ offset: true }` acepta el formato de Supabase (`...+00:00`); sin eso
    // Zod exige la variante con `Z` y rebota todo lo que salga de Postgres.
    expected_updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (body) =>
      Object.entries(body).some(
        ([key, value]) => key !== "expected_updated_at" && value !== undefined,
      ),
    {
      message: "Nada para actualizar",
    },
  );

/**
 * Alta de miembro. El rol default es `contributor` — el UI y el trigger de
 * `autoadd_pm_as_lead` cubren el caso `lead`; agregarlo a mano como default
 * sería confuso.
 */
export const createMemberSchema = z.object({
  project_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role_in_project: projectMemberRole.default("contributor"),
});

/**
 * PATCH de miembro: cambiar rol o desactivar/reactivar. Igual que
 * `updateTicketSchema`, al menos uno tiene que viajar.
 */
export const updateMemberSchema = z
  .object({
    role_in_project: projectMemberRole.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nada para actualizar",
  });

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
