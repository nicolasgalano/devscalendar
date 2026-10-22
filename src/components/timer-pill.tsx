"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  PlayIcon,
  StopCircleIcon,
} from "lucide-react";

import { useSyncIndicator } from "@/components/sync-indicator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatSecondsClock } from "@/lib/time-entries/format";
import type { ActiveTimer } from "@/lib/time-entries/query";
import { cn } from "@/lib/utils";

/**
 * Pill flotante del cronómetro (016 T4.6). Renderizado en el header del
 * `AppShell`, visible SIEMPRE que hay un timer corriendo, desde cualquier
 * ruta. El estado inicial viene del server (getMyActiveTimer); un
 * `setInterval` de 1 s actualiza el display para que el usuario vea el
 * contador avanzar (se cambió desde el minuto que era antes — reportado
 * por el equipo como "no se ve correr").
 *
 * El valor interno es segundos y se formatea como `H:MM:SS` (patrón Toggl).
 * Las `time_entries` que graba el stop siguen siendo múltiplos de 15 min —
 * esto es solo UX del contador en vivo.
 *
 * Cuando `activeTimer` es null pero podría existir (page transitioned pero
 * seguimos en el mismo request), el pill no aparece. `router.refresh()`
 * después de start/stop trae el nuevo estado.
 *
 * **Warning si > 12h corriendo** (AC-3.4): badge visual `--attention`.
 * No se auto-detiene — el dato nunca se pierde.
 */
const WARN_HOURS = 12;

export function TimerPill({ activeTimer }: { activeTimer: ActiveTimer | null }) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!activeTimer) return;
    // Tick cada segundo para que el `H:MM:SS` del display avance a la vista.
    const interval = window.setInterval(() => setTick((n) => n + 1), 1_000);
    return () => window.clearInterval(interval);
  }, [activeTimer]);

  const elapsedSeconds = useMemo(() => {
    if (!activeTimer) return 0;
    // `tick` en el dep para forzar recompute cada segundo.
    void tick;
    const now = Date.now();
    const started = new Date(activeTimer.startedAt).getTime();
    return Math.max(0, Math.floor((now - started) / 1_000));
  }, [activeTimer, tick]);

  const isWarning = elapsedSeconds >= WARN_HOURS * 3600;

  async function stopTimer() {
    if (!activeTimer) return;
    setError(null);
    const stop = startSync("Parando cronómetro");
    try {
      const res = await fetch("/api/time-entries/timer/stop", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        // 404 `no_timer`: el server no tiene nada corriendo pero la pill
        // sí lo mostraba — nuestra copia local está stale (otro tab lo
        // paró, se limpió la fila, etc). No es un error del usuario:
        // resincronizamos silenciosamente y la pill desaparece sola al
        // volver `activeTimer` como null desde el server.
        if (body.reason === "no_timer") {
          router.refresh();
          return;
        }
        setError(body.error ?? "No se pudo parar el cronómetro.");
        return;
      }
      const payload = (await res.json()) as { entry_id: string };
      // Redirect al edit del entry para que el user complete la descripción.
      router.push(`/my-time?edit=${payload.entry_id}`);
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      stop();
    }
  }

  if (!activeTimer) return null;

  const label = activeTimer.ticketKey
    ? `${activeTimer.ticketKey} · ${activeTimer.activityName ?? activeTimer.projectName}`
    : `${activeTimer.projectName} · ${activeTimer.activityName ?? "Sin tarea"}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "gap-2",
                isWarning
                  ? "border-attention text-attention hover:bg-attention-bg"
                  : "border-border",
              )}
              aria-label={`Cronómetro corriendo: ${label}`}
            />
          }
        >
          {isWarning ? (
            <CircleAlertIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <PlayIcon aria-hidden="true" className="size-3.5" />
          )}
          <span className="max-w-40 truncate">{label}</span>
          <span className="font-data tabular-nums">{formatSecondsClock(elapsedSeconds)}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={stopTimer}>
            <StopCircleIcon aria-hidden="true" className="size-3.5" />
            Parar y guardar
          </DropdownMenuItem>
          {activeTimer.ticketKey && (
            <DropdownMenuItem
              render={<Link href={`/tickets/${activeTimer.ticketKey}`} />}
            >
              Ver ticket
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <span role="alert" className="text-caption text-destructive ml-2">
          {error}
        </span>
      )}
    </>
  );
}
