import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getProjectByKey } from "@/lib/projects/workspace";
import { getCompletedSprints } from "@/lib/sprints/query";
import { formatSprintDisplayName } from "@/lib/sprints/status";
import { formatAbsoluteFull, formatRelativeShort } from "@/lib/tickets/relative-time";

export const dynamic = "force-dynamic";

/**
 * Tab "Old Sprints" (018 T5.3): lista de sprints cerrados del proyecto,
 * ordenados por `closed_at desc`. Fila clickeable → reporte del sprint.
 *
 * Visible para cualquier miembro del proyecto — la historia es de todos, no
 * solo del PM (AC-6.3 del spec).
 */
export default async function OldSprintsPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;

  const project = await getProjectByKey(projectKey);
  if (!project) notFound();

  const sprints = await getCompletedSprints(project.id);

  if (sprints.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay sprints cerrados"
        description="Cuando se cierre el primer sprint del proyecto, va a aparecer acá con su reporte."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">#</TableHead>
          <TableHead>Nombre</TableHead>
          <TableHead className="w-40">Fechas</TableHead>
          <TableHead className="w-32 text-right">Tickets</TableHead>
          <TableHead className="w-32 text-right">Horas est.</TableHead>
          <TableHead className="w-32 text-right">Cerrado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sprints.map((sprint) => {
          const href = `/projects/${projectKey}/sprints/${sprint.numero}`;
          return (
            <TableRow key={sprint.id} className="hover:bg-surface-hover">
              <TableCell className="font-data">
                <Link
                  href={href}
                  className="text-primary focus-visible:outline-ring rounded-sm outline-none focus-visible:outline-2"
                >
                  {sprint.numero}
                </Link>
              </TableCell>
              <TableCell className="text-foreground">
                <Link href={href} className="hover:underline">
                  {formatSprintDisplayName(sprint)}
                </Link>
              </TableCell>
              <TableCell className="font-data text-muted-foreground">
                {sprint.startsAt} → {sprint.endsAt}
              </TableCell>
              <TableCell className="font-data text-right">
                <ReportCount sprint={sprint} kind="tickets" />
              </TableCell>
              <TableCell className="font-data text-right">
                <ReportCount sprint={sprint} kind="hours" />
              </TableCell>
              <TableCell
                className="font-data text-right text-muted-foreground"
                title={sprint.closedAt ? formatAbsoluteFull(sprint.closedAt) : undefined}
              >
                {sprint.closedAt ? formatRelativeShort(sprint.closedAt) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Extrae `M/N` del reporte para "tickets" (completados/total) o "hours"
 * (estimadas completadas/total). Sirve para la lista sin abrir el reporte —
 * es un vistazo rápido de cuánto se cumplió del compromiso.
 */
function ReportCount({
  sprint,
  kind,
}: {
  sprint: { report: unknown };
  kind: "tickets" | "hours";
}) {
  if (!sprint.report || typeof sprint.report !== "object") return <span>—</span>;
  const report = sprint.report as {
    tickets?: { total_at_close?: number; completed?: number };
    hours?: { estimated_total?: number; estimated_completed?: number };
  };
  if (kind === "tickets") {
    const total = report.tickets?.total_at_close ?? 0;
    const done = report.tickets?.completed ?? 0;
    return (
      <span>
        {done}/{total}
      </span>
    );
  }
  const total = report.hours?.estimated_total ?? 0;
  const done = report.hours?.estimated_completed ?? 0;
  return (
    <span>
      {formatShortHours(done)}/{formatShortHours(total)}
    </span>
  );
}

function formatShortHours(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}
