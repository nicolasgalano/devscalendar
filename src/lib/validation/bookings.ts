import { z } from "zod";

const isoInstant = z.string().datetime({ offset: true });

const optionalText = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  // Un campo vaciado en el formulario llega como "" y significa "sin nota",
  // no "nota vacía".
  .transform((value) => (value === "" ? null : value));

/**
 * AC-1.3: `endsAt > startsAt` es la única validación dura de horario.
 *
 * La jornada (09:00–17:00) y los días laborables **no se validan acá**: el
 * cliente decidió que reservar fuera de horario o en un feriado se advierte,
 * nunca se bloquea (Q-G, AC-1.4). Las advertencias se calculan en la UI con
 * `src/lib/calendar/workdays.ts`; este schema no las conoce a propósito, para
 * que nadie las convierta en error más adelante.
 */
export const createBookingSchema = z
  .object({
    projectId: z.string().uuid(),
    devId: z.string().uuid(),
    startsAt: isoInstant,
    endsAt: isoInstant,
    note: optionalText,
    ticketRef: optionalText,
  })
  .refine((body) => Date.parse(body.endsAt) > Date.parse(body.startsAt), {
    message: "La reserva tiene que terminar después de empezar",
    path: ["endsAt"],
  });

/**
 * Edición y cancelación comparten el PATCH. `status` solo admite `cancelled`:
 * aprobar y rechazar son del desarrollador (feature `005`), y el trigger de la
 * base lo hace cumplir aunque alguien mande otra cosa.
 */
export const updateBookingSchema = z
  .object({
    devId: z.string().uuid().optional(),
    startsAt: isoInstant.optional(),
    endsAt: isoInstant.optional(),
    note: optionalText,
    ticketRef: optionalText,
    status: z.literal("cancelled").optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nada para actualizar",
  })
  .refine(
    (body) =>
      body.startsAt === undefined ||
      body.endsAt === undefined ||
      Date.parse(body.endsAt) > Date.parse(body.startsAt),
    {
      message: "La reserva tiene que terminar después de empezar",
      path: ["endsAt"],
    },
  );

/**
 * La respuesta del desarrollador: aprobar o rechazar, y nada más (`plan.md` §4).
 *
 * Tres decisiones que conviene leer juntas:
 *
 * - **`status` solo admite `approved` o `rejected`.** Cancelar es del PM y
 *   desplazar es de `006`; que el enum los excluya evita que esta ruta se
 *   convierta con el tiempo en un segundo camino para escribir cualquier estado.
 * - **El comentario es obligatorio al rechazar** (acordado con el usuario el
 *   2026-08-12) y opcional al aprobar. Un rechazo sin motivo deja al PM sin nada
 *   que hacer salvo preguntar por otro canal, que es justo lo que la app viene a
 *   evitar. `optionalText` ya convirtió `""` y los espacios en `null`, así que
 *   "escribí algo" no se satisface con una barra espaciadora.
 * - **`expectedUpdatedAt` es requerido, no opcional.** Es la mitad de la
 *   protección contra la carrera de `plan.md` §5, y un campo opcional se omite
 *   sin querer: si alguien construye la request a mano y lo saltea, la respuesta
 *   tiene que fallar con un 400 visible, no comprometer al dev en silencio.
 */
export const respondBookingSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    note: optionalText,
    expectedUpdatedAt: isoInstant,
  })
  .refine((body) => body.status !== "rejected" || Boolean(body.note), {
    message: "Al rechazar hay que explicar el motivo",
    path: ["note"],
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type RespondBookingInput = z.infer<typeof respondBookingSchema>;
