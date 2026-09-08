"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  notificationDetail,
  notificationHref,
  notificationTitle,
  describeSlot,
  type NotificationRow,
} from "@/lib/notifications/events";
import { cn } from "@/lib/utils";

/**
 * La campana del shell: qué me pasó.
 *
 * **No es `/inbox`, y conviene que no lo parezca.** La bandeja del dev es "qué
 * tengo que responder" y tiene acciones; esto es "qué pasó" y solo lleva. Que
 * fueran dos cosas parecidas con nombres parecidos sería la forma más rápida de
 * que el equipo deje de mirar las dos.
 *
 * **Sin Realtime** (AC-4.4): el server component que la envuelve se rerenderiza
 * al navegar, y acá se refresca al volver a la pestaña. Para un aviso que se lee
 * cada varias horas, la diferencia con una suscripción no se percibe — y evita
 * la única parte del producto sin cobertura en CI, porque el stack efímero
 * excluye Realtime a propósito.
 */
export function NotificationBell({ notifications }: { notifications: NotificationRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => n.readAt === null);

  // Al volver a la pestaña, traer lo que haya llegado mientras tanto.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  async function openNotification(notification: NotificationRow) {
    setOpen(false);
    // Navegar primero y marcar después: si el POST falla, el usuario igual llegó
    // a donde quería. Un aviso que no se marca es ruido; uno que no lleva a
    // ningún lado es un bug.
    router.push(notificationHref(notification.bookingId));

    if (notification.readAt === null) {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [notification.id] }),
      }).catch(() => undefined);
      router.refresh();
    }
  }

  async function markAllRead() {
    if (unread.length === 0) return;
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unread.map((n) => n.id) }),
    }).catch(() => undefined);
    router.refresh();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          unread.length > 0 ? `Notificaciones (${unread.length} sin leer)` : "Notificaciones"
        }
        className="text-muted-foreground hover:text-foreground focus-visible:outline-ring relative inline-flex size-8 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:outline-2"
      >
        <BellIcon className="size-4" aria-hidden="true" />
        {unread.length > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-border flex items-center justify-between border-b px-3 py-2">
          <span className="text-emphasis text-ui font-medium">Notificaciones</span>
          {unread.length > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              Marcar todas
            </Button>
          )}
        </div>

        {notifications.length === 0 ? (
          <p className="text-muted-foreground text-ui px-3 py-6 text-center">
            No tenés notificaciones.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={cn(
                    "hover:bg-muted focus-visible:outline-ring flex w-full flex-col gap-0.5 px-3 py-2 text-left outline-none focus-visible:outline-2",
                    notification.readAt === null && "bg-muted/40",
                  )}
                >
                  <span className="text-emphasis text-ui font-medium">
                    {notificationTitle(notification.type)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {describeSlot(notification.payload)}
                  </span>
                  {notificationDetail(notification.type, notification.payload) && (
                    <span className="text-muted-foreground text-xs">
                      {notificationDetail(notification.type, notification.payload)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
