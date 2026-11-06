"use client";

import { AlertTriangleIcon, PlayIcon, PlusIcon } from "lucide-react";
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
import {
  clearDraft,
  readDraft,
  writeDraft,
} from "@/lib/time-entries/draft-storage";
import { humanizeElapsed } from "@/lib/time-entries/format";
import type { ActiveTimer } from "@/lib/time-entries/query";
import { cn } from "@/lib/utils";

import { SearchableSelector } from "./searchable-selector";
import type {
  TimeEntryActivity,
  TimeEntryProject,
  TimeEntryTicket,
} from "./time-entry-dialog";
import { buildStartPayload, type TimerStartFormState } from "./timer-start-payload";

const DRAFT_KEY = "timer-start-draft";

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
  initialValues,
  viewerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: TimeEntryProject[];
  activitiesByProject: Record<string, TimeEntryActivity[]>;
  ticketsByProject: Record<string, TimeEntryTicket[]>;
  /**
   * 030: pre-rellenar el form con estos valores al abrir — se usa desde el
   * botón "play" de una card para repetir una tarea sin volver a elegir
   * project/activity/ticket.
   */
  initialValues?: TimerStartFormState;
  /** 030: scope del draft en localStorage. Si no viene, no persiste. */
  viewerId?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<TimerStartFormState>(
    initialValues ?? { projectId: null, activityId: null, ticketId: null },
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 030: si el server devuelve 409 timer_active, mostramos un bloque con
  // dos acciones (guardar/descartar) antes de reintentar el start.
  const [activeTimerWarning, setActiveTimerWarning] = useState<ActiveTimer | null>(
    null,
  );
  const [tick, setTick] = useState(0); // para el "corriendo desde X" vivo

  // Reset al abrir — no queremos arrastrar la selección de un intento previo
  // que se canceló. Prioridades: initialValues (flujo play) > draft persistido
  // > vacío.
  useEffect(() => {
    if (open) {
      if (initialValues) {
        setState(initialValues);
      } else {
        const draft = viewerId ? readDraft<TimerStartFormState>(DRAFT_KEY, viewerId) : null;
        setState(draft ?? { projectId: null, activityId: null, ticketId: null });
      }
      setError(null);
      setSubmitting(false);
      setActiveTimerWarning(null);
    }
  }, [open, initialValues, viewerId]);

  // Persistir el draft a cada cambio del form.
  useEffect(() => {
    if (!open || !viewerId) return;
    writeDraft(DRAFT_KEY, viewerId, state);
  }, [open, viewerId, state]);

  // Tick para que el "corriendo desde X" avance mientras el bloque está arriba.
  useEffect(() => {
    if (!activeTimerWarning) return;
    const interval = window.setInterval(() => setTick((n) => n + 1), 1_000);
    return () => window.clearInterval(interval);
  }, [activeTimerWarning]);

  const warningElapsedLabel = useMemo(() => {
    if (!activeTimerWarning) return "";
    void tick;
    const seconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(activeTimerWarning.startedAt).getTime()) / 1_000),
    );
    return humanizeElapsed(seconds);
  }, [activeTimerWarning, tick]);

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

  async function doStart(payload: ReturnType<typeof buildStartPayload>): Promise<boolean> {
    if (!payload) return false;
    const res = await fetch("/api/time-entries/timer/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
        timer?: ActiveTimer;
      };
      // 030: timer activo preexistente — mostramos las dos acciones al
      // usuario, no cerramos el dialog.
      if (res.status === 409 && body.reason === "timer_active" && body.timer) {
        setActiveTimerWarning(body.timer);
        return false;
      }
      if (res.status === 403) {
        setError(body.error ?? "No tenés permiso para iniciar un cronómetro en este proyecto.");
      } else if (body.reason === "activity_required") {
        setError("Este proyecto exige elegir una tarea antes de arrancar.");
      } else {
        setError(body.error ?? "No se pudo iniciar el cronómetro.");
      }
      return false;
    }
    return true;
  }

  async function submit() {
    const payload = buildStartPayload(state);
    if (!payload) return;

    setError(null);
    setSubmitting(true);
    try {
      const started = await doStart(payload);
      if (!started) return;
      if (viewerId) clearDraft(DRAFT_KEY, viewerId);
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  // 030: "Guardar y arrancar" → para el timer viejo (crea un entry capeado a
  // 960 min por el stop_timer RPC) → re-POST start con los campos actuales.
  // "Descartar y arrancar" → delete del timer viejo → re-POST start.
  async function resolveActiveTimerAndStart(mode: "stop" | "discard") {
    const payload = buildStartPayload(state);
    if (!payload) return;
    setError(null);
    setSubmitting(true);
    try {
      const endpoint = mode === "stop" ? "/api/time-entries/timer/stop" : "/api/time-entries/timer/discard";
      const resolve = await fetch(endpoint, { method: "POST" });
      if (!resolve.ok) {
        const body = (await resolve.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "No se pudo resolver el cronómetro anterior.");
        return;
      }
      setActiveTimerWarning(null);
      const started = await doStart(payload);
      if (!started) return;
      if (viewerId) clearDraft(DRAFT_KEY, viewerId);
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

          {/* 030: aviso de timer activo preexistente. Dos acciones:
              guardarlo (crea un entry capeado a 960 min) o descartarlo. El
              usuario decide antes de arrancar el nuevo. */}
          {activeTimerWarning && (
            <div
              role="alert"
              className="border-attention bg-attention-bg flex flex-col gap-2 rounded-md border p-3"
            >
              <div className="text-ui text-foreground flex items-start gap-2">
                <AlertTriangleIcon
                  aria-hidden="true"
                  className="text-attention mt-0.5 size-4 shrink-0"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    Ya hay un cronómetro corriendo
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {activeTimerWarning.ticketKey
                      ? `${activeTimerWarning.ticketKey} · ${activeTimerWarning.activityName ?? activeTimerWarning.projectName}`
                      : `${activeTimerWarning.projectName} · ${activeTimerWarning.activityName ?? "Sin tarea"}`}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    corriendo hace {warningElapsedLabel}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => resolveActiveTimerAndStart("discard")}
                  disabled={submitting}
                  className="text-destructive"
                >
                  Descartar y arrancar
                </Button>
                <Button
                  size="sm"
                  onClick={() => resolveActiveTimerAndStart("stop")}
                  disabled={submitting}
                >
                  Guardar y arrancar
                </Button>
              </div>
            </div>
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
