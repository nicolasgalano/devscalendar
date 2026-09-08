import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "pm", "developer"]);

/**
 * Roles son un conjunto desde `012` (D-09): alguien puede ser PM y admin.
 *
 * `min(1)` es AC-1.4 — quedarse sin ningún rol no es la forma de dar de baja a
 * alguien; para eso está `active`, que además deja el motivo por escrito. El
 * conjunto vacío existe solo para quien todavía no fue dado de alta y espera en
 * `/pending-access`, y a ese estado se llega por el trigger, no por la API.
 *
 * `max(3)` no defiende de nada: el enum tiene tres valores y el trigger de la
 * base deduplica. Está para que el error salga temprano y legible en vez de
 * como un constraint.
 */
export const userRolesSchema = z.array(userRoleSchema).min(1).max(3);

export const createUserInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roles: userRolesSchema,
});

export const updateUserSchema = z
  .object({
    roles: userRolesSchema.optional(),
    active: z.boolean().optional(),
    // AC-3.2: null clears the primary PM.
    primaryPmId: z.string().uuid().nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nada para actualizar",
  });

export type CreateUserInviteInput = z.infer<typeof createUserInviteSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
