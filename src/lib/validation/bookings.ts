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

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
