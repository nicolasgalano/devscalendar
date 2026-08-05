import { z } from "zod";

export const createClientSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export const updateClientSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    active: z.boolean().optional(),
    // AC-1.2: deactivating a client with active projects requires the caller
    // to confirm explicitly instead of the request being blocked outright.
    confirmDeactivateWithActiveProjects: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.active !== undefined, {
    message: "Nada para actualizar",
  });

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
