import { z } from "zod";

import type { Database } from "@/types/database";

// Enum de status copiado del generated. Se re-exporta como Zod para validación
// runtime en handlers (el schema TS no valida en runtime).
const SPRINT_STATUS_VALUES = [
  "planned",
  "active",
  "completed",
] as const satisfies readonly Database["public"]["Enums"]["sprint_status"][];

export const sprintStatus = z.enum(SPRINT_STATUS_VALUES);

// Fecha en formato ISO date (YYYY-MM-DD). Postgres `date` acepta esto y el
// input `<input type="date">` lo produce nativo — sin transformaciones.
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: AAAA-MM-DD");

/**
 * Alta de sprint. `numero` lo pone el trigger `assign_sprint_number`; no viaja.
 * `status` nace `planned` por el default de tabla. `ends_at >= starts_at` se
 * valida acá y también con el check constraint de la base — el trigger doble
 * hace que el cliente reciba un 400 con motivo legible en vez de un 23514
 * traducido a 500.
 *
 * `name` y `goal` son opcionales; `""` se normaliza a `null` para que el JSON
 * final no lleve strings vacíos (misma convención que `updateTicketSchema`).
 */
export const createSprintSchema = z
  .object({
    project_id: z.string().uuid(),
    name: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .optional()
      .transform((v) => (v === "" || v == null ? null : v)),
    goal: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional()
      .transform((v) => (v === "" || v == null ? null : v)),
    starts_at: dateSchema,
    ends_at: dateSchema,
  })
  .refine((body) => body.ends_at >= body.starts_at, {
    message: "La fecha de fin no puede ser anterior al inicio",
    path: ["ends_at"],
  });

/**
 * PATCH de sprint. Todos los campos opcionales; al menos uno tiene que viajar.
 * `status` solo acepta la transición a `active` — el cierre (`completed`) va
 * por el endpoint dedicado, no por acá. Esto evita que un cliente confundido
 * intente cerrar por PATCH y evite el rollover / snapshot.
 */
export const updateSprintSchema = z
  .object({
    name: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .optional()
      .transform((v) => (v === "" || v == null ? null : v)),
    goal: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional()
      .transform((v) => (v === "" || v == null ? null : v)),
    starts_at: dateSchema.optional(),
    ends_at: dateSchema.optional(),
    status: z.literal("active").optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: "Nada para actualizar",
  })
  .refine(
    (body) => {
      if (body.starts_at === undefined || body.ends_at === undefined) return true;
      return body.ends_at >= body.starts_at;
    },
    { message: "La fecha de fin no puede ser anterior al inicio", path: ["ends_at"] },
  );

export type CreateSprintInput = z.infer<typeof createSprintSchema>;
export type UpdateSprintInput = z.infer<typeof updateSprintSchema>;
