"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Building2Icon,
  CalendarDaysIcon,
  FolderKanbanIcon,
  InboxIcon,
  LogOutIcon,
  MenuIcon,
  PanelLeftIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/lib/bookings/permissions";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "devscalendar:sidebar-collapsed";

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /**
   * Search params que el item representa, cuando apunta a una vista filtrada de
   * una ruta que ya tiene su propio item.
   *
   * Existe por el atajo de `005`: `Calendario` y `Pendientes del equipo` viven
   * los dos en `/calendar`, y la determinación de activo de `DESIGN.md` §7 es
   * por segmento de ruta. Sin esto, o se encienden los dos o el atajo no se
   * enciende nunca.
   */
  match?: Record<string, string>;
};
type NavGroup = { label: string | null; items: NavItem[] };

// El calendario es la pantalla principal del producto (spec funcional §4), así
// que encabeza la navegación y `/` redirige a él: la home de bienvenida de
// `002` era un placeholder hasta que esta pantalla existiera.
const BASE_NAV: NavGroup[] = [
  { label: null, items: [{ href: "/calendar", label: "Calendario", Icon: CalendarDaysIcon }] },
];

const ADMIN_NAV: NavGroup = {
  label: "Administración",
  items: [
    { href: "/admin/clients", label: "Clientes", Icon: Building2Icon },
    { href: "/admin/projects", label: "Proyectos", Icon: FolderKanbanIcon },
    { href: "/admin/users", label: "Usuarios", Icon: UsersIcon },
  ],
};

/**
 * `005` T4.1 — la bandeja es del desarrollador y de nadie más, así que su item
 * aparece solo con ese rol. El guard real vive en `(app)/inbox/layout.tsx`:
 * esconder el link no es una autorización, es no ofrecer un camino que después
 * rebota.
 *
 * El badge con la cantidad de pendientes es de `010`: saber cuántas hay sin
 * entrar ya es media notificación, y las notificaciones se difirieron enteras.
 */
const DEVELOPER_NAV_ITEM: NavItem = {
  href: "/inbox",
  label: "Pendientes",
  Icon: InboxIcon,
};

/**
 * El admin no tiene bandeja —no puede aprobar nada, y el trigger de la base lo
 * hace cumplir sin mirar el rol— pero sí necesita ver qué está esperando
 * respuesta. Eso ya existe: es el calendario filtrado por estado.
 *
 * Un atajo y no una pantalla nueva, a propósito: una lista global de solo
 * lectura duplicaría lo que el calendario hace mejor —agrupación, filtros
 * combinables, link compartible— y encima se llamaría "bandeja" sin tener
 * acciones. La pregunta de supervisión que este atajo **no** contesta es "hace
 * cuánto que está esperando", y esa es de `010` (F5, F6).
 */
const TEAM_PENDING_ITEM: NavItem = {
  href: "/calendar?status=pending",
  label: "Pendientes del equipo",
  Icon: InboxIcon,
  match: { status: "pending" },
};

/**
 * DESIGN.md §7: el item activo se determina por coincidencia de segmento, no por
 * igualdad exacta — `/admin/projects/42` mantiene activo `Proyectos`.
 * `/` es la excepción: solo coincide de forma exacta.
 */
