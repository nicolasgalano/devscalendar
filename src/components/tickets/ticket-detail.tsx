"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PencilIcon } from "lucide-react";

import { TicketPriorityBadge } from "@/components/tickets/ticket-priority";
import { TicketStatusBadge } from "@/components/tickets/ticket-status";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkdownViewer } from "@/lib/markdown/viewer";
import type { UserRole } from "@/lib/auth/roles";
import {
  canChangeTicketStatus,
  canEditTicket,
  canEditTicketFields,
  canReassignTicket,
} from "@/lib/tickets/permissions";
import type { TicketDetail as TicketDetailData } from "@/lib/tickets/query";
import { formatAbsoluteFull, formatRelativeShort } from "@/lib/tickets/relative-time";
import {
  TICKET_PRIORITY_LABELS,
  TICKET_PRIORITY_ORDER,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_ORDER,
} from "@/lib/tickets/status";
import type { Database } from "@/types/database";

import { TicketFormDialog, type TicketFormInitial } from "./ticket-form-dialog";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];
type TicketPriority = Database["public"]["Enums"]["ticket_priority"];
type ProjectRole = Database["public"]["Enums"]["project_member_role"];

const UNASSIGNED = "__unassigned__";

/**
 * Detalle de ticket. Layout de `plan.md` §8.3: encabezado con `KEY · título`,
 * meta con cliente/proyecto/creador, controles inline de estado/prioridad/
 * asignado, y la descripción en markdown al pie. El botón "Editar" abre un
 * dialog con el mismo form del alta (`TicketFormDialog`) precargado.
 *
 * **Controles inline y `useOptimistic`**: cambiar el estado tiene que sentirse
 * instantáneo — un `<Select>` que se queda mostrando el valor viejo hasta que
 * el server responde lee como que "no funcionó". El estado optimista aplica el
 * cambio al vuelo y `router.refresh()` sincroniza cuando el PATCH termina.
 *
 * Si el PATCH falla, el server rerenderea con la data vieja y el optimista se
 * descarta — sin toast, sin lógica de rollback manual. Es la contrapartida
 * simple del pattern: el usuario ve el cambio, y si el server dice que no,
 * vuelve solo.
 *
 * **Permisos**: los tres controles se deshabilitan por su cuenta según
 * `canReassignTicket`/`canChangeTicketStatus`/`canEditTicketFields`. Esto es
 * UX y solo UX — la verdad la tiene el trigger de la base
 * (`enforce_ticket_contributor_scope`).
 */
