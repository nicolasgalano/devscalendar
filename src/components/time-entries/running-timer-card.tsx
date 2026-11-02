"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ClockIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  StopCircleIcon,
  Trash2Icon,
} from "lucide-react";

import { useSyncIndicator } from "@/components/sync-indicator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatSecondsClock } from "@/lib/time-entries/format";
import type { ActiveTimer } from "@/lib/time-entries/query";
import { cn } from "@/lib/utils";

import { SearchableSelector } from "./searchable-selector";
import type {
  TimeEntryActivity,
  TimeEntryProject,
  TimeEntryTicket,
} from "./time-entry-dialog";

/**
 * Card del cronómetro corriendo en la grilla de `/my-time` (feature 030).
 * Vive en la columna del día del `started_at` local Buenos Aires (misma
 * zona que usa `stop_timer` para derivar `logged_at`). Reemplaza al
 * patrón anterior de "solo pill flotante" — ahora el timer también
 * ocupa su casillero visual mientras corre.
 *
 * Muestra:
 *   - Contador vivo H:MM:SS (patrón de `<TimerPill>`, update cada 1 s).
 *   - Project, activity (si hay), ticket key (si hay), description (si hay).
 *   - Hora de inicio HH:MM del started_at en zona BA.
 *   - Botones de Parar y Descartar al hover.
 *
 * Click en la card (fuera de los botones) → `<RunningTimerEditDialog>`
 * con todos los campos editables en vivo: project (searchable), activity,
 * ticket (searchable), started_at (time input), description (textarea).
 */
