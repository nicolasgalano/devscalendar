import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type SprintRow = Database["public"]["Tables"]["sprints"]["Row"];
type SprintStatus = Database["public"]["Enums"]["sprint_status"];

/**
 * Vista general de un sprint para listados. `report` no viaja acá — es pesado
 * y solo la vista de reporte lo necesita.
 */
export type SprintListItem = {
  id: string;
  projectId: string;
  numero: number;
  name: string | null;
  goal: string | null;
  startsAt: string;
  endsAt: string;
  status: SprintStatus;
  closedAt: string | null;
  updatedAt: string;
};

function toListItem(row: SprintRow): SprintListItem {
  return {
    id: row.id,
    projectId: row.project_id,
    numero: row.numero,
    name: row.name,
    goal: row.goal,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    closedAt: row.closed_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Sprint activo del proyecto — máximo uno por el unique parcial de la base.
 * Cacheado por request: la usan `page.tsx` del tab Sprint y el header del
 * workspace.
 */
export const getActiveSprint = cache(
  async (projectId: string): Promise<SprintListItem | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sprints")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "active")
      .maybeSingle();
    return data ? toListItem(data) : null;
  },
);

/**
 * Sprints planificados del proyecto, ordenados por `starts_at asc` (el próximo
 * a arrancar primero). El rollover automático elige el primero de esta lista.
 */
export const getPlannedSprints = cache(
  async (projectId: string): Promise<SprintListItem[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sprints")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "planned")
      .order("starts_at", { ascending: true })
      .order("numero", { ascending: true });
    return (data ?? []).map(toListItem);
  },
);

/**
 * Sprints cerrados del proyecto — para el tab "Old Sprints", ordenados por
 * `closed_at desc` (último cerrado arriba). Incluye `report` porque la tabla
 * muestra el count "X/Y tickets" y "X/Y horas" de un vistazo antes de abrir
 * cada reporte. Reports son ~1-5KB; 50 sprints = 250KB, aceptable.
 */
export const getCompletedSprints = cache(
  async (projectId: string): Promise<SprintDetail[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sprints")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "completed")
      .order("closed_at", { ascending: false });
    return (data ?? []).map((row) => ({ ...toListItem(row), report: row.report }));
  },
);

/**
 * Detalle de sprint por `numero` dentro del proyecto — para `/projects/[key]/sprints/[N]`.
 * Devuelve el `report jsonb` completo. Si el sprint no está cerrado, devuelve
 * null: los planificados y activos no tienen reporte todavía.
 */
export type SprintDetail = SprintListItem & {
  report: Database["public"]["Tables"]["sprints"]["Row"]["report"];
};

export const getCompletedSprintByNumero = cache(
  async (projectId: string, numero: number): Promise<SprintDetail | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sprints")
      .select("*")
      .eq("project_id", projectId)
      .eq("numero", numero)
      .eq("status", "completed")
      .maybeSingle();
    if (!data) return null;
    return { ...toListItem(data), report: data.report };
  },
);

/**
 * Todos los sprints no-cerrados de un proyecto — para poblar el `<Select>`
 * de "cambiar sprint" en un ticket (backlog y detalle).
 *
 * AC-3.4 del spec: no incluye los `completed` — un ticket en un sprint cerrado
 * está congelado, y mover uno nuevo ahí también estaría prohibido.
 */
export const getOpenSprints = cache(
  async (projectId: string): Promise<SprintListItem[]> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sprints")
      .select("*")
      .eq("project_id", projectId)
      .in("status", ["planned", "active"])
      .order("status", { ascending: false }) // active primero (< planned alfabético)
      .order("starts_at", { ascending: true });
    return (data ?? []).map(toListItem);
  },
);
