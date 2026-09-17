import { z } from "zod";

// Fecha en formato ISO date (YYYY-MM-DD). Postgres `date` acepta el string y
// el `<input type="date">` lo produce nativo — sin transformaciones.
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: AAAA-MM-DD");

// Minutos: múltiplos de 15, > 0, ≤ 960 (16h). El check duro está en la base
// (`minutes_multiple_15` en migration 17). Acá se replica para dar 400 con
// mensaje legible en vez de 23514 traducido.
const minutesSchema = z
  .number()
  .int()
  .positive()
  .max(960)
  .refine((n) => n % 15 === 0, {
    message: "Los minutos deben ser múltiplos de 15",
  });

const descriptionSchema = z
  .string()
  .max(500)
  .nullable()
  .optional()
  .transform((v) => (v === "" || v == null ? null : v));

// Hora en HH:MM (formato del <input type="time">). Postgres time acepta esto.
// Nullable + opcional para compat con entries viejas y con carga sin hora
// exacta (fecha + duración solo).
const timeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Formato esperado: HH:MM")
  .nullable()
  .optional()
  .transform((v) => (v === "" || v == null ? null : v));

/**
 * Alta de time entry. `user_id` opcional en el body: si no viene, el handler
 * lo setea a `auth.uid()`. Si viene distinto al propio, el handler chequea
 * guard admin/PM/lead — lo mismo que la RLS "insert for others".
 *
 * `activity_id` es opcional en el schema porque puede que el proyecto no
 * tenga actividades definidas todavía. El handler verifica AC-1.5: si el
 * proyecto tiene ≥1 actividad activa, `activity_id` es obligatorio y rechaza
 * con `reason: 'activity_required'`.
 *
 * `logged_at` no puede ser futuro — chequeo en el handler contra fecha actual
 * (no en Zod porque necesita comparar contra el tiempo de servidor).
 */
export const createTimeEntrySchema = z.object({
  project_id: z.string().uuid(),
  ticket_id: z.string().uuid().nullable().optional(),
  activity_id: z.string().uuid().nullable().optional(),
  minutes: minutesSchema,
  logged_at: dateSchema,
  start_time: timeSchema,
  description: descriptionSchema,
  user_id: z.string().uuid().optional(),
});

/**
 * PATCH de entry. Todos los campos opcionales, al menos uno tiene que viajar.
 * `user_id` NO se puede cambiar por API — mover una entry a otra persona
 * requeriría re-chequear permisos y no hay caso de uso concreto.
 */
export const updateTimeEntrySchema = z
  .object({
    ticket_id: z.string().uuid().nullable().optional(),
    activity_id: z.string().uuid().nullable().optional(),
    minutes: minutesSchema.optional(),
    logged_at: dateSchema.optional(),
    start_time: timeSchema,
    description: descriptionSchema,
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: "Nada para actualizar",
  });

/**
 * Start del cronómetro. Los mismos campos que un time entry sin fecha ni
 * minutos — los pone el server al parar.
 */
export const startTimerSchema = z.object({
  project_id: z.string().uuid(),
  ticket_id: z.string().uuid().nullable().optional(),
  activity_id: z.string().uuid().nullable().optional(),
});

/**
 * Query del export CSV. from y to obligatorios (rango explícito, evita
 * accidentalmente bajar todo). El resto opcional.
 */
export const exportQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;
export type StartTimerInput = z.infer<typeof startTimerSchema>;
export type ExportQueryInput = z.infer<typeof exportQuerySchema>;
