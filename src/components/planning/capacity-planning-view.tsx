"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDays } from "@/lib/calendar/range";
import { isWorkday } from "@/lib/calendar/workdays";
import {
  PLANNING_CELL_WIDTH,
  PLANNING_LABEL_WIDTH,
  PLANNING_ROW_HEIGHT,
  PLANNING_WEEK_SIZE,
} from "@/lib/planning/constants";
import type { CapacityEstimateRow, PlanningDev } from "@/lib/planning/capacity";
import { sumByDay, sumByDevWeek } from "@/lib/planning/totals";
import { planningHref, type PlanningUrl } from "@/lib/planning/url";
import type { ProjectListRow } from "@/lib/projects/workspace";
import { cn } from "@/lib/utils";

import { CapacityPopoverForm } from "./capacity-popover";

const SUBTOTAL_WIDTH = 56;

/**
 * Feature 029: grilla de planificación de capacidad por proyecto.
 *
 * Densidad y constantes compartidas con `/calendar?view=planning` (011)
 * via `src/lib/planning/constants.ts`. Lo que cambia frente al calendar
 * es la semántica: acá cada celda es editable (click → popover) y el
 * agregado es por día del proyecto, no por carga total del dev.
 *
 * Totales en cliente con `useMemo` — bajan solo cuando cambian
 * `estimates` o `days` (que vienen del server).
 */
export function CapacityPlanningView({
  projects,
  project,
  devs,
  estimates,
  days,
  weekStart,
  canEdit,
  urlState,
}: {
  projects: ProjectListRow[];
  project: { id: string; key: string; name: string; pm: { id: string; name: string } | null } | null;
  devs: PlanningDev[];
  estimates: CapacityEstimateRow[];
  days: string[];
  weekStart: string | null;
  canEdit: boolean;
  currentUserId: string;
  urlState: PlanningUrl;
}) {
  const router = useRouter();

  const perDay = useMemo(() => sumByDay(estimates), [estimates]);
  const perDevWeek = useMemo(() => sumByDevWeek(estimates, days), [estimates, days]);
  const perDevDate = useMemo(() => {
    const map = new Map<string, { id: string; hours: number }>();
    for (const estimate of estimates) {
      map.set(`${estimate.devId}:${estimate.date}`, {
        id: estimate.id,
        hours: estimate.hours,
      });
    }
    return map;
  }, [estimates]);

  const [openCell, setOpenCell] = useState<{ devId: string; date: string } | null>(null);

  function onProjectChange(nextKey: string) {
    router.push(planningHref(urlState, { project: nextKey, w: null }));
  }

  // Nav semanal. Si no hay `w` en la URL (ancla por default) y el usuario
  // apreta ◀/▶, se calcula desde el `weekStart` server resuelto.
  function navWeek(byWeeks: number) {
    if (!weekStart) return;
    router.push(planningHref(urlState, { w: addDays(weekStart, byWeeks * 7) }));
  }

  // Grid template: label + 4 bloques de (7 cells + 1 subtotal).
  const gridTemplateColumns = [
    `${PLANNING_LABEL_WIDTH}px`,
    ...Array.from({ length: 4 }, () =>
      `repeat(${PLANNING_WEEK_SIZE}, ${PLANNING_CELL_WIDTH}px) ${SUBTOTAL_WIDTH}px`,
    ),
  ].join(" ");

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={urlState.project ?? ""}
          onValueChange={(value) => value && onProjectChange(value)}
        >
          <SelectTrigger size="sm" className="w-64">
            <SelectValue placeholder="Elegí un proyecto">
              {project ? `${project.key} · ${project.name}` : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.key}>
                {p.key} · {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {project && (
          <>
            <Button variant="outline" size="icon-sm" onClick={() => navWeek(-1)}>
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            {/* `onClick` + router.push en vez de <Link> envolviendo al botón:
                `<Button>` adentro de `<Link>` es anti-pattern HTML (nested
                interactive elements) y el handler del botón puede ganarle
                a la navegación del Link, dejando el click sin efecto o,
                peor, aplicando otra navegación. Mismo patrón que las
                flechas de arriba. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(planningHref(urlState, { w: null }))}
            >
              Hoy
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => navWeek(1)}>
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </>
        )}
      </div>

      {!project ? (
        <div className="border-border rounded-lg border p-10 text-center">
          <p className="text-ui text-muted-foreground">
            Elegí un proyecto para ver y cargar su capacidad estimada por día.
          </p>
        </div>
      ) : devs.length === 0 ? (
        <div className="border-border rounded-lg border p-10 text-center">
          <p className="text-ui text-muted-foreground">
            Este proyecto no tiene miembros activos todavía.
          </p>
        </div>
      ) : (
        <div
          data-capacity-grid=""
          className="border-border relative max-h-[calc(100vh-14rem)] overflow-auto rounded-lg border"
        >
          <div className="inline-grid min-w-full" style={{ gridTemplateColumns }}>
            {/* Day header */}
            <div
              className="bg-background sticky left-0 top-0 z-20 border-b border-r border-border px-3 py-2 text-caption font-medium"
              style={{ height: PLANNING_ROW_HEIGHT }}
            >
              Dev
            </div>
            {renderDayHeaders(days)}

            {/* Dev rows */}
            {devs.map((dev) => (
              <DevRow
                key={dev.id}
                dev={dev}
                days={days}
                canEdit={canEdit && !dev.isExMember}
                perDevDate={perDevDate}
                perDevWeek={perDevWeek.get(dev.id) ?? new Map()}
                openCell={openCell}
                setOpenCell={setOpenCell}
                projectId={project.id}
              />
            ))}

            {/* Footer: totales por día */}
            <div
              className="bg-background sticky left-0 z-10 border-t border-r border-border px-3 py-2 text-caption font-medium"
              style={{ height: PLANNING_ROW_HEIGHT }}
            >
              Total
            </div>
            {renderDayTotals(days, perDay)}
          </div>
        </div>
      )}
    </>
  );
}

