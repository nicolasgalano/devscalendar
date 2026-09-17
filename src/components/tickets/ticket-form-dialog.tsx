"use client";

import type { JSONContent } from "@tiptap/react";
import dynamic from "next/dynamic";
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
import { EditorSkeleton } from "@/lib/editor/rich-text-editor";
import type { SprintListItem } from "@/lib/sprints/query";
import { formatSprintDisplayName } from "@/lib/sprints/status";
import {
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_ORDER,
} from "@/lib/tickets/status";
import type { Database } from "@/types/database";

import { ConfirmDiscardDialog } from "./confirm-discard-dialog";

type TicketPriority = Database["public"]["Enums"]["ticket_priority"];
type TicketStatus = Database["public"]["Enums"]["ticket_status"];

// El bundle de Tiptap + ProseMirror + lowlight pesa ~90KB gzipped. El editor
// se carga tarde (`ssr: false`) para no sumarlo al bundle de las páginas que
// solo listan tickets — el detalle usa `<RichTextViewer>`, que es server y
// no importa Tiptap. Ver §4.1 del plan.
const RichTextEditor = dynamic(
  () => import("@/lib/editor/rich-text-editor").then((mod) => mod.RichTextEditor),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

const UNASSIGNED = "__unassigned__";
const BACKLOG = "__backlog__";

export type TicketFormInitial = {
  /** Solo presente en modo edit. */
  id?: string;
  projectId: string | null;
  title: string;
  // 019: la descripción viaja como doc de ProseMirror. `null` = sin
  // descripción (equivalente al `""` del schema markdown viejo).
  descriptionDoc: JSONContent | null;
  priority: TicketPriority;
  assigneeId: string | null;
  status?: TicketStatus;
  /** 018: sprint asignado (null = backlog). */
  sprintId?: string | null;
  /** 018: horas estimadas (null = sin estimar). */
  estimatedHours?: number | null;
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
  openSprints,
  openSprintsByProject,
  canEditFields = true,
  canReassign = true,
  canSprintPlan = false,
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
  /** 018: sprints no-cerrados del proyecto activo (edit). */
  openSprints?: SprintListItem[];
  /** 018: sprints por proyecto (create — el sprint depende del proyecto elegido). */
  openSprintsByProject?: Record<string, SprintListItem[]>;
  canEditFields?: boolean;
  canReassign?: boolean;
  /** 018: si el viewer puede tocar sprint_id / estimated_hours (admin/PM/lead). */
  canSprintPlan?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<TicketFormInitial>(initial);
  const [dirty, setDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  // Cuando el dialog se abre (o `initial` cambia), reflejar el estado del
  // padre. Sin esto, abrir "Editar" dos veces sobre tickets distintos muestra
  // el primero.
  useEffect(() => {
    if (open) {
      setForm(initial);
      setError(null);
      setDirty(false);
    }
  }, [open, initial]);

  const availableMembers: Person[] = useMemo(() => {
    if (mode === "edit") return members ?? [];
    if (!form.projectId) return [];
    return membersByProject?.[form.projectId] ?? [];
  }, [mode, members, membersByProject, form.projectId]);

  const availableSprints: SprintListItem[] = useMemo(() => {
    if (mode === "edit") return openSprints ?? [];
    if (!form.projectId) return [];
    return openSprintsByProject?.[form.projectId] ?? [];
  }, [mode, openSprints, openSprintsByProject, form.projectId]);

  // Si al cambiar de proyecto el asignado deja de ser miembro, se limpia
  // — evita que el POST rebote con "El asignado no es miembro del proyecto".
  useEffect(() => {
    if (mode !== "create") return;
    if (!form.assigneeId) return;
    if (!availableMembers.some((member) => member.id === form.assigneeId)) {
      setForm((current) => ({ ...current, assigneeId: null }));
    }
  }, [mode, form.assigneeId, availableMembers]);

  // Misma limpieza para sprint: si al cambiar de proyecto el sprint no existe,
  // se manda a backlog.
  useEffect(() => {
    if (mode !== "create") return;
    if (!form.sprintId) return;
    if (!availableSprints.some((sprint) => sprint.id === form.sprintId)) {
      setForm((current) => ({ ...current, sprintId: null }));
    }
  }, [mode, form.sprintId, availableSprints]);

  const canSubmit = form.title.trim().length > 0 && form.projectId && !submitting;

  async function submit() {
    if (!form.projectId) return;
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        // 019: un doc "vacío" (solo un párrafo sin contenido) se manda como
        // null. El plainText del editor cae a 0, así que la señal "sin
        // descripción" no depende de mirar la estructura del doc — pero acá
        // en el submit no tenemos plainText a mano, así que revisamos el doc.
        description_doc: isEmptyDoc(form.descriptionDoc) ? null : form.descriptionDoc,
        priority: form.priority,
        assignee_id: form.assigneeId,
      };
      // 018: mandamos sprint_id / estimated_hours solo si el viewer tiene
      // permiso — el trigger igual rechaza, pero mandar lo prohibido garantiza
      // un 403 innecesario.
      if (canSprintPlan) {
        body.sprint_id = form.sprintId ?? null;
        body.estimated_hours = form.estimatedHours ?? null;
      }
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

          {canSprintPlan && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Sprint</Label>
                <Select
                  value={form.sprintId ?? BACKLOG}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      sprintId: value === BACKLOG ? null : (value as string),
                    })
                  }
                  disabled={mode === "create" && !form.projectId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {form.sprintId
                        ? (() => {
                            const sprint = availableSprints.find(
                              (s) => s.id === form.sprintId,
                            );
                            return sprint ? formatSprintDisplayName(sprint) : "—";
                          })()
                        : "Backlog"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BACKLOG}>Backlog</SelectItem>
                    {availableSprints.map((sprint) => (
                      <SelectItem key={sprint.id} value={sprint.id}>
                        {formatSprintDisplayName(sprint)}
                        {sprint.status === "active" && (
                          <span className="text-caption text-muted-foreground ml-1">
                            (activo)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ticket-hours">Horas estimadas</Label>
                <Input
                  id="ticket-hours"
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.estimatedHours === null || form.estimatedHours === undefined ? "" : String(form.estimatedHours)}
                  placeholder="—"
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    const next = raw === "" ? null : Number(raw);
                    setForm({
                      ...form,
                      estimatedHours:
                        next === null || (Number.isFinite(next) && next >= 0)
                          ? next
                          : form.estimatedHours ?? null,
                    });
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Descripción</Label>
            <RichTextEditor
              value={form.descriptionDoc}
              onChange={(doc) => setForm((current) => ({ ...current, descriptionDoc: doc }))}
              onDirtyChange={setDirty}
              placeholder="Describí el ticket. Podés usar formato."
              disabled={!canEditFields}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {mode === "create" ? "Crear ticket" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDiscardDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={() => {
          setDiscardOpen(false);
          onOpenChange(false);
        }}
      />
    </Dialog>
  );

  function handleCancel() {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  }
}

function isEmptyDoc(doc: JSONContent | null): boolean {
  if (!doc) return true;
  if (doc.type !== "doc") return false;
  const content = doc.content ?? [];
  if (content.length === 0) return true;
  if (content.length !== 1) return false;
  const only = content[0]!;
  if (only.type !== "paragraph") return false;
  const inner = only.content ?? [];
  return inner.length === 0;
}
