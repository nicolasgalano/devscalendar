"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { RecordStatus } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  canToggleActive,
  filterProjects,
  sortProjects,
} from "@/lib/projects/filter-sort";
import {
  nextSortDir,
  parseProjectsUrl,
  projectsHref,
  type ProjectsSort,
} from "@/lib/projects/url";
import type { ProjectListRow } from "@/lib/projects/workspace";
import { cn } from "@/lib/utils";

/**
 * Listado de proyectos (feature 017, refactoreado por 028). La densidad y el
 * tratamiento visual de inactivos se mantienen; lo que cambia:
 *
 *   - Toolbar con buscador (nombre + cliente) y toggle "Solo activos".
 *   - Headers clickeables con sort locale-aware (es-AR).
 *   - Columna de acciones: "Ver" para todos, "Activar/Desactivar" para admin
 *     y PM primario (reusando la RPC `set_project_active` via endpoint).
 *   - Fila ya no es `cursor-pointer` ni envuelve link — el acceso es por el
 *     botón "Ver" (decisión del usuario en 028/spec §4 US-4).
 *   - La columna "Tickets abiertos" se eliminó (028/spec AC-6).
 *
 * El estado vive en search params (`q`, `active`, `sort`, `dir`): la vista es
 * compartible por link, el back del browser funciona solo, y una query
 * malformada cae a defaults (`parseProjectsUrl` nunca tira).
 *
 * **El input del buscador tiene estado local** para que el feedback sea
 * inmediato (sin esperar al round-trip del `router.replace`). El filtro
 * aplicado también lee del estado local — la URL se actualiza con debounce de
 * 200 ms **para persistencia nada más** (reload / compartir link). Es el
 * mismo truco que resuelve "escribir rápido no debería hacer re-render del
 * server component en cada tecla".
 */
