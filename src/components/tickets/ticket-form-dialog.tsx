"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
import { MarkdownEditor } from "@/lib/markdown/editor";
import {
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_ORDER,
} from "@/lib/tickets/status";
import type { Database } from "@/types/database";

type TicketPriority = Database["public"]["Enums"]["ticket_priority"];
type TicketStatus = Database["public"]["Enums"]["ticket_status"];

const UNASSIGNED = "__unassigned__";

export type TicketFormInitial = {
  /** Solo presente en modo edit. */
  id?: string;
  projectId: string | null;
  title: string;
  description: string;
  priority: TicketPriority;
  assigneeId: string | null;
  status?: TicketStatus;
};

type Project = { id: string; key: string; name: string };
type Person = { id: string; name: string };

/**
 * Dialog reusado para crear y editar tickets. En modo `create` el proyecto se
 * elige (viene desde el CTA "+ Nuevo ticket" o desde `?projectId=`); en modo
 * `edit` el proyecto está fijo — cambiar de proyecto no es una operación
 * soportada (el `key` del ticket queda para siempre atado al proyecto que lo
 * numeró, `enforce_project_key_immutable`).
 *
 * `canEditFields` / `canReassign` se reciben del padre (calculadas con
 * `canEditTicketFields` y `canReassignTicket`) para deshabilitar campos que el
 * server rechazaría. La verdad la tiene el trigger; esto es UX.
 */
export function TicketFormDialog({
  mode,
  open,
  onOpenChange,
  initial,
  projects,
  members,
  membersByProject,
  canEditFields = true,
  canReassign = true,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: TicketFormInitial;
  /** Proyectos disponibles para elegir en modo `create`. En `edit` alcanza uno. */
  projects: Project[];
  /** Miembros del proyecto activo, para el select de asignado en modo `edit`. */
  members?: Person[];
  /** Miembros por proyecto — usado en `create` cuando el usuario cambia el proyecto. */
  membersByProject?: Record<string, Person[]>;
  canEditFields?: boolean;
  canReassign?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<TicketFormInitial>(initial);

  // Cuando el dialog se abre (o `initial` cambia), reflejar el estado del
  // padre. Sin esto, abrir "Editar" dos veces sobre tickets distintos muestra
  // el primero.
  useEffect(() => {
    if (open) {
      setForm(initial);
      setError(null);
    }
  }, [open, initial]);

  const availableMembers: Person[] = useMemo(() => {
    if (mode === "edit") return members ?? [];
    if (!form.projectId) return [];
    return membersByProject?.[form.projectId] ?? [];
  }, [mode, members, membersByProject, form.projectId]);

  // Si al cambiar de proyecto el asignado deja de ser miembro, se limpia
  // — evita que el POST rebote con "El asignado no es miembro del proyecto".
  useEffect(() => {
    if (mode !== "create") return;
    if (!form.assigneeId) return;
    if (!availableMembers.some((member) => member.id === form.assigneeId)) {
      setForm((current) => ({ ...current, assigneeId: null }));
    }
  }, [mode, form.assigneeId, availableMembers]);

  const canSubmit = form.title.trim().length > 0 && form.projectId && !submitting;

  async function submit() {
    if (!form.projectId) return;
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        assignee_id: form.assigneeId,
      };
      const url = mode === "create" ? "/api/tickets" : `/api/tickets/${initial.id}`;
      if (mode === "create") body.project_id = form.projectId;

      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
        key?: string;
      };
      if (!res.ok) {
        setError(payload.reason ?? payload.error ?? "No se pudo guardar el ticket.");
        return;
      }
      onOpenChange(false);
      if (mode === "create" && payload.key) {
        router.push(`/tickets/${payload.key}`);
      } else {
        router.refresh();
      }
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Nuevo ticket" : "Editar ticket"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-ui text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-title">Título</Label>
            <Input
              id="ticket-title"
              value={form.title}
              maxLength={200}
              disabled={!canEditFields}
              placeholder="Importar CSV de clientes"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Proyecto</Label>
              <Select
                value={form.projectId ?? ""}
                onValueChange={(value) => setForm({ ...form, projectId: value as string })}
                disabled={mode === "edit" || projects.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Elegí un proyecto">
                    {projects.find((project) => project.id === form.projectId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      <span className="font-data text-muted-foreground">{project.key}</span>{" "}
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Prioridad</Label>
              <Select
                value={form.priority}
                onValueChange={(value) =>
                  setForm({ ...form, priority: value as TicketPriority })
                }
                disabled={!canEditFields}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{TICKET_PRIORITY_LABELS[form.priority]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TICKET_PRIORITY_ORDER.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {TICKET_PRIORITY_LABELS[priority]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Asignado</Label>
            <Select
              value={form.assigneeId ?? UNASSIGNED}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  assigneeId: value === UNASSIGNED ? null : (value as string),
                })
              }
              disabled={!canReassign || (mode === "create" && !form.projectId)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {form.assigneeId
                    ? availableMembers.find((person) => person.id === form.assigneeId)?.name ??
                      "—"
                    : "Sin asignar"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Sin asignar</SelectItem>
                {availableMembers.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mode === "create" && form.projectId && availableMembers.length === 0 && (
              <p className="text-caption text-muted-foreground">
                Este proyecto todavía no tiene miembros activos.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Descripción</Label>
            <MarkdownEditor
              value={form.description}
              onChange={(value) => setForm({ ...form, description: value })}
              placeholder="Describí el ticket. Podés usar markdown."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {mode === "create" ? "Crear ticket" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
