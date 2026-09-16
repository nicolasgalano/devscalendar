import Link from "next/link";
import {
  CalendarDaysIcon,
  FolderKanbanIcon,
  InboxIcon,
  ShieldIcon,
  type LucideIcon,
} from "lucide-react";

import { isAdmin, isDeveloper, type UserRole } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

/**
 * Home landing (feature 017). Dispatcher del producto: no es un dashboard,
 * es un selector — dos cards fijas (DevCalendar / Proyectos) más una tercera
 * y cuarta condicionales al rol.
 *
 * **Excepción a `DESIGN.md` §1/§6:** el contenido va contenido a `max-w-3xl`
 * centrado. Un dispatcher pegado al ancho de pantalla se lee como error de
 * layout. Sin hero, sin emojis, sin ancho completo — la excepción es acotada
 * y aplica solo acá, no propaga.
 *
 * La home no tiene ítem propio en el sidebar. El logo/nombre del top-left
 * (`app-shell.tsx`) es el único acceso — mismo patrón que muchas apps
 * internas donde el logo es "volver al inicio".
 */

type Card = {
  href: string;
  label: string;
  description: string;
  Icon: LucideIcon;
};

export function HomeDispatcher({ roles }: { roles: UserRole[] }) {
  const cards: Card[] = [
    {
      href: "/calendar",
      label: "DevCalendar",
      description: "Ver la agenda del equipo y reservar tiempo de desarrollo.",
      Icon: CalendarDaysIcon,
    },
    {
      href: "/projects",
      label: "Proyectos",
      description: "Ver los tickets de tus proyectos, en tablero o en backlog.",
      Icon: FolderKanbanIcon,
    },
    ...(isDeveloper(roles)
      ? [
          {
            href: "/inbox",
            label: "Bandeja",
            description: "Responder las reservas que te asignaron.",
            Icon: InboxIcon,
          },
        ]
      : []),
    ...(isAdmin(roles)
      ? [
          {
            href: "/admin/clients",
            label: "Administración",
            description: "Gestionar clientes, proyectos y usuarios.",
            Icon: ShieldIcon,
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-title mb-6 font-medium">Elegí a dónde ir</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.href}>
            <HomeCard {...card} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function HomeCard({ href, label, description, Icon }: Card) {
  return (
    <Link
      href={href}
      className={cn(
        "border-border hover:bg-surface-hover focus-visible:outline-ring group",
        "flex h-full flex-col gap-2 rounded-md border p-4 outline-none transition-colors",
        "focus-visible:outline-2 focus-visible:-outline-offset-2",
      )}
    >
      <Icon
        aria-hidden="true"
        className="text-muted-foreground group-hover:text-foreground size-6 shrink-0 transition-colors"
      />
      <p className="text-emphasis font-medium">{label}</p>
      <p className="text-ui text-muted-foreground">{description}</p>
    </Link>
  );
}
