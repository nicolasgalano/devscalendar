import Link from "next/link";
import { notFound } from "next/navigation";

import { SprintReport } from "@/components/projects/sprint-report";
import { PageHeader } from "@/components/page-header";
import { getProjectByKey } from "@/lib/projects/workspace";
import { getCompletedSprintByNumero } from "@/lib/sprints/query";
import { formatSprintDisplayName } from "@/lib/sprints/status";
import { getSprintActualHours } from "@/lib/time-entries/query";
import { formatAbsoluteFull } from "@/lib/tickets/relative-time";

export const dynamic = "force-dynamic";

/**
 * Reporte de sprint cerrado (018 T5.4). El snapshot vive en `sprints.report jsonb`,
 * congelado al momento del cierre — R-2 del spec: cambios post-cierre en los
 * tickets no lo afectan. La nota al pie deja eso explícito para que nadie mire
 * el reporte esperando "el estado actual".
 */
export default async function SprintReportPage({
  params,
}: {
  params: Promise<{ projectKey: string; numero: string }>;
}) {
  const { projectKey, numero } = await params;
  const parsedNumero = Number.parseInt(numero, 10);
  if (!Number.isFinite(parsedNumero) || parsedNumero <= 0) notFound();

  const project = await getProjectByKey(projectKey);
  if (!project) notFound();

  const sprint = await getCompletedSprintByNumero(project.id, parsedNumero);
  if (!sprint) notFound();

  // 016 T7.1: horas cargadas live-queried en el rango del sprint. Se corta
  // en `closedAt` para que entries post-cierre con fecha post-cierre NO
  // aparezcan; entries post-cierre con fecha PRE-cierre sí (el user cargó
  // tarde pero la fecha es del sprint).
  const closedDate = sprint.closedAt
    ? sprint.closedAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const actualHours = await getSprintActualHours(sprint.id, sprint.startsAt, closedDate);

  return (
    <>
      <PageHeader
        title={formatSprintDisplayName(sprint)}
        description={`Del ${sprint.startsAt} al ${sprint.endsAt}${
          sprint.closedAt ? ` · Cerrado el ${formatAbsoluteFull(sprint.closedAt)}` : ""
        }`}
      />
      <p className="text-caption text-muted-foreground mb-4">
        <Link href={`/projects/${projectKey}/sprints`} className="hover:underline">
          ← Volver a Old Sprints
        </Link>
      </p>

      <SprintReport
        sprint={sprint}
        projectKey={projectKey}
        actualHours={actualHours}
      />
    </>
  );
}
