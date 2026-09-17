"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useSyncIndicator } from "@/components/sync-indicator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
  id?: string; // edit only
  projectId: string | null;
  ticketId: string | null;
  activityId: string | null;
  minutes: number;
  loggedAt: string; // YYYY-MM-DD
  description: string;
};

/**
 * Dialog reusado para crear y editar time entries (016 T4.5). En modo edit,
 * el proyecto queda fijo (cambiar de proyecto rompe supuestos de scope). En
 * create, cambiar el proyecto refresca las listas de actividades y tickets.
 *
 * Los inputs de minutos aceptan atajos rápidos: botones `+15` `+30` `+60` que
 * suman al valor actual (o setean si el valor era 0).
 */
export function TimeEntryDialog({
  mode,
  open,
  onOpenChange,
  initial,
  projects,
  activitiesByProject,
  ticketsByProject,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: TimeEntryDialogInitial;
  /** Proyectos donde el user puede cargar (create) o el proyecto de la entry (edit). */
  projects: TimeEntryProject[];
  /** Actividades activas por proyecto — clave = projectId. */
  activitiesByProject: Record<string, TimeEntryActivity[]>;
  /** Tickets abiertos por proyecto — clave = projectId. Opcional. */
  ticketsByProject?: Record<string, TimeEntryTicket[]>;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [form, setForm] = useState<TimeEntryDialogInitial>(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial);
      setError(null);
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

  // Si cambio de proyecto y la actividad/ticket seleccionado ya no aplica, se
  // limpia. Evita mandar valores que el server va a rebotar.
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
  const canSubmit =
    form.projectId !== null &&
    form.minutes > 0 &&
    form.minutes % 15 === 0 &&
    form.loggedAt.length === 10 &&
    (!activityRequired || form.activityId !== null) &&
    !submitting;

  function addMinutes(delta: number) {
    setForm((current) => ({
      ...current,
      minutes: Math.max(15, Math.min(960, current.minutes + delta)),
    }));
  }

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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Cargar tiempo" : "Editar carga"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-ui text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Proyecto</Label>
            <Select
              value={form.projectId ?? ""}
              onValueChange={(value) =>
                setForm({ ...form, projectId: (value as string) || null })
              }
              disabled={mode === "edit" || projects.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elegí un proyecto">
                  {(() => {
                    const p = projects.find((project) => project.id === form.projectId);
                    return p ? p.name : undefined;
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
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
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Actividad {activityRequired && <span className="text-destructive">*</span>}</Label>
              <Select
                value={form.activityId ?? (activityRequired ? "" : NO_ACTIVITY)}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    activityId: value === NO_ACTIVITY ? null : (value as string),
                  })
                }
                disabled={!form.projectId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={activityRequired ? "Elegí una actividad" : "Sin actividad"}>
                    {(() => {
                      const a = availableActivities.find((x) => x.id === form.activityId);
                      return a ? a.name : undefined;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {!activityRequired && (
                    <SelectItem value={NO_ACTIVITY}>Sin actividad</SelectItem>
                  )}
                  {availableActivities.map((activity) => (
                    <SelectItem key={activity.id} value={activity.id}>
                      {activity.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.projectId && availableActivities.length === 0 && (
                <p className="text-caption text-muted-foreground">
                  Este proyecto todavía no tiene actividades definidas.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Ticket (opcional)</Label>
              <Select
                value={form.ticketId ?? NO_TICKET}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    ticketId: value === NO_TICKET ? null : (value as string),
                  })
                }
                disabled={!form.projectId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sin ticket">
                    {(() => {
                      const t = availableTickets.find((x) => x.id === form.ticketId);
                      return t ? `${t.key} · ${t.title}` : undefined;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TICKET}>Sin ticket</SelectItem>
                  {availableTickets.map((ticket) => (
                    <SelectItem key={ticket.id} value={ticket.id}>
                      <span className="font-data text-muted-foreground">{ticket.key}</span>{" "}
                      {ticket.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="entry-date">Fecha</Label>
              <Input
                id="entry-date"
                type="date"
                value={form.loggedAt}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setForm({ ...form, loggedAt: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="entry-minutes">Minutos (múltiplos de 15)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="entry-minutes"
                  type="number"
                  min="15"
                  max="960"
                  step="15"
                  value={form.minutes || ""}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      minutes: Math.max(0, Math.min(960, Number(event.target.value) || 0)),
                    })
                  }
                  className="w-24"
                />
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addMinutes(15)}
                  >
                    +15
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addMinutes(30)}
                  >
                    +30
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addMinutes(60)}
                  >
                    +60
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-description">Descripción (opcional)</Label>
            <Textarea
              id="entry-description"
              value={form.description}
              maxLength={500}
              rows={3}
              placeholder="Qué hiciste (opcional)"
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {mode === "create" ? "Cargar" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
