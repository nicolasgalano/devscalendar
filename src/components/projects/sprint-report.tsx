import Link from "next/link";

import { TicketPriorityBadge } from "@/components/tickets/ticket-priority";
import { TicketStatusBadge } from "@/components/tickets/ticket-status";
import { formatMinutesDecimal } from "@/lib/time-entries/format";
import type { SprintActualHours } from "@/lib/time-entries/query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SprintDetail } from "@/lib/sprints/query";
import { formatAbsoluteFull } from "@/lib/tickets/relative-time";
import { formatTicketKey } from "@/lib/tickets/keys";
import type { Database } from "@/types/database";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];
type TicketPriority = Database["public"]["Enums"]["ticket_priority"];

type SprintReportShape = {
  closed_at?: string;
  tickets?: {
    total_at_close?: number;
    completed?: number;
    rolled_over?: number;
  };
  hours?: {
    estimated_total?: number;
    estimated_completed?: number;
    unestimated_count?: number;
  };
  by_assignee?: Array<{
    user_id: string | null;
    name: string;
    tickets_completed: number;
    hours_completed: number;
  }>;
  tickets_snapshot?: Array<{
    id: string;
    numero: number;
    title: string;
    status: TicketStatus;
    priority: TicketPriority;
    assignee_id: string | null;
    estimated_hours: number | null;
  }>;
  rolled_over_to_sprint_id?: string | null;
};

/**
 * Componente contenedor del reporte de sprint cerrado (018 T5.5). Lee del
 * `sprint.report jsonb` — el snapshot es el que manda, no el estado actual
 * de los tickets. Toda la data que muestra es del momento del cierre.
 *
 * Cuando `016-time-tracking` aterrice, va a sumarse acá una sección "Horas
 * reales cargadas" que compara con `estimated_completed` — sin cambios de
 * schema del report; se lee de `time_entries` en tiempo de render.
 */
export function SprintReport({
  sprint,
  projectKey,
  actualHours,
}: {
  sprint: SprintDetail;
  projectKey?: string;
  /** 016 T7.1 — horas cargadas live-queried al momento de abrir la página. */
  actualHours?: SprintActualHours;
}) {
  const report = (sprint.report ?? {}) as SprintReportShape;

  const totalTickets = report.tickets?.total_at_close ?? 0;
  const completedTickets = report.tickets?.completed ?? 0;
  const rolledOverTickets = report.tickets?.rolled_over ?? 0;
  const completionPctTickets =
    totalTickets > 0 ? Math.round((completedTickets / totalTickets) * 100) : 0;

  const totalHours = report.hours?.estimated_total ?? 0;
  const completedHours = report.hours?.estimated_completed ?? 0;
  const unestimatedCount = report.hours?.unestimated_count ?? 0;
  const completionPctHours =
    totalHours > 0 ? Math.round((completedHours / totalHours) * 100) : 0;

  const byAssignee = report.by_assignee ?? [];
  const ticketsSnapshot = report.tickets_snapshot ?? [];

  return (
    <div className="flex flex-col gap-6">
      {sprint.goal && (
        <section>
          <h2 className="text-section pb-2 font-medium">Objetivo</h2>
          <p className="text-ui whitespace-pre-wrap">{sprint.goal}</p>
        </section>
      )}

      <section>
        <h2 className="text-section pb-3 font-medium">Resumen</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Tickets planeados"
            value={String(totalTickets)}
            hint={
              rolledOverTickets > 0
                ? `${rolledOverTickets} rolleado${rolledOverTickets === 1 ? "" : "s"}`
                : undefined
            }
          />
          <Metric
            label="Tickets cerrados"
            value={`${completedTickets} · ${completionPctTickets}%`}
          />
          <Metric
            label="Horas estimadas"
            value={formatHours(totalHours)}
            hint={
              unestimatedCount > 0
                ? `${unestimatedCount} sin estimar`
                : undefined
            }
          />
          <Metric
            label="Horas cerradas"
            value={`${formatHours(completedHours)} · ${completionPctHours}%`}
          />
        </dl>
      </section>

      {actualHours && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-section font-medium">Horas cargadas</h2>
            <p className="text-caption text-muted-foreground">
              Calculadas al momento de abrir esta página
            </p>
          </div>
          <dl className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric
              label="Cargadas totales"
              value={formatMinutesDecimal(actualHours.totalMinutes)}
            />
            <Metric
              label="Estimadas"
              value={`${formatHours(totalHours)}`}
            />
            {totalHours > 0 && (
              <Metric
                label="Desvío"
                value={(() => {
                  const actualH = actualHours.totalMinutes / 60;
                  const deltaPct = Math.round(
                    ((actualH - totalHours) / totalHours) * 100,
                  );
                  return `${deltaPct > 0 ? "+" : ""}${deltaPct}%`;
                })()}
              />
            )}
          </dl>
          {actualHours.byUser.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead className="w-40 text-right">Horas cargadas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actualHours.byUser.map((entry) => (
                  <TableRow key={entry.userId}>
                    <TableCell>{entry.userName}</TableCell>
                    <TableCell className="font-data text-right">
                      {formatMinutesDecimal(entry.minutes)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {byAssignee.length > 0 && (
        <section>
          <h2 className="text-section pb-3 font-medium">Por asignado</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-40 text-right">Tickets cerrados</TableHead>
                <TableHead className="w-40 text-right">Horas cerradas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byAssignee.map((entry, idx) => (
                <TableRow key={entry.user_id ?? `null-${idx}`}>
                  <TableCell>{entry.name}</TableCell>
                  <TableCell className="font-data text-right">
                    {entry.tickets_completed}
                  </TableCell>
                  <TableCell className="font-data text-right">
                    {formatHours(entry.hours_completed)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {ticketsSnapshot.length > 0 && (
        <section>
          <h2 className="text-section pb-3 font-medium">Tickets del sprint</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Clave</TableHead>
                <TableHead>Título</TableHead>
                <TableHead className="w-36">Estado al cierre</TableHead>
                <TableHead className="w-28">Prioridad</TableHead>
                <TableHead className="w-24 text-right">Est. hs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ticketsSnapshot.map((ticket) => {
                // La `key` del proyecto no viaja al snapshot (se busca por id
                // en tickets al render, o se acepta mostrar solo `#numero`).
                // Para no re-query, usamos el projectKey si vino como prop.
                const displayKey = projectKey
                  ? formatTicketKey({ key: projectKey, numero: ticket.numero })
                  : `#${ticket.numero}`;
                return (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-data text-primary">
                      <Link href={`/tickets/${displayKey}`} className="hover:underline">
                        {displayKey}
                      </Link>
                    </TableCell>
                    <TableCell>{ticket.title}</TableCell>
                    <TableCell>
                      <TicketStatusBadge status={ticket.status} />
                    </TableCell>
                    <TableCell>
                      <TicketPriorityBadge priority={ticket.priority} />
                    </TableCell>
                    <TableCell className="font-data text-right">
                      {ticket.estimated_hours ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}

      <p className="text-caption text-muted-foreground border-border mt-4 border-t pt-4">
        {sprint.closedAt
          ? `Reporte congelado el ${formatAbsoluteFull(sprint.closedAt)}. Cambios posteriores en los tickets no se reflejan acá.`
          : "Reporte congelado al cierre del sprint."}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border-border flex flex-col gap-0.5 rounded-md border p-3">
      <dt className="text-caption text-muted-foreground font-medium">{label}</dt>
      <dd className="text-emphasis font-data">{value}</dd>
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
    </div>
  );
}

function formatHours(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}