export function TicketDetail({
  ticket,
  viewer,
  roleInProject,
  members,
}: {
  ticket: TicketDetailData;
  viewer: { id: string; roles: UserRole[] } | null;
  roleInProject: ProjectRole | null;
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const [optimistic, setOptimistic] = useOptimistic(ticket);

  const project = { pm_id: ticket.project.pmId };
  const ticketForCheck = {
    created_by: ticket.createdById,
    assignee_id: ticket.assigneeId,
  };

  const mayReassign = canReassignTicket(viewer, project, roleInProject);
  const mayChangeStatus = canChangeTicketStatus(viewer, project, roleInProject);
  const mayEditFields = canEditTicketFields(viewer, ticketForCheck, project, roleInProject);
  const showEditButton = canEditTicket(viewer, ticketForCheck, project, roleInProject);

  async function patch(patchBody: Record<string, unknown>, next: Partial<TicketDetailData>) {
    setError(null);
    startTransition(() => {
      setOptimistic({ ...optimistic, ...next });
    });
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
        setError(body.reason ?? body.error ?? "No se pudo actualizar el ticket.");
      }
      // Refresh en ambos casos: éxito para traer datos frescos, error para
      // que el optimista se descarte y el usuario vea el valor real.
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor.");
      router.refresh();
    }
  }

  const editInitial: TicketFormInitial = {
    id: ticket.id,
    projectId: ticket.project.id,
    title: ticket.title,
    description: ticket.description ?? "",
    priority: ticket.priority,
    assigneeId: ticket.assigneeId,
    status: ticket.status,
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4 pb-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-data text-title text-muted-foreground">
              {ticket.key}
            </span>
            <h1 className="text-title font-medium">{optimistic.title}</h1>
          </div>
          <p className="text-ui text-muted-foreground mt-1">
            {ticket.project.client ? (
              <>
                <span>{ticket.project.client.name}</span>
                <span aria-hidden="true"> · </span>
              </>
            ) : null}
            <span>Proyecto {ticket.project.name}</span>
          </p>
        </div>
        {showEditButton && (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <PencilIcon aria-hidden="true" />
            Editar
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-ui text-destructive mb-3">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 border-y border-border py-4 md:grid-cols-2">
        <MetaRow label="Estado">
          {mayChangeStatus ? (
            <Select
              value={optimistic.status}
              onValueChange={(next) =>
                patch({ status: next }, { status: next as TicketStatus })
              }
              disabled={pending}
            >
              <SelectTrigger size="sm" className="w-fit" aria-label="Estado del ticket">
                <SelectValue>
                  <TicketStatusBadge status={optimistic.status} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                {TICKET_STATUS_ORDER.map((status) => (
                  <SelectItem key={status} value={status}>
                    {TICKET_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <TicketStatusBadge status={optimistic.status} />
          )}
        </MetaRow>

        <MetaRow label="Prioridad">
          {mayEditFields ? (
            <Select
              value={optimistic.priority}
              onValueChange={(next) =>
                patch({ priority: next }, { priority: next as TicketPriority })
              }
              disabled={pending}
            >
              <SelectTrigger size="sm" className="w-fit" aria-label="Prioridad">
                <SelectValue>
                  <TicketPriorityBadge priority={optimistic.priority} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                {TICKET_PRIORITY_ORDER.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {TICKET_PRIORITY_LABELS[priority]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <TicketPriorityBadge priority={optimistic.priority} />
          )}
        </MetaRow>

        <MetaRow label="Asignado">
          {mayReassign ? (
            <Select
              value={optimistic.assigneeId ?? UNASSIGNED}
              onValueChange={(next) => {
                const value = next === UNASSIGNED ? null : (next as string);
                const person = members.find((m) => m.id === value);
                patch(
                  { assignee_id: value },
                  { assigneeId: value, assigneeName: person?.name ?? null },
                );
              }}
              disabled={pending}
            >
              <SelectTrigger size="sm" className="w-fit min-w-40" aria-label="Asignado">
                <SelectValue>
                  {optimistic.assigneeName ?? (
                    <span className="text-muted-foreground">Sin asignar</span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectItem value={UNASSIGNED}>Sin asignar</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-ui">
              {optimistic.assigneeName ?? (
                <span className="text-muted-foreground">Sin asignar</span>
              )}
            </span>
          )}
        </MetaRow>

        <MetaRow label="Creado por">
          <span className="text-ui">
            {ticket.createdBy}
            <span className="text-muted-foreground">
              {" · "}
              <time title={formatAbsoluteFull(ticket.createdAt)} className="font-data">
                {formatRelativeShort(ticket.createdAt)}
              </time>
            </span>
          </span>
        </MetaRow>
      </div>

      <section className="pt-4">
        <h2 className="text-section pb-2 font-medium">Descripción</h2>
        <MarkdownViewer content={optimistic.description} />
      </section>

      {!ticket.project.active && (
        <p className="mt-6 text-caption text-muted-foreground">
          El proyecto está desactivado — los tickets existentes se pueden seguir
          moviendo, pero no se pueden crear nuevos.
        </p>
      )}

      <p className="mt-6 text-caption text-muted-foreground">
        <Link href={`/projects/${ticket.project.key}/board`} className="hover:underline">
          ← Volver al proyecto
        </Link>
      </p>

      <TicketFormDialog
        mode="edit"
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={editInitial}
        projects={[
          {
            id: ticket.project.id,
            key: ticket.project.key,
            name: ticket.project.name,
          },
        ]}
        members={members}
        canEditFields={mayEditFields}
        canReassign={mayReassign}
      />
    </>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-caption text-muted-foreground w-24 shrink-0 font-medium">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
