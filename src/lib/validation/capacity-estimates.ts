import { z } from "zod";

/**
 * Feature 029: body del endpoint POST /api/capacity-estimates.
 *
 * El endpoint es un **upsert** (una fila por (projectId, devId, date), unique
 * constraint lo garantiza). El cliente nunca manda `id` — la DB resuelve por
 * clave natural. El DELETE sí usa `id` como path param, pero no toma body.
 *
 * `date` queda como `yyyy-MM-dd` (DATE en Postgres), no `timestamptz`: la
 * unidad semántica es día calendario. La UI resuelve la zona horaria antes
 * de enviar.
 *
 * `hours`:
 *   - positivo estricto (> 0) para que no se pueda "borrar" una estimación
 *     mandando 0 — eso confunde la semántica de upsert con la de delete.
 *     Para borrar hay endpoint propio.
 *   - máximo 24 (jornada entera). Más no tiene sentido como "horas de un
 *     día" aunque la DB podría almacenarlo.
 *   - sin multipleOf 0.25 — la UI lo impone con el step del input; la
 *     validación acepta cualquier decimal razonable para no bloquear un
 *     parche futuro que use otra granularidad (reporte histórico, import,
 *     etc.).
 */
export const upsertCapacityEstimateSchema = z.object({
  projectId: z.string().uuid(),
  devId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe ser yyyy-MM-dd"),
  hours: z.number().positive().max(24),
});

export type UpsertCapacityEstimateInput = z.infer<typeof upsertCapacityEstimateSchema>;
