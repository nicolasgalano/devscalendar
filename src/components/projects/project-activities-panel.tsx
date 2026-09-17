"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useSyncIndicator } from "@/components/sync-indicator";
import { RecordStatus } from "@/components/status";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectActivity } from "@/lib/project-activities/query";
import { cn } from "@/lib/utils";

/**
 * Panel de actividades del proyecto (016 T5.3). Admin y PM del proyecto
 * pueden crear, renombrar y desactivar/reactivar. Los `time_entries` viejos
 * mantienen su referencia a la actividad — desactivarla no borra historia.
 */
export function ProjectActivitiesPanel({
  activities,
  projectId,
}: {
  activities: ProjectActivity[];
  projectId: string;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<ProjectActivity | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<ProjectActivity | null>(
    null,
  );
  const [addName, setAddName] = useState("");
  const [renameValue, setRenameValue] = useState("");

  async function callApi(
    url: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    label: string,
  ) {
    setError(null);
    const stop = startSync(label);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        setError(payload.error ?? payload.reason ?? "No se pudo completar la acción.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("No se pudo conectar con el servidor.");
      return false;
    } finally {
      stop();
    }
  }

  async function handleAdd() {
    const trimmed = addName.trim();
    if (!trimmed) return;
    const ok = await callApi(
      "/api/project-activities",
      "POST",
      { project_id: projectId, name: trimmed },
      "Agregando actividad",
    );
    if (ok) {
      setAddOpen(false);
      setAddName("");
    }
  }

  async function handleRename() {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renaming.name) {
      setRenaming(null);
      return;
    }
    const ok = await callApi(
      `/api/project-activities/${renaming.id}`,
      "PATCH",
      { name: trimmed },
      "Renombrando",
    );
    if (ok) setRenaming(null);
  }

  async function toggleActive(activity: ProjectActivity) {
    if (activity.active) {
      setConfirmDeactivate(activity);
    } else {
      await callApi(
        `/api/project-activities/${activity.id}`,
        "PATCH",
        { active: true },
        "Reactivando",
      );
    }
  }

  async function confirmDeactivateNow() {
    if (!confirmDeactivate) return;
    const ok = await callApi(
      `/api/project-activities/${confirmDeactivate.id}`,
      "PATCH",
      { active: false },
      "Desactivando",
    );
    if (ok) setConfirmDeactivate(null);
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-ui text-muted-foreground">
          {activities.length}{" "}
          {activities.length === 1 ? "actividad definida" : "actividades definidas"}.
          Las actividades categorizan el tipo de trabajo cargado.
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          Agregar actividad
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-ui text-destructive mb-3">
          {error}
        </p>
      )}

      {activities.length === 0 ? (
        <p className="text-ui text-muted-foreground italic">
          Todavía no hay actividades. Agregá al menos una (QA, Desarrollo, PM, etc.)
          para poder categorizar las horas cargadas en este proyecto.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-28">Estado</TableHead>
              <TableHead className="w-40 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.map((activity) => (
              <TableRow
                key={activity.id}
                className={cn(!activity.active && "text-muted-foreground")}
              >
                <TableCell className={cn(activity.active && "text-foreground")}>
                  {activity.name}
                </TableCell>
                <TableCell>
                  <RecordStatus active={activity.active} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRenameValue(activity.name);
                      setRenaming(activity);
                    }}
                    disabled={!activity.active}
                  >
                    Renombrar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActive(activity)}
                    className={cn(activity.active && "text-destructive")}
                  >
                    {activity.active ? "Desactivar" : "Reactivar"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva actividad</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="activity-name">Nombre</Label>
            <Input
              id="activity-name"
              value={addName}
              maxLength={60}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="QA, Desarrollo, Meeting…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && addName.trim()) handleAdd();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAdd} disabled={!addName.trim()}>
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renombrar actividad</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="activity-rename">Nombre</Label>
            <Input
              id="activity-rename"
              value={renameValue}
              maxLength={60}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim()) handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancelar
            </Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeactivate !== null}
        onOpenChange={(o) => !o && setConfirmDeactivate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desactivar {confirmDeactivate?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-ui text-muted-foreground">
            La actividad deja de aparecer al cargar horas nuevas. Las cargas viejas
            que la usan siguen visibles y no se modifican.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeactivate(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmDeactivateNow}>
              Desactivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
