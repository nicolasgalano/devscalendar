"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserRole } from "@/lib/auth/roles";
import { formatMinutesDecimal } from "@/lib/time-entries/format";
import type { TimeEntryListItem } from "@/lib/time-entries/query";
import { currentWeekStart, formatDayHeader, getWeekDays, shiftWeek } from "@/lib/time-entries/week";
import { cn } from "@/lib/utils";

import { TimeEntryCard } from "./time-entry-card";
import {
  TimeEntryDialog,
  type TimeEntryActivity,
  type TimeEntryDialogInitial,
  type TimeEntryProject,
  type TimeEntryTicket,
} from "./time-entry-dialog";

/**
 * Grilla semanal "Mi Tiempo" (016 T4.3). Columnas por día (Lun-Dom), cards
 * apiladas dentro de cada columna. Botón "+ Cargar tiempo" arriba, botón
 * "Iniciar cronómetro" al lado. Selector de usuario visible solo cuando el
 * viewer tiene permiso — se pasa como prop `assignees` (empty si no aplica).
 *
 * Todo el estado navegable vive en la URL (`?w=` y `?userId=`) — cambios
 * disparan `router.replace()`. Los dialogs y errores viven en state local.
 */
export function WeeklyGridView({
  weekStart,
  entries,
  viewer,
  viewingUserId,
  viewingUserName,
  assignees,
  projects,
  activitiesByProject,
  ticketsByProject,
}: {
  weekStart: string;
  entries: TimeEntryListItem[];
  viewer: { id: string; roles: UserRole[] };
  /** userId cuya semana se muestra (== viewer.id salvo que un admin/PM esté mirando a otro). */
  viewingUserId: string;
  viewingUserName: string;
  /** Personas seleccionables por el viewer. Vacío = no se muestra el selector. */
  assignees: { id: string; name: string }[];
  projects: TimeEntryProject[];
  activitiesByProject: Record<string, TimeEntryActivity[]>;
  ticketsByProject: Record<string, TimeEntryTicket[]>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogState, setDialogState] = useState<
    | { open: false }
    | { open: true; mode: "create"; loggedAt: string }
    | { open: true; mode: "edit"; entry: TimeEntryListItem }
  >({ open: false });

  const days = getWeekDays(weekStart);
  const isCurrentWeek = weekStart === currentWeekStart();

  // Agrupo entries por día para renderizar rápido.
  const entriesByDay = useMemo(() => {
    const map = new Map<string, TimeEntryListItem[]>();
    for (const day of days) map.set(day, []);
    for (const entry of entries) {
      const bucket = map.get(entry.loggedAt);
      if (bucket) bucket.push(entry);
    }
    return map;
  }, [entries, days]);

  const totalMinutesByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const [day, list] of entriesByDay.entries()) {
      map.set(
        day,
        list.reduce((acc, e) => acc + e.minutes, 0),
      );
    }
    return map;
  }, [entriesByDay]);

  const weekTotal = useMemo(
    () => entries.reduce((acc, e) => acc + e.minutes, 0),
    [entries],
  );

  function buildHref(patch: { w?: string; userId?: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    if (patch.w !== undefined) params.set("w", patch.w);
    if (patch.userId !== undefined) {
      if (patch.userId === null) params.delete("userId");
      else params.set("userId", patch.userId);
    }
    const query = params.toString();
    return query ? `/my-time?${query}` : "/my-time";
  }

  function openCreate(loggedAt: string) {
    setDialogState({ open: true, mode: "create", loggedAt });
  }

  function openEdit(entry: TimeEntryListItem) {
    setDialogState({ open: true, mode: "edit", entry });
  }

  const isViewingOther = viewingUserId !== viewer.id;

  const createInitial: TimeEntryDialogInitial =
    dialogState.open && dialogState.mode === "create"
      ? {
          projectId: projects[0]?.id ?? null,
          ticketId: null,
          activityId: null,
          minutes: 60,
          loggedAt: dialogState.loggedAt,
          startTime: null,
          description: "",
        }
      : {
          projectId: null,
          ticketId: null,
          activityId: null,
          minutes: 60,
          loggedAt: currentWeekStart(),
          startTime: null,
          description: "",
        };

  const editInitial: TimeEntryDialogInitial =
    dialogState.open && dialogState.mode === "edit"
      ? {
          id: dialogState.entry.id,
          projectId: dialogState.entry.project.id,
          ticketId: dialogState.entry.ticket?.id ?? null,
          activityId: dialogState.entry.activity?.id ?? null,
          minutes: dialogState.entry.minutes,
          loggedAt: dialogState.entry.loggedAt,
          startTime: dialogState.entry.startTime,
          description: dialogState.entry.description ?? "",
        }
      : createInitial;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={buildHref({ w: shiftWeek(weekStart, -1) })}
            aria-label="Semana anterior"
          >
            <Button variant="outline" size="icon-sm">
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
          </Link>
          <Link href={buildHref({ w: currentWeekStart() })}>
            <Button variant="outline" size="sm" disabled={isCurrentWeek}>
              Esta semana
            </Button>
          </Link>
          <Link
            href={buildHref({ w: shiftWeek(weekStart, 1) })}
            aria-label="Semana siguiente"
          >
            <Button variant="outline" size="icon-sm">
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </Link>
          <span className="text-ui text-muted-foreground ml-3">
            Total semana:{" "}
            <span className="font-data text-foreground">
              {weekTotal > 0 ? formatMinutesDecimal(weekTotal) : "0h"}
            </span>
          </span>

          {assignees.length > 0 && (
            <div className="ml-4 flex items-center gap-2">
              <span className="text-caption text-muted-foreground">Ver:</span>
              <Select
                value={viewingUserId}
                onValueChange={(next) => {
                  const value = next ?? viewer.id;
                  router.replace(
                    buildHref({ userId: value === viewer.id ? null : value }),
                  );
                }}
              >
                <SelectTrigger size="sm" className="w-fit min-w-40">
                  <SelectValue>{viewingUserName}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  {assignees.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                      {person.id === viewer.id && (
                        <span className="text-caption text-muted-foreground ml-1">
                          (yo)
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isViewingOther && (
                <Badge variant="secondary" className="font-caption">
                  Viendo semana de {viewingUserName}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => openCreate(new Date().toISOString().slice(0, 10))}
            disabled={isViewingOther}
          >
            <PlusIcon aria-hidden="true" />
            Cargar tiempo
          </Button>
          {/* El start del cronómetro también podría vivir acá, pero por ahora
              el user arranca desde el ticket o desde un botón futuro. */}
          <Button variant="outline" size="sm" disabled title="Próximamente">
            <PlayIcon aria-hidden="true" />
            Iniciar cronómetro
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const total = totalMinutesByDay.get(day) ?? 0;
          const dayEntries = entriesByDay.get(day) ?? [];
          const { weekday, day: dayNum } = formatDayHeader(day);
          const isToday = day === new Date().toISOString().slice(0, 10);
          return (
            <div
              key={day}
              className={cn(
                "flex flex-col gap-2 rounded-md",
                "border-border border p-2",
                isToday && "border-primary",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span
                    className={cn(
                      "text-caption capitalize",
                      isToday ? "text-primary font-medium" : "text-muted-foreground",
                    )}
                  >
                    {weekday}
                  </span>
                  <span
                    className={cn(
                      "font-data text-emphasis leading-none",
                      isToday && "text-primary",
                    )}
                  >
                    {dayNum}
                  </span>
                </div>
                <span
                  className={cn(
                    "font-data text-caption rounded-full px-2 py-0.5",
                    total === 0
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary/10 text-primary font-medium",
                  )}
                >
                  {total === 0 ? "0" : formatMinutesDecimal(total)}
                </span>
              </div>

              <div className="flex min-h-24 flex-col gap-1.5">
                {dayEntries.map((entry) => (
                  <TimeEntryCard
                    key={entry.id}
                    entry={entry}
                    viewer={viewer}
                    onEdit={openEdit}
                  />
                ))}
                {!isViewingOther && (
                  <button
                    type="button"
                    onClick={() => openCreate(day)}
                    className={cn(
                      "text-caption text-muted-foreground hover:text-foreground",
                      "border-border hover:border-border-strong flex h-8 items-center justify-center gap-1 rounded-md border border-dashed",
                      "transition-colors",
                    )}
                  >
                    <PlusIcon aria-hidden="true" className="size-3" />
                    Cargar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <TimeEntryDialog
        mode="create"
        open={dialogState.open && dialogState.mode === "create"}
        onOpenChange={(next) => !next && setDialogState({ open: false })}
        initial={createInitial}
        projects={projects}
        activitiesByProject={activitiesByProject}
        ticketsByProject={ticketsByProject}
        userLabel={viewingUserName}
      />

      <TimeEntryDialog
        mode="edit"
        open={dialogState.open && dialogState.mode === "edit"}
        onOpenChange={(next) => !next && setDialogState({ open: false })}
        initial={editInitial}
        projects={projects}
        activitiesByProject={activitiesByProject}
        ticketsByProject={ticketsByProject}
        userLabel={viewingUserName}
      />
    </>
  );
}
