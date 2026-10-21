import { z } from "zod";

export const projectPrioritySchema = z.enum(["normal", "high"]);

// AC-2.1: name, client, PM, priority and integration flags are all required
// on creation — no implicit defaults for a brand-new project.
export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  clientId: z.string().uuid(),
  pmId: z.string().uuid(),
  priority: projectPrioritySchema,
  jiraEnabled: z.boolean(),
  slackEnabled: z.boolean(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    pmId: z.string().uuid().optional(),
    priority: projectPrioritySchema.optional(),
    jiraEnabled: z.boolean().optional(),
    slackEnabled: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nada para actualizar",
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// Feature 028: body del endpoint POST /api/projects/[id]/active, que invoca la
// RPC set_project_active. Mantener el toggle en un schema aparte (en vez de
// reusar updateProjectSchema con `active`) deja claro que esta ruta tiene su
// propio guard (admin O PM primario) y no debería crecer para aceptar nombres
// u otras columnas que requieren admin-only.
export const setProjectActiveSchema = z.object({
  active: z.boolean(),
});

export type SetProjectActiveInput = z.infer<typeof setProjectActiveSchema>;