export function RunningTimerCard({
  activeTimer,
  projects,
  activitiesByProject,
  ticketsByProject,
}: {
  activeTimer: ActiveTimer;
  projects: TimeEntryProject[];
  activitiesByProject: Record<string, TimeEntryActivity[]>;
  ticketsByProject: Record<string, TimeEntryTicket[]>;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setTick((n) => n + 1), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const elapsedSeconds = useMemo(() => {
    void tick;
    const now = Date.now();
    const started = new Date(activeTimer.startedAt).getTime();
    return Math.max(0, Math.floor((now - started) / 1_000));
  }, [activeTimer.startedAt, tick]);

  const startHHMM = useMemo(() => {
    return new Intl.DateTimeFormat("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(new Date(activeTimer.startedAt));
  }, [activeTimer.startedAt]);

  async function stopTimer() {
    setError(null);
    const stop = startSync("Parando cronómetro");
    try {
      const res = await fetch("/api/time-entries/timer/stop", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "No se pudo parar el cronómetro.");
        return;
      }
      const payload = (await res.json()) as { entry_id: string };
      router.push(`/my-time?edit=${payload.entry_id}`);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      stop();
    }
  }

  async function discardTimer() {
    setError(null);
    const stop = startSync("Descartando cronómetro");
    try {
      const res = await fetch("/api/time-entries/timer/discard", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "No se pudo descartar el cronómetro.");
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      stop();
    }
  }

  return (
    <>
      <div
        className={cn(
          "group border-primary bg-primary/5 relative flex flex-col gap-1 rounded-md border-2 p-2",
          "hover:border-primary transition-colors",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-caption text-primary inline-flex items-center gap-1 font-medium">
            <PlayIcon aria-hidden="true" className="size-3" />
            Corriendo
          </span>
          <span className="font-data text-caption text-primary tabular-nums">
            {formatSecondsClock(elapsedSeconds)}
          </span>
        </div>

        {activeTimer.ticketKey ? (
          <Link
            href={`/tickets/${activeTimer.ticketKey}`}
            className="font-data text-caption text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {activeTimer.ticketKey}
          </Link>
        ) : null}

        <p className="text-ui text-foreground leading-tight">
          {activeTimer.activityName ?? (
            <span className="text-muted-foreground italic">Sin tarea</span>
          )}
        </p>
        <p className="text-caption text-muted-foreground truncate">
          {activeTimer.projectName}
        </p>

        {activeTimer.description && (
          <p className="text-caption text-muted-foreground line-clamp-2">
            {activeTimer.description}
          </p>
        )}

        <p className="text-caption text-muted-foreground inline-flex items-center gap-1">
          <ClockIcon aria-hidden="true" className="size-3" />
          desde {startHHMM}
        </p>

        {error && (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        )}

        <div className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setEditing(true)}
            aria-label="Editar cronómetro"
            title="Editar cronómetro"
          >
            <PencilIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={stopTimer}
            aria-label="Parar y guardar"
            title="Parar y guardar"
          >
            <StopCircleIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={discardTimer}
            aria-label="Descartar sin guardar"
            title="Descartar sin guardar"
            className="text-destructive"
          >
            <Trash2Icon aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>

      <RunningTimerEditDialog
        open={editing}
        onOpenChange={setEditing}
        activeTimer={activeTimer}
        projects={projects}
        activitiesByProject={activitiesByProject}
        ticketsByProject={ticketsByProject}
      />
    </>
  );
}

/**
 * Dialog interno con todos los campos editables in-flight. PATCH a
 * `/api/time-entries/timer`. Si el server devuelve 404 `no_timer` (otro
 * tab stopeó mientras editábamos), avisamos y refrescamos.
 */
function RunningTimerEditDialog({
  open,
  onOpenChange,
  activeTimer,
  projects,
  activitiesByProject,
  ticketsByProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTimer: ActiveTimer;
  projects: TimeEntryProject[];
  activitiesByProject: Record<string, TimeEntryActivity[]>;
  ticketsByProject: Record<string, TimeEntryTicket[]>;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();

  const [projectId, setProjectId] = useState<string | null>(activeTimer.projectId);
  const [activityId, setActivityId] = useState<string | null>(activeTimer.activityId);
  const [ticketId, setTicketId] = useState<string | null>(activeTimer.ticketId);
  const [startedAtInput, setStartedAtInput] = useState<string>(() =>
    toLocalTimeHHMM(activeTimer.startedAt),
  );
  const [description, setDescription] = useState<string>(activeTimer.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setProjectId(activeTimer.projectId);
      setActivityId(activeTimer.activityId);
      setTicketId(activeTimer.ticketId);
      setStartedAtInput(toLocalTimeHHMM(activeTimer.startedAt));
      setDescription(activeTimer.description ?? "");
      setError(null);
      setSubmitting(false);
    }
  }, [open, activeTimer]);

  const availableActivities = useMemo(() => {
    if (!projectId) return [];
    return activitiesByProject[projectId] ?? [];
  }, [projectId, activitiesByProject]);

  const availableTickets = useMemo(() => {
    if (!projectId) return [];
    return ticketsByProject[projectId] ?? [];
  }, [projectId, ticketsByProject]);

  const activityRequired = availableActivities.length > 0;
  const canSubmit =
    projectId !== null && (!activityRequired || activityId !== null) && !submitting;

  async function submit() {
    if (!projectId) return;
    setError(null);
    setSubmitting(true);
    const stop = startSync("Guardando cambios del cronómetro");
    try {
      const body: Record<string, unknown> = {
        description: description.trim() || null,
      };
      // Mando project_id solo si cambió; si cambió, incluyo también activity
      // y ticket (que ya pueden haberse limpiado por el onChange del project).
      if (projectId !== activeTimer.projectId) {
        body.project_id = projectId;
      }
      if (activityId !== activeTimer.activityId) {
        body.activity_id = activityId;
      }
      if (ticketId !== activeTimer.ticketId) {
        body.ticket_id = ticketId;
      }
      // started_at: si cambió la hora del input, armo un ISO combinando con
      // la fecha local del started_at original (si el user quiere mover al
      // día previo, lo maneja desde el server con un valor ya datetime).
      const nextStartedAt = combineStartedAt(activeTimer.startedAt, startedAtInput);
      if (nextStartedAt && nextStartedAt !== activeTimer.startedAt) {
        body.started_at = nextStartedAt;
      }

      if (Object.keys(body).length === 0) {
        onOpenChange(false);
        return;
      }

      const res = await fetch("/api/time-entries/timer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        if (payload.reason === "no_timer") {
          router.refresh();
          onOpenChange(false);
          return;
        }
        setError(payload.error ?? "No se pudo guardar.");
        return;
      }
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
      stop();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-emphasis font-medium">
            Editar cronómetro
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 pt-2">
          {error && (
            <p role="alert" className="text-ui text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label className="text-caption text-muted-foreground font-medium">
              Hora de inicio
            </Label>
            <div className="border-input flex items-center gap-2 rounded-md border bg-transparent px-2.5 py-1.5">
              <ClockIcon aria-hidden="true" className="text-muted-foreground size-4" />
              <input
                type="time"
                value={startedAtInput}
                onChange={(e) => setStartedAtInput(e.target.value)}
                className="font-data text-foreground w-full bg-transparent outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-caption text-muted-foreground font-medium">
              Proyecto y tarea
            </Label>

            <SearchableSelector
              placeholder="Elegí un proyecto"
              searchPlaceholder="Buscar proyecto…"
              emptyMessage="No se encontraron proyectos"
              value={projectId}
              disabled={projects.length === 0}
              onChange={(value) => {
                setProjectId(value);
                setActivityId(null);
                setTicketId(null);
              }}
              items={projects.map((p) => ({
                id: p.id,
                label: p.name,
                meta: p.clientName ?? undefined,
              }))}
            />

            {projectId && availableActivities.length > 0 && (
              <Select
                value={activityId ?? ""}
                onValueChange={(value) => setActivityId((value as string) || null)}
              >
                <SelectTrigger className="w-full justify-start">
                  <PlusIcon
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0",
                      activityId ? "text-muted-foreground" : "text-primary",
                    )}
                  />
                  <SelectValue placeholder="Elegí una tarea">
                    {availableActivities.find((a) => a.id === activityId)?.name ??
                      "Elegí una tarea"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableActivities.map((activity) => (
                    <SelectItem key={activity.id} value={activity.id}>
                      {activity.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {projectId && availableActivities.length === 0 && (
              <p className="text-caption text-muted-foreground pl-1">
                Este proyecto todavía no tiene tareas definidas.
              </p>
            )}

            {projectId && availableTickets.length > 0 && (
              <SearchableSelector
                placeholder="Sin ticket"
                searchPlaceholder="Buscar ticket…"
                emptyMessage="No se encontraron tickets"
                value={ticketId}
                onChange={(value) => setTicketId(value)}
                items={availableTickets.map((t) => ({
                  id: t.id,
                  label: t.title,
                  meta: t.key,
                }))}
                clearable
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-caption text-muted-foreground font-medium">
              Notas
            </Label>
            <Textarea
              value={description}
              maxLength={500}
              rows={2}
              placeholder="Añadir detalles (opcional)"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="min-w-24">
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helpers ─────────────────────────────────────────────────────────

function toLocalTimeHHMM(startedAt: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(startedAt));
}

/**
 * Combina el `started_at` original con una nueva hora HH:MM: preserva la
 * fecha local Buenos Aires del `started_at` y reemplaza la parte horaria.
 * Devuelve el ISO datetime UTC resultante, o `null` si el HH:MM es
 * inválido. El server valida el `no futuro`.
 */
function combineStartedAt(originalStartedAt: string, hhmm: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  if (
    h === undefined ||
    m === undefined ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  ) {
    return null;
  }
  // Fecha local YYYY-MM-DD del started_at en zona BA. Luego construimos el
  // string `YYYY-MM-DDTHH:MM:00-03:00` para preservar la zona.
  const localDay = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(originalStartedAt));
  const localIso = `${localDay}T${hhmm}:00-03:00`;
  const d = new Date(localIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
