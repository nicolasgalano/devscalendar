"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2Icon,
  FolderKanbanIcon,
  HouseIcon,
  LogOutIcon,
  MenuIcon,
  PanelLeftIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "devscalendar:sidebar-collapsed";

type NavItem = { href: string; label: string; Icon: LucideIcon };
type NavGroup = { label: string | null; items: NavItem[] };

const BASE_NAV: NavGroup[] = [
  { label: null, items: [{ href: "/", label: "Inicio", Icon: HouseIcon }] },
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
  isAdmin,
  userLabel,
}: {
  children: React.ReactNode;
  isAdmin: boolean;
  userLabel: string;
}) {
  const pathname = usePathname();
  const nav = isAdmin ? [...BASE_NAV, ADMIN_NAV] : BASE_NAV;

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
          className="fixed inset-0 z-40 bg-foreground/20 lg:hidden"
        />
      )}

      <aside
        className={cn(
          "z-50 flex shrink-0 flex-col border-r border-border bg-sidebar",
          mounted && "transition-[width]",
          collapsed ? "w-14" : "w-60",
          // Drawer por debajo de 1024px.
          "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-60",
          mobileOpen ? "max-lg:flex" : "max-lg:hidden",
        )}
      >
        <div
          className={cn(
            "flex h-12 shrink-0 items-center border-b border-border",
            collapsed ? "justify-center px-2" : "px-3",
          )}
        >
          <Link
            href="/"
            className="truncate rounded-md text-emphasis font-medium outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            {collapsed ? "DC" : "DevsCalendar"}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {nav.map((group) => (
            <div key={group.label ?? "root"} className="mb-4 last:mb-0">
              {group.label && !collapsed && (
                <p className="px-2 pb-1 text-caption font-medium text-muted-foreground">
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
                          "relative flex h-8 items-center gap-2 rounded-md px-2 text-ui outline-none",
                          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          collapsed && "justify-center px-0",
                          active
                            ? "bg-surface-active font-medium text-primary"
                            : "text-secondary-foreground hover:bg-surface-hover hover:text-foreground",
                        )}
                      >
                        {/* §7: barra de 2px sobre el borde izquierdo del item activo. */}
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-1 left-0 w-0.5 bg-primary"
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

        <div className="shrink-0 border-t border-border p-2">
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
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
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
            <p className="truncate text-ui text-muted-foreground">
              {currentLabel ?? "DevsCalendar"}
            </p>
          </nav>

          <span className="hidden truncate text-caption text-muted-foreground sm:block">
            {userLabel}
          </span>
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              aria-label="Cerrar sesión"
            >
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
