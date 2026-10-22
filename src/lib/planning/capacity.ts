import { createClient } from "@/lib/supabase/server";

import { isAdmin } from "@/lib/auth/roles";
import { getCurrentProfile } from "@/lib/supabase/session";

/**
 * Feature 029: queries server-side de la pantalla `/planning`.
 *
 * Dos modos:
 *   - **Un proyecto** (dropdown con selección): `getProjectCapacityEstimates`
 *     + `getPlanningDevs`.
 *   - **Todos los proyectos activos visibles** (default): `getAllPlanningData`
 *     que compone la jerarquía cliente > proyecto > dev y sus estimates.
 *
 * `projectId` vive en `CapacityEstimateRow` incluso en el modo single-project
 * para que el componente pueda indexar sin ambigüedad cuando el mismo dev
 * aparece en varios proyectos.
 */

export type CapacityEstimateRow = {
  id: string;
  projectId: string;
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
    .select("id, project_id, dev_id, date, hours")
    .eq("project_id", projectId)
    .gte("date", dateFrom)
    .lt("date", dateToExclusive);

  return (data ?? []).map((row) => ({
    id: row.id,
    projectId: row.project_id,
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

/**
 * Modo "todos los proyectos": trae la jerarquía completa cliente > proyecto >
 * dev más las estimaciones en el rango. Un solo paquete para que el server
 * component no tenga que orquestar 10 queries.
 *
 * Visibilidad: `getVisibleProjects` + filtro `active=true`. El resultado es
 * exactamente lo que el selector del toolbar ofrece como opciones.
 *
 * Ex-miembros: dev con estimaciones viejas y sin fila activa en
 * `project_members`. Van al pie del bloque de su proyecto con `isExMember`.
 *
 * Permisos: `canEditByProject` indexa por projectId si el viewer es admin o
 * PM primario del proyecto — el componente consulta ese map por celda sin
 * saber la regla.
 */
export type AllPlanningRow = {
  client: { id: string; name: string };
  project: { id: string; key: string; name: string; pmId: string | null };
  dev: PlanningDev;
};

export type AllPlanningData = {
  rows: AllPlanningRow[];
  estimates: CapacityEstimateRow[];
  canEditByProject: Map<string, boolean>;
};

export async function getAllPlanningData(
  dateFrom: string,
  dateToExclusive: string,
): Promise<AllPlanningData> {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  if (!profile) {
    return { rows: [], estimates: [], canEditByProject: new Map() };
  }

  // Mismo criterio que `getVisibleProjects` pero filtrando activos: en el
  // modo todos-los-proyectos el selector solo ofrece activos (R-9), así
  // que la grilla no debería mostrar inactivos tampoco.
  const { data: projectsRaw } = await supabase
    .from("projects")
    .select(
      "id, key, name, active, pm_id, client:clients ( id, name ), pm:profiles!projects_pm_id_fkey ( id, full_name, email )",
    )
    .eq("active", true)
    .order("name", { ascending: true });

  if (!projectsRaw || projectsRaw.length === 0) {
    return { rows: [], estimates: [], canEditByProject: new Map() };
  }

  // Filtro de participación (como getVisibleProjects): admin ve todos los
  // activos; el resto ve PM primario propio ∪ miembro activo.
  let visibleProjects = projectsRaw;
  if (!isAdmin(profile.roles)) {
    const { data: memberRows } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", profile.id)
      .eq("active", true);
    const memberSet = new Set((memberRows ?? []).map((r) => r.project_id));
    visibleProjects = projectsRaw.filter(
      (p) => p.pm_id === profile.id || memberSet.has(p.id),
    );
  }

  if (visibleProjects.length === 0) {
    return { rows: [], estimates: [], canEditByProject: new Map() };
  }

  const projectIds = visibleProjects.map((p) => p.id);

  // Una query para todas las estimaciones del rango.
  const { data: estimatesRaw } = await supabase
    .from("capacity_estimates")
    .select("id, project_id, dev_id, date, hours")
    .in("project_id", projectIds)
    .gte("date", dateFrom)
    .lt("date", dateToExclusive);

  const estimates: CapacityEstimateRow[] = (estimatesRaw ?? []).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    devId: row.dev_id,
    date: row.date,
    hours: Number(row.hours),
  }));

  // Una query para todos los miembros activos de todos los proyectos.
  const { data: memberRaw } = await supabase
    .from("project_members")
    .select(
      "project_id, user_id, active, profiles:profiles!project_members_user_id_fkey ( id, full_name, email )",
    )
    .in("project_id", projectIds)
    .eq("active", true);

  // Map projectId → Map<devId, name>
  const membersByProject = new Map<string, Map<string, string>>();
  for (const row of memberRaw ?? []) {
    const profiles = row.profiles;
    if (!profiles) continue;
    let perProject = membersByProject.get(row.project_id);
    if (!perProject) {
      perProject = new Map();
      membersByProject.set(row.project_id, perProject);
    }
    perProject.set(row.user_id, profiles.full_name ?? profiles.email);
  }

  // Ex-miembros: devs con estimates pero no en members activos (y no PM
  // primario del proyecto). Resuelvo nombres con una query puntual.
  const missingProfileIds = new Set<string>();
  for (const estimate of estimates) {
    const projectMembers = membersByProject.get(estimate.projectId);
    const project = visibleProjects.find((p) => p.id === estimate.projectId);
    if (!project) continue;
    const isMember = projectMembers?.has(estimate.devId) ?? false;
    const isPm = project.pm_id === estimate.devId;
    if (!isMember && !isPm) missingProfileIds.add(estimate.devId);
  }

  // Si el PM primario no está entre miembros activos, lo necesitamos
  // igual para el nombre.
  for (const project of visibleProjects) {
    if (!project.pm_id) continue;
    const projectMembers = membersByProject.get(project.id);
    if (!projectMembers?.has(project.pm_id)) {
      // Lo tenemos embed en la query de projects — no hace falta ir a
      // profiles. Se completa abajo al armar las rows.
    }
  }

  const extraProfiles = new Map<string, string>();
  if (missingProfileIds.size > 0) {
    const { data: extras } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...missingProfileIds]);
    for (const profileRow of extras ?? []) {
      extraProfiles.set(profileRow.id, profileRow.full_name ?? profileRow.email);
    }
  }

  // Compongo las rows. Orden: cliente alfabético, proyecto alfabético,
  // adentro PM primario → activos → ex-miembros (cada grupo por nombre).
  const collator = new Intl.Collator("es-AR", { sensitivity: "base" });

  type SortableRow = AllPlanningRow & {
    _clientName: string;
    _projectName: string;
    _devOrder: number; // 0 pm, 1 activo, 2 ex-miembro
    _devName: string;
  };

  const sortable: SortableRow[] = [];

  for (const project of visibleProjects) {
    if (!project.client) continue; // defensive — un project sin cliente no se puede renderizar
    const clientBundle = { id: project.client.id, name: project.client.name };
    const projectBundle = {
      id: project.id,
      key: project.key,
      name: project.name,
      pmId: project.pm_id,
    };

    const projectMembers = membersByProject.get(project.id) ?? new Map<string, string>();
    const projectEstimates = estimates.filter((e) => e.projectId === project.id);
    const estimateDevIds = new Set(projectEstimates.map((e) => e.devId));

    // Determino el conjunto de devs a mostrar: PM primario + miembros
    // activos + ex-miembros (dev_id en estimates pero no en members y no PM).
    const toShow: PlanningDev[] = [];

    // PM primario. Si no está en members activos, lo tomamos del embed de
    // `pm` en projects.
    if (project.pm_id) {
      const pmName =
        projectMembers.get(project.pm_id) ??
        project.pm?.full_name ??
        project.pm?.email ??
        "";
      toShow.push({
        id: project.pm_id,
        name: pmName,
        isProjectPm: true,
        isExMember: false,
      });
    }

    // Activos (excluyendo el PM primario, que ya está arriba).
    for (const [devId, name] of projectMembers.entries()) {
      if (devId === project.pm_id) continue;
      toShow.push({ id: devId, name, isProjectPm: false, isExMember: false });
    }

    // Ex-miembros (devs con estimates pero no en members y no PM).
    for (const devId of estimateDevIds) {
      const isMember = projectMembers.has(devId);
      const isPm = project.pm_id === devId;
      if (isMember || isPm) continue;
      toShow.push({
        id: devId,
        name: extraProfiles.get(devId) ?? "",
        isProjectPm: false,
        isExMember: true,
      });
    }

    for (const dev of toShow) {
      sortable.push({
        client: clientBundle,
        project: projectBundle,
        dev,
        _clientName: clientBundle.name,
        _projectName: projectBundle.name,
        _devOrder: dev.isProjectPm ? 0 : dev.isExMember ? 2 : 1,
        _devName: dev.name,
      });
    }
  }

  sortable.sort((a, b) => {
    const byClient = collator.compare(a._clientName, b._clientName);
    if (byClient !== 0) return byClient;
    const byProject = collator.compare(a._projectName, b._projectName);
    if (byProject !== 0) return byProject;
    if (a._devOrder !== b._devOrder) return a._devOrder - b._devOrder;
    return collator.compare(a._devName, b._devName);
  });

  const rows: AllPlanningRow[] = sortable.map((r) => ({
    client: r.client,
    project: r.project,
    dev: r.dev,
  }));

  // `canEdit` por proyecto: admin ve todo, PM primario solo lo suyo.
  const canEditByProject = new Map<string, boolean>();
  const isAdminViewer = isAdmin(profile.roles);
  for (const project of visibleProjects) {
    canEditByProject.set(
      project.id,
      isAdminViewer || project.pm_id === profile.id,
    );
  }

  return { rows, estimates, canEditByProject };
}