function matchesPath(pathname: string, href: string) {
  const path = href.split("?")[0]!;
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

function matchesQuery(params: URLSearchParams, item: NavItem) {
  if (!item.match) return true;
  return Object.entries(item.match).every(([key, value]) => params.get(key) === value);
}

/**
 * **Un solo item activo, siempre.** Gana el más específico: primero el que
 * declara los search params que representa, y recién si ninguno matchea, el que
 * mira solo la ruta.
 *
 * Sin esta precedencia, en `/calendar?status=pending` se encenderían a la vez
 * `Calendario` y `Pendientes del equipo`, y dos items en `--primary` con su
 * barra a la izquierda no dicen dónde está parado el usuario: dicen que el nav
 * está roto.
 */
function findActive(pathname: string, params: URLSearchParams, nav: NavGroup[]): NavItem | null {
  const candidates = nav
    .flatMap((group) => group.items)
    .filter((item) => matchesPath(pathname, item.href));

  return (
    candidates.find((item) => item.match && matchesQuery(params, item)) ??
    candidates.find((item) => !item.match) ??
    null
  );
}

export function AppShell({
  children,
  role,
  userLabel,
}: {
  children: React.ReactNode;
  /** Pasa el rol entero y no un `isAdmin`: con `005` ya son dos los que abren
   *  navegación propia, y un booleano por rol se multiplica con cada feature. */
  role: UserRole;
  userLabel: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Cada rol suma su propio destino sobre el calendario: el dev su bandeja, el
  // admin el atajo a lo que está esperando respuesta.
  const extras: NavItem[] =
    role === "developer" ? [DEVELOPER_NAV_ITEM] : role === "admin" ? [TEAM_PENDING_ITEM] : [];

  const nav: NavGroup[] = [
    { label: null, items: [...BASE_NAV[0]!.items, ...extras] },
    ...(role === "admin" ? [ADMIN_NAV] : []),
  ];

  const activeItem = findActive(pathname, searchParams, nav);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
    setMounted(true);
  }, []);

  // §6: por debajo de 1024px la sidebar es un drawer; al navegar se cierra.
  useEffect(() => setMobileOpen(false), [pathname]);

  function toggleCollapsed() {
    setCollapsed((previous) => {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!previous));
      return !previous;
    });
  }

  const currentLabel = activeItem?.label ?? null;

  return (
    <div className="flex h-full">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Cerrar navegación"
          onClick={() => setMobileOpen(false)}
          className="bg-foreground/20 fixed inset-0 z-40 lg:hidden"
        />
      )}

      <aside
        className={cn(
          "border-border bg-sidebar z-50 flex shrink-0 flex-col border-r",
          mounted && "transition-[width]",
          collapsed ? "w-14" : "w-60",
          // Drawer por debajo de 1024px.
          "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-60",
          mobileOpen ? "max-lg:flex" : "max-lg:hidden",
        )}
      >
        <div
          className={cn(
            "border-border flex h-12 shrink-0 items-center border-b",
            collapsed ? "justify-center px-2" : "px-3",
          )}
        >
          <Link
            href="/"
            className="text-emphasis focus-visible:outline-ring truncate rounded-md font-medium outline-none focus-visible:outline-2"
          >
            {collapsed ? "DC" : "DevsCalendar"}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {nav.map((group) => (
            <div key={group.label ?? "root"} className="mb-4 last:mb-0">
              {group.label && !collapsed && (
                <p className="text-caption text-muted-foreground px-2 pb-1 font-medium">
                  {group.label}
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map(({ href, label, Icon }) => {
                  const active = activeItem?.href === href;
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? label : undefined}
                        className={cn(
                          "text-ui relative flex h-8 items-center gap-2 rounded-md px-2 outline-none",
                          "focus-visible:outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2",
                          collapsed && "justify-center px-0",
                          active
                            ? "bg-surface-active text-primary font-medium"
                            : "text-secondary-foreground hover:bg-surface-hover hover:text-foreground",
                        )}
                      >
                        {/* §7: barra de 2px sobre el borde izquierdo del item activo. */}
                        {active && (
                          <span
                            aria-hidden="true"
                            className="bg-primary absolute inset-y-1 left-0 w-0.5"
                          />
                        )}
                        <Icon aria-hidden="true" className="size-4 shrink-0" />
                        {!collapsed && <span className="truncate">{label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-border shrink-0 border-t p-2">
          <Button
            variant="ghost"
            size={collapsed ? "icon-sm" : "sm"}
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir navegación" : "Contraer navegación"}
            className={cn("max-lg:hidden", collapsed ? "mx-auto" : "w-full justify-start")}
          >
            <PanelLeftIcon aria-hidden="true" />
            {!collapsed && "Contraer"}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir navegación"
            className="lg:hidden"
          >
            <MenuIcon aria-hidden="true" />
          </Button>

          <nav aria-label="Ubicación" className="min-w-0 flex-1">
            <p className="text-ui text-muted-foreground truncate">
              {currentLabel ?? "DevsCalendar"}
            </p>
          </nav>

          <span className="text-caption text-muted-foreground hidden truncate sm:block">
            {userLabel}
          </span>
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="ghost" size="icon-sm" aria-label="Cerrar sesión">
              <LogOutIcon aria-hidden="true" />
            </Button>
          </form>
        </header>

        {/* §6: el scroll vive en el área de contenido, no en la página. */}
        <main className="min-h-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
