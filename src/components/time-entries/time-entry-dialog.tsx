"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, ClockIcon, PlusIcon, TimerIcon, XIcon } from "lucide-react";

import { useSyncIndicator } from "@/components/sync-indicator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { cn } from "@/lib/utils";

const NO_TICKET = "__none__";
const NO_ACTIVITY = "__none__";

export type TimeEntryProject = {
  id: string;
  key: string;
  name: string;
  clientName: string | null;
};

export type TimeEntryTicket = {
  id: string;
  key: string;
  title: string;
};

export type TimeEntryActivity = {
  id: string;
  name: string;
  active: boolean;
};

export type TimeEntryDialogInitial = {
  id?: string;
  projectId: string | null;
  ticketId: string | null;
  activityId: string | null;
  minutes: number;
  loggedAt: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM
  description: string;
};

/**
 * Dialog de carga de tiempo, rediseñado en 016 T8 al estilo TrackingTime.
 *
 * Layout:
 *   - Header compacto: fecha (con date picker inline) + selector de usuario
 *     opcional a la derecha + X para cerrar.
 *   - "Horas trabajadas": tres inputs — start (HH:MM), end (HH:MM), duración
 *     calculada (readonly). Cualquiera se puede editar; el blur sincroniza.
 *   - "Proyecto y tarea": selectores stacked single-column con "+" leader que
 *     invita a completarlos. Actividad y ticket aparecen solo cuando aplica.
 *   - "Detalles": textarea corto.
 *   - Botones al pie (Cancelar / Cargar).
 *
 * Regla de múltiplos de 15: si `to - from` no da múltiplo, `to` se ajusta
 * al múltiplo más cercano al blur. El check duro de la base sigue vigente.
 */
