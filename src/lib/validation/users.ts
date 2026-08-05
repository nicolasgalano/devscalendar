import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "pm", "developer"]);

export const createUserInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: userRoleSchema,
});

export const updateUserSchema = z
  .object({
    role: userRoleSchema.optional(),
    active: z.boolean().optional(),
    // AC-3.2: null clears the primary PM.
    primaryPmId: z.string().uuid().nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nada para actualizar",
  });

export type CreateUserInviteInput = z.infer<typeof createUserInviteSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
