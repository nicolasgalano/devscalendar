"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { useSyncIndicator } from "@/components/sync-indicator";
import { canChangeTicketStatus } from "@/lib/tickets/permissions";
import type { TicketListItem } from "@/lib/tickets/query";
import { TICKET_STATUS_ORDER } from "@/lib/tickets/status";
import type { UserRole } from "@/lib/auth/roles";
import type { Database } from "@/types/database";

import { KanbanCard } from "./kanban-card";
import { KanbanColumn } from "./kanban-column";

type TicketStatus = Database["public"]["Enums"]["ticket_status"];
type ProjectRole = Database["public"]["Enums"]["project_member_role"];

/**
 * Tablero kanban (feature 017 T3.4). Seis columnas fijas, drag & drop con
 * `@dnd-kit`.
 *
 * **Manejo de estado — por qué `useState` y no `useOptimistic`:**
 * La primera versión usaba `useOptimistic` + `useTransition`, pero
 * `useOptimistic` mantiene el estado optimista **solo mientras una transition
 * sigue pending** — y `startTransition` con un callback sincrónico termina al
 * instante, mucho antes de que el fetch responda. El resultado era un flash:
 * card en columna nueva → card vuelve al origen → 200ms después card en
 * columna nueva otra vez (via `router.refresh()`).
 *
 * Con `useState` local: la card se queda en la columna nueva desde el
 * momento del drop hasta que el server confirma (nunca vuelve visualmente en
 * caso feliz) o rechaza (rollback puntual solo de la card que falló, no del
 * tablero entero).
 *
 * **Sincronización con el server:**
 * Un `useEffect` sincroniza `localTickets` cuando cambia el prop `tickets`
 * — pasa cuando `router.refresh()` termina, o cuando el usuario navega a
 * otro proyecto. Es el mecanismo que trae los cambios de otros clientes o de
 * mudanzas hechas desde el detalle del ticket sin recargar la página.
 *
 * **Permisos:**
 * `canChangeTicketStatus(viewer, project, roleInProject)` decide si las cards
 * son arrastrables. Como el permiso es a nivel proyecto (no ticket individual),
 * se computa una vez. La verdad final la sigue teniendo el trigger de la base.
 */
export function KanbanBoard({
  tickets,
  viewer,
  project,
  roleInProject,
}: {
  tickets: TicketListItem[];
  viewer: { id: string; roles: UserRole[] } | null;
  project: { id: string; pm_id: string };
  roleInProject: ProjectRole | null;
}) {
  const router = useRouter();
  const { start: startSync } = useSyncIndicator();
  const [localTickets, setLocalTickets] = useState(tickets);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Sync desde prop → local: pasa cuando el server rerenderea (router.refresh,
  // navegación, revalidación). Sin esto, un cambio de otro cliente nunca
  // aparecería y el tablero quedaría "stuck" en el snapshot del primer render.
  useEffect(() => {
    setLocalTickets(tickets);
  }, [tickets]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const grouped = useMemo(() => {
    const buckets: Record<TicketStatus, TicketListItem[]> = {
      todo: [],
      in_progress: [],
      in_review: [],
      blocked: [],
      done: [],
      cancelled: [],
    };
    for (const ticket of localTickets) buckets[ticket.status].push(ticket);
    return buckets;
  }, [localTickets]);

  // El permiso no depende del ticket individual — se computa una vez para
  // todo el tablero. Si mañana la regla se hace por-ticket, la firma
  // `() => boolean` deja lugar sin cambiar la API de `<KanbanColumn>`.
  const canDragAll = canChangeTicketStatus(viewer, { pm_id: project.pm_id }, roleInProject);
  const canDrag = () => canDragAll;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    // El over puede ser una columna (droppable) o una tarjeta (sortable).
    // Si es tarjeta, uso su status; si es columna, el data.status que
    // registró `useDroppable`.
    const overData = over.data.current as { status?: TicketStatus } | undefined;
    let toStatus: TicketStatus | undefined = overData?.status;
    if (!toStatus) {
      const overTicket = localTickets.find((t) => t.id === over.id);
      toStatus = overTicket?.status;
    }
    if (!toStatus) return;

    const ticketId = active.id as string;
    const ticket = localTickets.find((t) => t.id === ticketId);
    if (!ticket || ticket.status === toStatus) return;

    // Capturo el estado original **de la card**, no del tablero entero: si
    // mientras esta card viaja al server el usuario arrastra otra, el rollback
    // no debe pisar la segunda. `originalStatus` se guarda por closure.
    const originalStatus = ticket.status;
    const nextStatus = toStatus;

    // 1. Optimistic update: la card se queda en la columna nueva desde ya.
    setLocalTickets((current) =>
      current.map((t) => (t.id === ticketId ? { ...t, status: nextStatus } : t)),
    );
    setError(null);

    // El indicador flotante (bottom-right) muestra que hay trabajo asíncrono.
    // Refcount adentro del provider — dos drags simultáneos suman dos entradas
    // y el indicador se apaga cuando ambos terminan.
    const stopSync = startSync("Guardando cambio");

    fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            reason?: string;
          };
          setError(body.reason ?? body.error ?? "No se pudo mover el ticket.");
          // 2a. Rollback puntual: solo esta card, no el tablero.
          setLocalTickets((current) =>
            current.map((t) => (t.id === ticketId ? { ...t, status: originalStatus } : t)),
          );
        } else {
          // 2b. Éxito: refrescamos para traer la data canónica del server
          //     (updated_at nuevo, cambios de otros clientes en la misma
          //     ventana, etc). El local ya está en el estado correcto — el
          //     useEffect de arriba sincroniza sin flash.
          router.refresh();
        }
      })
      .catch(() => {
        setError("No se pudo conectar con el servidor.");
        setLocalTickets((current) =>
          current.map((t) => (t.id === ticketId ? { ...t, status: originalStatus } : t)),
        );
      })
      .finally(() => stopSync());
  }

  const activeTicket = activeId ? localTickets.find((t) => t.id === activeId) : null;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-ui text-destructive">
          {error}
        </p>
      )}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {TICKET_STATUS_ORDER.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tickets={grouped[status]}
              canDrag={canDrag}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTicket ? (
            <KanbanCard ticket={activeTicket} draggable={false} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