export function ProjectList({
  projects,
  currentUserId,
  isAdmin,
}: {
  projects: ProjectListRow[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlState = useMemo(() => parseProjectsUrl(new URLSearchParams(searchParams.toString())), [
    searchParams,
  ]);

  // Buscador: estado local sincronizado con la URL al montar y cuando la URL
  // cambia por un camino que no sea el input (ej. click en "Limpiar búsqueda").
  const [query, setQuery] = useState(urlState.q);
  useEffect(() => {
    setQuery(urlState.q);
  }, [urlState.q]);

  // Debounce de 200 ms para escribir el `q` en la URL. Usa `router.replace`
  // (no `push`) para no inflar el historial con cada tecla.
  useEffect(() => {
    if (query === urlState.q) return;
    const handle = setTimeout(() => {
      router.replace(projectsHref(urlState, { q: query }), { scroll: false });
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, urlState.q, urlState.active, urlState.sort, urlState.dir]);

  // Toggle en vuelo. Un solo botón por fila; usar id como marca basta.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterProjects(projects, { q: query, onlyActive: urlState.active === "on" }),
    [projects, query, urlState.active],
  );
  const sorted = useMemo(
    () => sortProjects(filtered, urlState.sort, urlState.dir),
    [filtered, urlState.sort, urlState.dir],
  );

  async function handleToggle(project: ProjectListRow) {
    setError(null);
    setTogglingId(project.id);
    try {
      const res = await fetch(`/api/projects/${project.id}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !project.active }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "No se pudo cambiar el estado del proyecto.");
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar con el servidor. Probá de nuevo.");
    } finally {
      setTogglingId(null);
    }
  }

  function clickSort(sort: ProjectsSort) {
    router.replace(
      projectsHref(urlState, { sort, dir: nextSortDir(urlState, sort) }),
      { scroll: false },
    );
  }

  function toggleActiveFilter() {
    const next = urlState.active === "on" ? "all" : "on";
    router.replace(projectsHref(urlState, { active: next }), { scroll: false });
  }

  const onlyActive = urlState.active === "on";

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar proyecto o cliente…"
          aria-label="Buscar proyecto o cliente"
          className="h-8 w-64"
        />
        <Button
          variant="outline"
          size="sm"
          aria-pressed={onlyActive}
          onClick={toggleActiveFilter}
        >
          <Checkbox checked={onlyActive} tabIndex={-1} aria-hidden="true" />
          Solo activos
        </Button>
      </div>

      {error && (
        <p role="alert" className="mb-3 text-ui text-destructive">
          {error}
        </p>
      )}

      {sorted.length === 0 ? (
        <EmptyStateFor
          hasQuery={query.length > 0}
          onlyActive={onlyActive}
          onClearQuery={() => setQuery("")}
          onShowInactive={toggleActiveFilter}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                sort="key"
                label="Clave"
                urlState={urlState}
                onClick={clickSort}
                className="w-24"
              />
              <SortableHeader
                sort="name"
                label="Proyecto"
                urlState={urlState}
                onClick={clickSort}
              />
              <SortableHeader
                sort="client"
                label="Cliente"
                urlState={urlState}
                onClick={clickSort}
              />
              <SortableHeader
                sort="pm"
                label="PM"
                urlState={urlState}
                onClick={clickSort}
              />
              <SortableHeader
                sort="status"
                label="Estado"
                urlState={urlState}
                onClick={clickSort}
                className="w-28"
              />
              <TableHead className="w-40 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                canToggle={canToggleActive(isAdmin, project.pm?.id, currentUserId)}
                toggling={togglingId === project.id}
                onToggle={() => handleToggle(project)}
                onView={() => router.push(`/projects/${project.key}/board`)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

function SortableHeader({
  sort,
  label,
  urlState,
  onClick,
  className,
}: {
  sort: ProjectsSort;
  label: string;
  urlState: ReturnType<typeof parseProjectsUrl>;
  onClick: (sort: ProjectsSort) => void;
  className?: string;
}) {
  const isActive = urlState.sort === sort;
  const Icon = !isActive
    ? ArrowUpDownIcon
    : urlState.dir === "asc"
      ? ArrowUpIcon
      : ArrowDownIcon;
  return (
    <TableHead
      className={className}
      aria-sort={isActive ? (urlState.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onClick(sort)}
        className="flex items-center gap-1.5 text-left focus-visible:outline-ring rounded-sm outline-none focus-visible:outline-2"
      >
        {label}
        <Icon
          aria-hidden="true"
          className={cn("size-3.5", !isActive && "text-muted-foreground/50")}
        />
      </button>
    </TableHead>
  );
}

function ProjectRow({
  project,
  canToggle,
  toggling,
  onToggle,
  onView,
}: {
  project: ProjectListRow;
  canToggle: boolean;
  toggling: boolean;
  onToggle: () => void;
  onView: () => void;
}) {
  return (
    <TableRow className={cn(!project.active && "text-muted-foreground")}>
      <TableCell className="font-data text-primary">{project.key}</TableCell>
      <TableCell className={cn(project.active ? "text-foreground" : undefined)}>
        {project.name}
      </TableCell>
      <TableCell>{project.client?.name ?? "—"}</TableCell>
      <TableCell>{project.pm?.name ?? "—"}</TableCell>
      <TableCell>
        <RecordStatus active={project.active} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={onView}>
            Ver
          </Button>
          {canToggle && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(project.active && "text-destructive")}
              onClick={onToggle}
              disabled={toggling}
            >
              {project.active ? "Desactivar" : "Activar"}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function EmptyStateFor({
  hasQuery,
  onlyActive,
  onClearQuery,
  onShowInactive,
}: {
  hasQuery: boolean;
  onlyActive: boolean;
  onClearQuery: () => void;
  onShowInactive: () => void;
}) {
  if (hasQuery) {
    return (
      <EmptyState
        title="Sin resultados"
        description="No encontramos proyectos con esa búsqueda."
        action={
          <Button variant="outline" size="sm" onClick={onClearQuery}>
            Limpiar búsqueda
          </Button>
        }
      />
    );
  }
  if (onlyActive) {
    return (
      <EmptyState
        title="No tenés proyectos activos"
        description="Prendé el toggle para incluir los inactivos."
        action={
          <Button variant="outline" size="sm" onClick={onShowInactive}>
            Ver inactivos
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      title="Sin proyectos"
      description="Todavía no participás en ningún proyecto."
    />
  );
}