function renderDayHeaders(days: string[]) {
  const cells: React.ReactNode[] = [];
  for (let index = 0; index < days.length; index++) {
    const day = days[index]!;
    const date = new Date(`${day}T00:00:00Z`);
    const weekday = date.toLocaleDateString("es-AR", { weekday: "short", timeZone: "UTC" });
    const dayNum = date.getUTCDate();
    const workday = isWorkday(day);
    cells.push(
      <div
        key={`h-${day}`}
        className={cn(
          "sticky top-0 z-10 flex flex-col items-center justify-center border-b border-border",
          !workday && "bg-muted",
        )}
        style={{ height: PLANNING_ROW_HEIGHT }}
      >
        <span className="text-caption text-muted-foreground">{weekday}</span>
        <span className="text-caption font-medium">{dayNum}</span>
      </div>,
    );
    // Subtotal column at the end of each week.
    if ((index + 1) % PLANNING_WEEK_SIZE === 0) {
      cells.push(
        <div
          key={`h-sub-${index}`}
          className="sticky top-0 z-10 flex items-center justify-center border-b border-l border-border bg-background text-caption font-medium"
          style={{ height: PLANNING_ROW_HEIGHT }}
        >
          Σ
        </div>,
      );
    }
  }
  return cells;
}

function renderDayTotals(days: string[], perDay: Map<string, number>) {
  const cells: React.ReactNode[] = [];
  for (let index = 0; index < days.length; index++) {
    const day = days[index]!;
    const total = perDay.get(day) ?? 0;
    cells.push(
      <div
        key={`t-${day}`}
        className="flex items-center justify-center border-t border-border text-caption font-medium"
        style={{ height: PLANNING_ROW_HEIGHT }}
      >
        {total > 0 ? formatHours(total) : ""}
      </div>,
    );
    if ((index + 1) % PLANNING_WEEK_SIZE === 0) {
      // Semana al cerrar: suma de los 7 días previos del footer.
      const weekTotal = sumWeekSlice(days, perDay, index - 6, index);
      cells.push(
        <div
          key={`t-sub-${index}`}
          className="flex items-center justify-center border-l border-t border-border bg-background text-caption font-semibold"
          style={{ height: PLANNING_ROW_HEIGHT }}
        >
          {weekTotal > 0 ? formatHours(weekTotal) : ""}
        </div>,
      );
    }
  }
  return cells;
}

