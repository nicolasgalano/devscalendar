import { z } from "zod";

const nameSchema = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio")
  .max(60, "Máximo 60 caracteres");

/**
 * Alta de actividad de proyecto (016 AC-8.2). `active` nace true por default
 * de la tabla; no viaja en el schema.
 */
export const createActivitySchema = z.object({
  project_id: z.string().uuid(),
  name: nameSchema,
});

/**
 * PATCH: cambio de nombre o desactivar/reactivar. Al menos uno tiene que
 * viajar.
 */
export const updateActivitySchema = z
  .object({
    name: nameSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: "Nada para actualizar",
  });

export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