export function TimeEntryDialog({
  mode,
  open,
  onOpenChange,
  initial,
  projects,
  activitiesByProject,
  ticketsByProject,
  userLabel,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: TimeEntryDialogInitial;
  projects: TimeEntryProject[];
  activitiesByProject: Record<string, TimeEntryActivity[]>;
  ticketsByProject?: Record<string, TimeEntryTicket[]>;
  /** Nombre a mostrar en el chip del header (solo visual). */
  userLabel?: string;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [form, setForm] = useState<TimeEntryDialogInitial>(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [startInput, setStartInput] = useState<string>(initial.startTime ?? "09:00");
  const [endInput, setEndInput] = useState<string>(
    computeEnd(initial.startTime ?? "09:00", initial.minutes),
  );

  useEffect(() => {
    if (open) {
      setForm(initial);
      setError(null);
      const start = initial.startTime ?? "09:00";
      setStartInput(start);
      setEndInput(computeEnd(start, initial.minutes));
    }
  }, [open, initial]);

  const availableActivities: TimeEntryActivity[] = useMemo(() => {
    if (!form.projectId) return [];
    return activitiesByProject[form.projectId] ?? [];
  }, [form.projectId, activitiesByProject]);

  const availableTickets: TimeEntryTicket[] = useMemo(() => {
    if (!form.projectId || !ticketsByProject) return [];
    return ticketsByProject[form.projectId] ?? [];
  }, [form.projectId, ticketsByProject]);

  useEffect(() => {
    if (mode !== "create") return;
    if (form.activityId && !availableActivities.some((a) => a.id === form.activityId)) {
      setForm((current) => ({ ...current, activityId: null }));
    }
    if (form.ticketId && !availableTickets.some((t) => t.id === form.ticketId)) {
      setForm((current) => ({ ...current, ticketId: null }));
    }
  }, [mode, form.activityId, form.ticketId, availableActivities, availableTickets]);

  const activityRequired = availableActivities.length > 0;

  function syncFromRange(nextStart: string, nextEnd: string) {
    const rawMinutes = minutesBetween(nextStart, nextEnd);
    if (rawMinutes === null || rawMinutes <= 0) return;
    const rounded = roundToStep(rawMinutes, 15);
    const clamped = Math.max(15, Math.min(960, rounded));
    const adjustedEnd = computeEnd(nextStart, clamped);
    setStartInput(nextStart);
    setEndInput(adjustedEnd);
    setForm((current) => ({ ...current, startTime: nextStart, minutes: clamped }));
  }

  const canSubmit =
    form.projectId !== null &&
    form.minutes > 0 &&
    form.minutes % 15 === 0 &&
    form.loggedAt.length === 10 &&
    (!activityRequired || form.activityId !== null) &&
    !submitting;

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    const stop = startSync(mode === "create" ? "Cargando tiempo" : "Guardando cambios");
    try {
      const url =
        mode === "create" ? "/api/time-entries" : `/api/time-entries/${initial.id}`;
      const body: Record<string, unknown> = {
        minutes: form.minutes,
        logged_at: form.loggedAt,
        start_time: form.startTime,
        description: form.description.trim() || null,
        ticket_id: form.ticketId ?? null,
        activity_id: form.activityId ?? null,
      };
      if (mode === "create") body.project_id = form.projectId;

      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        setError(payload.error ?? payload.reason ?? "No se pudo guardar la carga.");
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
      <DialogContent className="max-w-lg">
        <DialogHeader className="mb-2 flex flex-row items-center justify-between gap-3 space-y-0">
          <div className="flex items-center gap-2">
            <CalendarIcon aria-hidden="true" className="text-muted-foreground size-4" />
            <DialogTitle className="text-emphasis font-medium">
              <label className="cursor-pointer">
                {formatHeaderDate(form.loggedAt)}
                <input
                  type="date"
                  value={form.loggedAt}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setForm({ ...form, loggedAt: e.target.value })}
                  className="ml-0 h-0 w-0 opacity-0"
                  aria-label="Fecha"
                />
              </label>
            </DialogTitle>
          </div>
          {userLabel && (
            <div className="border-input flex items-center gap-2 rounded-full border py-0.5 pr-3 pl-1">
              <div className="bg-muted flex size-6 items-center justify-center rounded-full text-caption font-medium">
                {initialsOf(userLabel)}
              </div>
              <span className="text-ui text-secondary-foreground">{userLabel}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
            className="text-muted-foreground hover:text-foreground rounded-md p-1"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="text-ui text-destructive">
              {error}
            </p>
          )}

          {/* Horas trabajadas ─────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-caption text-muted-foreground font-medium">
              Horas trabajadas
            </Label>
            <div className="grid grid-cols-[1fr_auto_1fr_1fr] items-center gap-2">
              <div className="border-input flex items-center gap-2 rounded-md border bg-transparent px-2.5 py-1.5">
                <ClockIcon aria-hidden="true" className="text-muted-foreground size-4" />
                <input
                  type="time"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  onBlur={() => syncFromRange(startInput, endInput)}
                  className="font-data text-foreground w-full bg-transparent outline-none"
                />
              </div>
              <span aria-hidden="true" className="text-muted-foreground">
                —
              </span>
              <div className="border-input flex items-center gap-2 rounded-md border bg-transparent px-2.5 py-1.5">
                <ClockIcon aria-hidden="true" className="text-muted-foreground size-4" />
                <input
                  type="time"
                  value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  onBlur={() => syncFromRange(startInput, endInput)}
                  className="font-data text-foreground w-full bg-transparent outline-none"
                />
              </div>
              <div className="border-input bg-muted flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                <TimerIcon aria-hidden="true" className="text-muted-foreground size-4" />
                <span className="font-data text-foreground w-full">
                  {formatDuration(form.minutes)}
                </span>
              </div>
            </div>
          </div>

          {/* Proyecto y tarea ─────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <Label className="text-caption text-muted-foreground font-medium">
              Proyecto y tarea
            </Label>
            <SelectorRow
              placeholder="Elegí un proyecto"
              value={form.projectId ?? ""}
              disabled={mode === "edit" || projects.length === 0}
              onChange={(value) =>
                setForm({ ...form, projectId: (value as string) || null })
              }
              display={projects.find((p) => p.id === form.projectId)?.name}
              iconTone={form.projectId ? "muted" : "primary"}
            >
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.clientName ? (
                    <span className="text-muted-foreground">
                      {project.clientName} ·{" "}
                    </span>
                  ) : null}
                  {project.name}
                </SelectItem>
              ))}
            </SelectorRow>

            {form.projectId && availableActivities.length > 0 && (
              <SelectorRow
                placeholder={
                  activityRequired ? "Elegí una actividad" : "Sin actividad"
                }
                value={form.activityId ?? (activityRequired ? "" : NO_ACTIVITY)}
                onChange={(value) =>
                  setForm({
                    ...form,
                    activityId: value === NO_ACTIVITY ? null : (value as string),
                  })
                }
                display={availableActivities.find((a) => a.id === form.activityId)?.name}
                iconTone={form.activityId ? "muted" : "primary"}
              >
                {!activityRequired && (
                  <SelectItem value={NO_ACTIVITY}>Sin actividad</SelectItem>
                )}
                {availableActivities.map((activity) => (
                  <SelectItem key={activity.id} value={activity.id}>
                    {activity.name}
                  </SelectItem>
                ))}
              </SelectorRow>
            )}
            {form.projectId && availableActivities.length === 0 && (
              <p className="text-caption text-muted-foreground pl-1">
                Este proyecto todavía no tiene actividades definidas.
              </p>
            )}

            {form.projectId && availableTickets.length > 0 && (
              <SelectorRow
                placeholder="Elegí un ticket (opcional)"
                value={form.ticketId ?? NO_TICKET}
                onChange={(value) =>
                  setForm({
                    ...form,
                    ticketId: value === NO_TICKET ? null : (value as string),
                  })
                }
                display={(() => {
                  const t = availableTickets.find((x) => x.id === form.ticketId);
                  return t ? `${t.key} · ${t.title}` : undefined;
                })()}
                iconTone={form.ticketId ? "muted" : "primary"}
              >
                <SelectItem value={NO_TICKET}>Sin ticket</SelectItem>
                {availableTickets.map((ticket) => (
                  <SelectItem key={ticket.id} value={ticket.id}>
                    <span className="font-data text-muted-foreground">{ticket.key}</span>{" "}
                    {ticket.title}
                  </SelectItem>
                ))}
              </SelectorRow>
            )}
          </div>

          {/* Detalles ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-caption text-muted-foreground font-medium">
              Detalles
            </Label>
            <Textarea
              value={form.description}
              maxLength={500}
              rows={2}
              placeholder="Añadir detalles (opcional)"
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="min-w-24">
            {mode === "create" ? "Cargar" : "Guardar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SelectorRow({
  placeholder,
  value,
  onChange,
  disabled,
  display,
  iconTone,
  children,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  display?: string;
  iconTone: "muted" | "primary";
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full justify-start">
        <PlusIcon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            iconTone === "primary" ? "text-primary" : "text-muted-foreground",
          )}
        />
        <SelectValue placeholder={placeholder}>{display}</SelectValue>
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

// Helpers de tiempo ──────────────────────────────────────────────

function minutesBetween(from: string, to: string): number | null {
  const f = parseTime(from);
  const t = parseTime(to);
  if (f === null || t === null) return null;
  const diff = t - f;
  return diff > 0 ? diff : null;
}

function parseTime(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function computeEnd(startHhmm: string, minutes: number): string {
  const start = parseTime(startHhmm);
  if (start === null) return "09:00";
  const total = (start + minutes) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatHeaderDate(dateIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso;
  const d = new Date(`${dateIso}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return formatter.format(d).replace(/\.$/, "");
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}