function sumWeekSlice(
  days: string[],
  perDay: Map<string, number>,
  fromIndex: number,
  toIndex: number,
): number {
  let total = 0;
  for (let i = fromIndex; i <= toIndex; i++) {
    const day = days[i];
    if (day) total += perDay.get(day) ?? 0;
  }
  return total;
}

function DevRow({
  dev,
  days,
  canEdit,
  perDevDate,
  perDevWeek,
  openCell,
  setOpenCell,
  projectId,
}: {
  dev: PlanningDev;
  days: string[];
  canEdit: boolean;
  perDevDate: Map<string, { id: string; hours: number }>;
  perDevWeek: Map<number, number>;
  openCell: { devId: string; date: string } | null;
  setOpenCell: (next: { devId: string; date: string } | null) => void;
  projectId: string;
}) {
  const cells: React.ReactNode[] = [];
  for (let index = 0; index < days.length; index++) {
    const day = days[index]!;
    const key = `${dev.id}:${day}`;
    const existing = perDevDate.get(key) ?? null;
    const isOpen = openCell?.devId === dev.id && openCell.date === day;
    const workday = isWorkday(day);

    cells.push(
      <Popover
        key={key}
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) setOpenCell(null);
          else if (canEdit) setOpenCell({ devId: dev.id, date: day });
        }}
      >
        <PopoverTrigger
          disabled={!canEdit}
          className={cn(
            "flex items-center justify-center border-r border-b border-border text-caption transition-colors",
            !workday && "bg-muted/50",
            existing
              ? "bg-primary/10 text-primary font-medium"
              : canEdit
                ? "hover:bg-surface-hover cursor-pointer"
                : "",
            !canEdit && "cursor-default",
          )}
          style={{ height: PLANNING_ROW_HEIGHT }}
        >
          {existing ? formatHours(existing.hours) : ""}
        </PopoverTrigger>
        {canEdit && (
          <PopoverContent className="p-3">
            <CapacityPopoverForm
              projectId={projectId}
              devId={dev.id}
              date={day}
              existing={existing}
              onDone={() => setOpenCell(null)}
            />
          </PopoverContent>
        )}
      </Popover>,
    );
    if ((index + 1) % PLANNING_WEEK_SIZE === 0) {
      const weekIndex = Math.floor(index / PLANNING_WEEK_SIZE);
      const weekTotal = perDevWeek.get(weekIndex) ?? 0;
      cells.push(
        <div
          key={`${dev.id}-sub-${weekIndex}`}
          className="flex items-center justify-center border-l border-b border-border bg-background text-caption"
          style={{ height: PLANNING_ROW_HEIGHT }}
        >
          {weekTotal > 0 ? formatHours(weekTotal) : ""}
        </div>,
      );
    }
  }

  return (
    <>
      <div
        className={cn(
          "bg-background sticky left-0 z-10 flex items-center gap-2 border-b border-r border-border px-3 text-ui",
          dev.isExMember && "text-muted-foreground italic",
        )}
        style={{ height: PLANNING_ROW_HEIGHT }}
      >
        <span className="truncate">{dev.name}</span>
        {dev.isProjectPm && (
          <span className="text-caption text-primary">PM</span>
        )}
        {dev.isExMember && (
          <span className="text-caption text-muted-foreground">ex-miembro</span>
        )}
      </div>
      {cells}
    </>
  );
}

function formatHours(h: number): string {
  // Mostramos sin decimales cuando es entero, con 2 cuando no (ej. "4" o
  // "4.5"). El step del input es 0.25 → como mucho 2 decimales relevantes.
  return Number.isInteger(h) ? String(h) : String(Math.round(h * 100) / 100);
}
