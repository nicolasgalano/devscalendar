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
import type {
  AllPlanningRow,
  CapacityEstimateRow,
  PlanningDev,
} from "@/lib/planning/capacity";
import {
  PLANNING_CELL_WIDTH,
  PLANNING_LABEL_WIDTH,
  PLANNING_ROW_HEIGHT,
  PLANNING_WEEK_SIZE,
} from "@/lib/planning/constants";
import {
  sumByDay,
  sumByDevWeek,
  sumByProjectDay,
} from "@/lib/planning/totals";
import { planningHref, type PlanningUrl } from "@/lib/planning/url";
import type { ProjectListRow } from "@/lib/projects/workspace";
import { cn } from "@/lib/utils";

import { CapacityPopoverForm } from "./capacity-popover";

const SUBTOTAL_WIDTH = 56;

type LayoutRow =
  | { kind: "client"; id: string; name: string }
  | {
      kind: "project";
      id: string;
      key: string;
      name: string;
    }
  | {
      kind: "dev";
      rowKey: string;
      project: AllPlanningRow["project"];
      dev: PlanningDev;
      canEdit: boolean;
    }
  | { kind: "project-total"; id: string };

/**
 * Feature 029: grilla de planificación de capacidad.
 *
 * Jerárquica: cliente > proyecto > dev > total del proyecto. Un solo
 * proyecto se muestra con el mismo layout (una fila de cliente, una de
 * proyecto, sus devs, un total) por consistencia.
 *
 * Densidad y constantes compartidas con `/calendar?view=planning` via
 * `src/lib/planning/constants.ts`. La semántica es distinta: celda
 * editable + popover + totales por proyecto y por día.
 *
 * Permisos: `canEditByProject` indexa por project.id. El PM primario de X
 * puede editar celdas de X y nada más; admin puede editar todas.
 */
