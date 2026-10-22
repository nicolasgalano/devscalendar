import { createClient } from "@/lib/supabase/server";

/**
 * Feature 029: queries server-side de la pantalla `/planning`.
 *
 * Dos helpers:
 *   - `getProjectCapacityEstimates(projectId, dateFrom, dateTo)`: trae las
 *     estimaciones del proyecto en el rango `[from, to)` (semi-abierto).
 *   - `getPlanningDevs(projectId, pmId, estimates)`: compone la lista de
 *     filas de la grilla — miembros activos + PM primario (si no está en
 *     project_members) + ex-miembros con estimaciones en el rango,
 *     marcados `isExMember=true` para que la UI los desactive.
 *
 * `getPlanningDevs` recibe `estimates` ya resueltas en vez de volver a
 * querear: el llamador controla el rango sin que el helper lo duplique.
 */

export type CapacityEstimateRow = {
  id: string;
  devId: string;
  date: string; // yyyy-MM-dd
  hours: number;
};

export type PlanningDev = {
  id: string;
  name: string;
  isProjectPm: boolean;
  isExMember: boolean;
};

export async function getProjectCapacityEstimates(
  projectId: string,
  dateFrom: string,
  dateToExclusive: string,
): Promise<CapacityEstimateRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("capacity_estimates")
    .select("id, dev_id, date, hours")
    .eq("project_id", projectId)
    .gte("date", dateFrom)
    .lt("date", dateToExclusive);

  return (data ?? []).map((row) => ({
    id: row.id,
    devId: row.dev_id,
    date: row.date,
    hours: Number(row.hours),
  }));
}

export async function getPlanningDevs(
  projectId: string,
  pmId: string,
  estimates: CapacityEstimateRow[],
): Promise<PlanningDev[]> {
  const supabase = await createClient();

  // Miembros activos del proyecto con sus profiles.
  const { data: memberRows } = await supabase
    .from("project_members")
    .select("user_id, profiles!project_members_user_id_fkey ( id, full_name, email )")
    .eq("project_id", projectId)
    .eq("active", true);

  const members = new Map<string, { name: string }>();
  for (const row of memberRows ?? []) {
    const profile = row.profiles;
    if (!profile) continue;
    members.set(row.user_id, {
      name: profile.full_name ?? profile.email,
    });
  }

  // Ex-miembros: dev_ids que aparecen en estimates pero no están en members
  // activos (y no son el PM primario).
  const estimateDevIds = new Set(estimates.map((e) => e.devId));
  const exMemberIds = [...estimateDevIds].filter(
    (devId) => !members.has(devId) && devId !== pmId,
  );

  let exMembers = new Map<string, { name: string }>();
  if (exMemberIds.length > 0) {
    const { data: exRows } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", exMemberIds);
    exMembers = new Map(
      (exRows ?? []).map((row) => [row.id, { name: row.full_name ?? row.email }]),
    );
  }

  // PM primario: si no está en members activos, sumarlo. Siempre aparece
  // marcado `isProjectPm=true`.
  if (!members.has(pmId)) {
    const { data: pmProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", pmId)
      .maybeSingle();
    if (pmProfile) {
      members.set(pmId, {
        name: pmProfile.full_name ?? pmProfile.email,
      });
    }
  }

  // Composición final: PM primario arriba, luego miembros activos, luego
  // ex-miembros. Dentro de cada grupo, por nombre es-AR.
  const collator = new Intl.Collator("es-AR", { sensitivity: "base" });
  const result: PlanningDev[] = [];

  const pmEntry = members.get(pmId);
  if (pmEntry) {
    result.push({ id: pmId, name: pmEntry.name, isProjectPm: true, isExMember: false });
  }

  const activeNonPm = [...members.entries()]
    .filter(([id]) => id !== pmId)
    .map(([id, data]) => ({ id, name: data.name, isProjectPm: false, isExMember: false }));
  activeNonPm.sort((a, b) => collator.compare(a.name, b.name));
  result.push(...activeNonPm);

  const exEntries = [...exMembers.entries()].map(([id, data]) => ({
    id,
    name: data.name,
    isProjectPm: false,
    isExMember: true,
  }));
  exEntries.sort((a, b) => collator.compare(a.name, b.name));
  result.push(...exEntries);

  return result;
}
