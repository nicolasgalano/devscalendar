"use client";

import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";

/**
 * Dialog reusado para crear y editar sprints (018 T4.5). Mismo shape que el
 * `<TicketFormDialog>` de 015: `mode: "create" | "edit"` cambia el endpoint
 * y el título, el resto es igual.
 *
 * Campos: fecha inicio (req), fecha fin (req), nombre (opcional), objetivo
 * (opcional). El validador cliente asegura `ends_at >= starts_at` sin round
 * trip — el server también lo valida via Zod y check constraint.
 */
export type SprintFormInitial = {
  id?: string;
  startsAt: string;
  endsAt: string;
  name: string;
  goal: string;
};

const EMPTY: SprintFormInitial = {
  startsAt: "",
  endsAt: "",
  name: "",
  goal: "",
};

export function SprintFormDialog({
  mode,
  open,
  onOpenChange,
  projectId,
  initial,
  onCreated,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  initial?: SprintFormInitial;
  /**
   * Callback opcional que se dispara con el sprint recién creado, además del
   * `router.refresh()`. `<CloseSprintDialog>` lo usa para retomar el flujo
   * de cierre después de que el PM crea el próximo sprint inline.
   */
  onCreated?: (createdSprintId: string) => void;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [form, setForm] = useState<SprintFormInitial>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial ?? EMPTY);
      setError(null);
    }
  }, [open, initial]);

  const canSubmit =
    form.startsAt.length > 0 && form.endsAt.length > 0 && form.endsAt >= form.startsAt;

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    const stop = startSync(mode === "create" ? "Creando sprint" : "Guardando sprint");
    try {
      const url = mode === "create" ? "/api/sprints" : `/api/sprints/${initial?.id}`;
      const body: Record<string, unknown> = {
        starts_at: form.startsAt,
        ends_at: form.endsAt,
        name: form.name.trim() || null,
        goal: form.goal.trim() || null,
      };
      if (mode === "create") body.project_id = projectId;

      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
        reason?: string;
      };
      if (!res.ok) {
        setError(payload.reason ?? payload.error ?? "No se pudo guardar el sprint.");
        return;
      }
      onOpenChange(false);
      if (mode === "create" && payload.id && onCreated) {
        onCreated(payload.id);
      }
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Nuevo sprint" : "Editar sprint"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-ui text-destructive">
              {error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sprint-starts">Fecha de inicio</Label>
              <Input
                id="sprint-starts"
                type="date"
                value={form.startsAt}
                onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sprint-ends">Fecha de fin</Label>
              <Input
                id="sprint-ends"
                type="date"
                value={form.endsAt}
                min={form.startsAt || undefined}
                onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sprint-name">Nombre (opcional)</Label>
            <Input
              id="sprint-name"
              value={form.name}
              maxLength={120}
              placeholder="Ej: Onboarding v2"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sprint-goal">Objetivo del sprint (opcional)</Label>
            <Textarea
              id="sprint-goal"
              value={form.goal}
              maxLength={2000}
              rows={3}
              placeholder="Ej: cerrar la onboarding para el mvp de la app"
              onChange={(event) => setForm({ ...form, goal: event.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {mode === "create" ? "Crear sprint" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