export function CapacityPlanningView({
  projects,
  selectedProjectKey,
  rows,
  estimates,
  canEditByProject,
  days,
  weekStart,
  urlState,
}: {
  projects: ProjectListRow[];
  selectedProjectKey: string | null;
  rows: AllPlanningRow[];
  estimates: CapacityEstimateRow[];
  canEditByProject: Map<string, boolean>;
  days: string[];
  weekStart: string | null;
  currentUserId: string;
  urlState: PlanningUrl;
}) {
  const router = useRouter();

  const perDay = useMemo(() => sumByDay(estimates), [estimates]);
  const perDevWeek = useMemo(() => sumByDevWeek(estimates, days), [estimates, days]);
  const perProjectDay = useMemo(() => sumByProjectDay(estimates), [estimates]);
  const perDevDate = useMemo(() => {
    // Keyed por projectId:devId:date — el mismo dev puede estar en varios
    // proyectos y una key sola por dev colapsaría los dos.
    const map = new Map<string, { id: string; hours: number }>();
    for (const estimate of estimates) {
      map.set(
        `${estimate.projectId}:${estimate.devId}:${estimate.date}`,
        { id: estimate.id, hours: estimate.hours },
      );
    }
    return map;
  }, [estimates]);

  const layoutRows = useMemo(() => buildLayoutRows(rows, canEditByProject), [
    rows,
    canEditByProject,
  ]);

  const [openCell, setOpenCell] = useState<{
    rowKey: string;
    date: string;
  } | null>(null);

  function onProjectChange(nextKey: string | null) {
    if (!nextKey) return;
    const target = nextKey === "__all__" ? null : nextKey;
    router.push(planningHref(urlState, { project: target, w: null }));
  }

  function navWeek(byWeeks: number) {
    if (!weekStart) return;
    router.push(planningHref(urlState, { w: addDays(weekStart, byWeeks * 7) }));
  }

  const gridTemplateColumns = [
    `${PLANNING_LABEL_WIDTH}px`,
    ...Array.from({ length: 4 }, () =>
      `repeat(${PLANNING_WEEK_SIZE}, ${PLANNING_CELL_WIDTH}px) ${SUBTOTAL_WIDTH}px`,
    ),
  ].join(" ");

  const totalColumns = 1 + 4 * (PLANNING_WEEK_SIZE + 1); // 33

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={selectedProjectKey ?? "__all__"}
          onValueChange={onProjectChange}
        >
          <SelectTrigger size="sm" className="w-64">
            <SelectValue>
              {selectedProjectKey
                ? selectedProjectLabel(projects, selectedProjectKey)
                : "Todos los proyectos"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos los proyectos</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.key}>
                {p.key} · {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="icon-sm" onClick={() => navWeek(-1)}>
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
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
      </div>

      {rows.length === 0 ? (
        <div className="border-border rounded-lg border p-10 text-center">
          <p className="text-ui text-muted-foreground">
            {selectedProjectKey
              ? "Este proyecto no tiene miembros activos todavía."
              : "No hay proyectos activos para mostrar."}
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

            {/* Data rows */}
            {layoutRows.map((row) => {
              if (row.kind === "client") {
                return (
                  <HeaderRow
                    key={`client-${row.id}`}
                    label={row.name}
                    totalColumns={totalColumns}
                    emphasis
                  />
                );
              }
              if (row.kind === "project") {
                return (
                  <HeaderRow
                    key={`project-${row.id}`}
                    label={`${row.key} · ${row.name}`}
                    totalColumns={totalColumns}
                    indent={1}
                  />
                );
              }
              if (row.kind === "project-total") {
                return (
                  <ProjectTotalRow
                    key={`total-${row.id}`}
                    projectId={row.id}
                    days={days}
                    perProjectDay={perProjectDay.get(row.id) ?? new Map()}
                  />
                );
              }
              return (
                <DevRow
                  key={row.rowKey}
                  rowKey={row.rowKey}
                  project={row.project}
                  dev={row.dev}
                  days={days}
                  canEdit={row.canEdit && !row.dev.isExMember}
                  perDevDate={perDevDate}
                  perDevWeek={
                    perDevWeek.get(`${row.project.id}:${row.dev.id}`) ?? new Map()
                  }
                  openCell={openCell}
                  setOpenCell={setOpenCell}
                />
              );
            })}

            {/* Footer: totales por día globales */}
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

function buildLayoutRows(
  rows: AllPlanningRow[],
  canEditByProject: Map<string, boolean>,
): LayoutRow[] {
  const out: LayoutRow[] = [];
  let lastClient: string | null = null;
  let lastProject: string | null = null;

  for (const row of rows) {
    if (row.client.id !== lastClient) {
      // Al cambiar de cliente también se cierra el proyecto previo con
      // su fila total.
      if (lastProject) {
        out.push({ kind: "project-total", id: lastProject });
      }
      out.push({ kind: "client", id: row.client.id, name: row.client.name });
      lastClient = row.client.id;
      lastProject = null;
    }
    if (row.project.id !== lastProject) {
      if (lastProject) {
        out.push({ kind: "project-total", id: lastProject });
      }
      out.push({
        kind: "project",
        id: row.project.id,
        key: row.project.key,
        name: row.project.name,
      });
      lastProject = row.project.id;
    }

    out.push({
      kind: "dev",
      rowKey: `${row.project.id}:${row.dev.id}`,
      project: row.project,
      dev: row.dev,
      canEdit: canEditByProject.get(row.project.id) ?? false,
    });
  }
  // Cierre del último proyecto.
  if (lastProject) {
    out.push({ kind: "project-total", id: lastProject });
  }
  return out;
}

function selectedProjectLabel(
  projects: ProjectListRow[],
  key: string,
): string | undefined {
  const match = projects.find((p) => p.key === key);
  return match ? `${match.key} · ${match.name}` : key;
}

function HeaderRow({
  label,
  totalColumns,
  emphasis,
  indent = 0,
}: {
  label: string;
  totalColumns: number;
  emphasis?: boolean;
  indent?: number;
}) {
  return (
    <div
      className={cn(
        "bg-background sticky left-0 z-10 flex items-center border-b border-r border-border text-ui",
        emphasis ? "font-semibold" : "text-muted-foreground font-medium",
      )}
      style={{
        gridColumn: `1 / span ${totalColumns}`,
        height: PLANNING_ROW_HEIGHT,
        paddingLeft: 12 + indent * 16,
      }}
    >
      <span className="truncate">{label}</span>
    </div>
  );
}

function renderDayHeaders(days: string[]) {
  const cells: React.ReactNode[] = [];
  for (let index = 0; index < days.length; index++) {
    const day = days[index]!;
    const date = new Date(`${day}T00:00:00Z`);
    const weekday = date.toLocaleDateString("es-AR", {
      weekday: "short",
      timeZone: "UTC",
    });
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

function ProjectTotalRow({
  projectId,
  days,
  perProjectDay,
}: {
  projectId: string;
  days: string[];
  perProjectDay: Map<string, number>;
}) {
  const cells: React.ReactNode[] = [];
  for (let index = 0; index < days.length; index++) {
    const day = days[index]!;
    const total = perProjectDay.get(day) ?? 0;
    cells.push(
      <div
        key={`pt-${projectId}-${day}`}
        className="flex items-center justify-center border-b border-r border-border bg-muted/30 text-caption font-medium"
        style={{ height: PLANNING_ROW_HEIGHT }}
      >
        {total > 0 ? formatHours(total) : ""}
      </div>,
    );
    if ((index + 1) % PLANNING_WEEK_SIZE === 0) {
      const weekTotal = sumWeekSlice(days, perProjectDay, index - 6, index);
      cells.push(
        <div
          key={`pt-${projectId}-sub-${index}`}
          className="flex items-center justify-center border-b border-l border-border bg-muted/30 text-caption font-semibold"
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
        className="bg-muted/30 sticky left-0 z-10 flex items-center border-b border-r border-border px-3 text-caption font-medium text-muted-foreground"
        style={{
          height: PLANNING_ROW_HEIGHT,
          paddingLeft: 12 + 2 * 16,
        }}
      >
        Total proyecto
      </div>
      {cells}
    </>
  );
}

function DevRow({
  rowKey,
  project,
  dev,
  days,
  canEdit,
  perDevDate,
  perDevWeek,
  openCell,
  setOpenCell,
}: {
  rowKey: string;
  project: AllPlanningRow["project"];
  dev: PlanningDev;
  days: string[];
  canEdit: boolean;
  perDevDate: Map<string, { id: string; hours: number }>;
  perDevWeek: Map<number, number>;
  openCell: { rowKey: string; date: string } | null;
  setOpenCell: (next: { rowKey: string; date: string } | null) => void;
}) {
  const cells: React.ReactNode[] = [];
  for (let index = 0; index < days.length; index++) {
    const day = days[index]!;
    const key = `${project.id}:${dev.id}:${day}`;
    const existing = perDevDate.get(key) ?? null;
    const isOpen =
      openCell?.rowKey === rowKey && openCell.date === day;
    const workday = isWorkday(day);

    cells.push(
      <Popover
        key={key}
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) setOpenCell(null);
          else if (canEdit) setOpenCell({ rowKey, date: day });
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
              projectId={project.id}
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
          key={`${rowKey}-sub-${weekIndex}`}
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
          "bg-background sticky left-0 z-10 flex items-center gap-2 border-b border-r border-border text-ui",
          dev.isExMember && "text-muted-foreground italic",
        )}
        style={{
          height: PLANNING_ROW_HEIGHT,
          paddingLeft: 12 + 2 * 16,
        }}
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
  return Number.isInteger(h) ? String(h) : String(Math.round(h * 100) / 100);
}
