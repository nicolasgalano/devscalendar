"use client";

import { PlayIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
import { cn } from "@/lib/utils";

import { SearchableSelector } from "./searchable-selector";
import type {
  TimeEntryActivity,
  TimeEntryProject,
  TimeEntryTicket,
} from "./time-entry-dialog";
import { buildStartPayload, type TimerStartFormState } from "./timer-start-payload";

/**
 * 027. Dialog para arrancar un cronómetro desde `/my-time`. Reusa los
 * selectores del `<TimeEntryDialog>` (`<SearchableSelector>` para proyecto y
 * ticket, `<Select>` plano para tarea), sin pedir horarios — el start lo
 * registra el server al confirmar.
 *
 * El endpoint `/api/time-entries/timer/start` (016 T2.5) ya acepta este
 * payload sin cambios y se encarga de:
 *   - parar el timer anterior si había uno (RPC atómica `stop_and_start_timer`),
 *   - validar cross-project (ticket + activity),
 *   - rechazar con 400 `reason: 'activity_required'` si el proyecto exige
 *     actividad y no viene.
 */
export function TimerStartDialog({
  open,
  onOpenChange,
  projects,
  activitiesByProject,
  ticketsByProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: TimeEntryProject[];
  activitiesByProject: Record<string, TimeEntryActivity[]>;
  ticketsByProject: Record<string, TimeEntryTicket[]>;
}) {
  const router = useRouter();
  const [state, setState] = useState<TimerStartFormState>({
    projectId: null,
    activityId: null,
    ticketId: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset al abrir — no queremos arrastrar la selección de un intento previo
  // que se canceló.
  useEffect(() => {
    if (open) {
      setState({ projectId: null, activityId: null, ticketId: null });
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const availableActivities: TimeEntryActivity[] = useMemo(() => {
    if (!state.projectId) return [];
    return activitiesByProject[state.projectId] ?? [];
  }, [state.projectId, activitiesByProject]);

  const availableTickets: TimeEntryTicket[] = useMemo(() => {
    if (!state.projectId) return [];
    return ticketsByProject[state.projectId] ?? [];
  }, [state.projectId, ticketsByProject]);

  // Si al cambiar de proyecto el activity o ticket actuales dejan de ser
  // válidos, se resetean — evita payloads que el server va a rebotar como
  // "no pertenece al proyecto".
  useEffect(() => {
    if (state.activityId && !availableActivities.some((a) => a.id === state.activityId)) {
      setState((cur) => ({ ...cur, activityId: null }));
    }
    if (state.ticketId && !availableTickets.some((t) => t.id === state.ticketId)) {
      setState((cur) => ({ ...cur, ticketId: null }));
    }
  }, [state.activityId, state.ticketId, availableActivities, availableTickets]);

  const activityRequired = availableActivities.length > 0;
  const canSubmit =
    state.projectId !== null && (!activityRequired || state.activityId !== null) && !submitting;

  async function submit() {
    const payload = buildStartPayload(state);
    if (!payload) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/time-entries/timer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        if (res.status === 403) {
          setError(body.error ?? "No tenés permiso para iniciar un cronómetro en este proyecto.");
        } else if (body.reason === "activity_required") {
          setError("Este proyecto exige elegir una tarea antes de arrancar.");
        } else {
          setError(body.error ?? "No se pudo iniciar el cronómetro.");
        }
        return;
      }

      onOpenChange(false);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-emphasis font-medium">
            Iniciar cronómetro
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-2">
          {error && (
            <p role="alert" className="text-ui text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label className="text-caption text-muted-foreground font-medium">
              Proyecto y tarea
            </Label>

            <SearchableSelector
              placeholder="Elegí un proyecto"
              searchPlaceholder="Buscar proyecto…"
              emptyMessage="No se encontraron proyectos"
              value={state.projectId}
              disabled={projects.length === 0}
              onChange={(value) =>
                setState({ projectId: value, activityId: null, ticketId: null })
              }
              items={projects.map((p) => ({
                id: p.id,
                label: p.name,
                meta: p.clientName ?? undefined,
              }))}
            />

            {state.projectId && availableActivities.length > 0 && (
              <Select
                value={state.activityId ?? ""}
                onValueChange={(value) =>
                  setState({ ...state, activityId: (value as string) || null })
                }
              >
                <SelectTrigger className="w-full justify-start">
                  <PlusIcon
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0",
                      state.activityId ? "text-muted-foreground" : "text-primary",
                    )}
                  />
                  <SelectValue placeholder="Elegí una tarea">
                    {availableActivities.find((a) => a.id === state.activityId)?.name ??
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
            {state.projectId && availableActivities.length === 0 && (
              <p className="text-caption text-muted-foreground pl-1">
                Este proyecto todavía no tiene tareas definidas.
              </p>
            )}

            {state.projectId && availableTickets.length > 0 && (
              <SearchableSelector
                placeholder="Sin ticket"
                searchPlaceholder="Buscar ticket…"
                emptyMessage="No se encontraron tickets"
                value={state.ticketId}
                onChange={(value) => setState({ ...state, ticketId: value })}
                items={availableTickets.map((t) => ({
                  id: t.id,
                  label: t.title,
                  meta: t.key,
                }))}
                clearable
              />
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="min-w-24">
            <PlayIcon aria-hidden="true" className="size-4" />
            Iniciar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
