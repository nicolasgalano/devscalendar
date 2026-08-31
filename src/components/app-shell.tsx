"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

type NavItem = { href: string; label: string; Icon: LucideIcon };
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
 * DESIGN.md §7: el item activo se determina por coincidencia de segmento, no por
 * igualdad exacta — `/admin/projects/42` mantiene activo `Proyectos`.
 * `/` es la excepción: solo coincide de forma exacta.
 */
function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function labelForPath(pathname: string, nav: NavGroup[]) {
  for (const group of nav) {
    for (const item of group.items) {
      if (isActive(pathname, item.href)) return item.label;
    }
  }
  return null;
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
  const nav: NavGroup[] = [
    {
      label: null,
      items:
        role === "developer" ? [...BASE_NAV[0]!.items, DEVELOPER_NAV_ITEM] : BASE_NAV[0]!.items,
    },
    ...(role === "admin" ? [ADMIN_NAV] : []),
  ];

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

  const currentLabel = labelForPath(pathname, nav);

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
                  const active = isActive(pathname, href);
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
