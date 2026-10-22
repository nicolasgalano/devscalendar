"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Feature 029: popover de carga/edición/borrado de una estimación.
 *
 * El upsert y el delete se expresan como dos endpoints distintos — la UI
 * elige según el estado:
 *   - Si `existing` es null: Guardar → POST /api/capacity-estimates.
 *   - Si `existing` existe: Guardar → POST (upsert, misma ruta). Borrar →
 *     DELETE /api/capacity-estimates/[id].
 *
 * No es una entidad propia porque la carga es un flujo chico y lo que
 * importa es la cercanía con la celda que la dispara — ergo todo in-line.
 */

type Props = {
  projectId: string;
  devId: string;
  date: string;
  existing: { id: string; hours: number } | null;
  onDone: () => void;
};

export function CapacityPopoverForm({
  projectId,
  devId,
  date,
  existing,
  onDone,
}: Props) {
  const router = useRouter();
  const [input, setInput] = useState<string>(existing ? String(existing.hours) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const hours = Number(input.replace(",", "."));
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      setError("Las horas tienen que estar entre 0.25 y 24.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/capacity-estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, devId, date, hours }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "No se pudo guardar la estimación.");
        return;
      }
      router.refresh();
      onDone();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/capacity-estimates/${existing.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "No se pudo borrar la estimación.");
        return;
      }
      router.refresh();
      onDone();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      className="flex min-w-48 flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="capacity-hours">Horas estimadas</Label>
        <Input
          id="capacity-hours"
          type="number"
          step="0.25"
          min="0.25"
          max="24"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          disabled={submitting}
        />
        <p className="text-caption text-muted-foreground">
          {date} · min 0.25, max 24
        </p>
      </div>

      {error && (
        <p role="alert" className="text-ui text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {existing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => void handleDelete()}
            disabled={submitting}
          >
            Borrar
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={submitting}>
          Guardar
        </Button>
      </div>
    </form>
  );
}
