"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DownloadIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReportFilters } from "@/lib/reports/filters";
import { buildReportHref } from "@/lib/reports/filters";

const ALL = "__all__";

/**
 * Barra de filtros compartida entre reportes (016 Phase 6). Cada control
 * navega vía `router.replace` con `buildReportHref`. El export CSV
 * (opcional, controlado por `showExport`) linkea al endpoint con los mismos
 * filtros aplicados.
 */
export function ReportFiltersBar({
  basePath,
  filters,
  clients,
  projects,
  people,
  showExport = false,
}: {
  basePath: string;
  filters: ReportFilters;
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string | null }[];
  people: { id: string; name: string }[];
  showExport?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(filters);

  function apply(patch: Partial<ReportFilters>) {
    const next = { ...optimistic, ...patch };
    startTransition(() => {
      setOptimistic(next);
      router.replace(buildReportHref(basePath, optimistic, patch));
    });
  }

  // Al cambiar de cliente, resetear el proyecto si no pertenece a ese cliente.
  const visibleProjects = optimistic.clientId
    ? projects.filter((p) => p.clientId === optimistic.clientId)
    : projects;

  const exportHref = `/api/time-entries/export.csv?${new URLSearchParams({
    from: optimistic.from,
    to: optimistic.to,
    ...(optimistic.clientId ? { clientId: optimistic.clientId } : {}),
    ...(optimistic.projectId ? { projectId: optimistic.projectId } : {}),
    ...(optimistic.userId ? { userId: optimistic.userId } : {}),
  }).toString()}`;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="report-from" className="text-caption">
          Desde
        </Label>
        <Input
          id="report-from"
          type="date"
          value={optimistic.from}
          onChange={(e) => apply({ from: e.target.value })}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="report-to" className="text-caption">
          Hasta
        </Label>
        <Input
          id="report-to"
          type="date"
          value={optimistic.to}
          min={optimistic.from}
          onChange={(e) => apply({ to: e.target.value })}
          className="w-40"
        />
      </div>

      <FilterSelect
        label="Cliente"
        value={optimistic.clientId}
        options={clients}
        onSelect={(v) => apply({ clientId: v, projectId: null })}
      />
      <FilterSelect
        label="Proyecto"
        value={optimistic.projectId}
        options={visibleProjects.map((p) => ({ id: p.id, name: p.name }))}
        onSelect={(v) => apply({ projectId: v })}
      />
      <FilterSelect
        label="Persona"
        value={optimistic.userId}
        options={people}
        onSelect={(v) => apply({ userId: v })}
      />

      {showExport && (
        <a
          href={exportHref}
          className="ml-auto inline-flex items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-ui hover:bg-surface-hover"
          download
        >
          <DownloadIcon aria-hidden="true" className="size-3.5" />
          Exportar CSV
        </a>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string | null;
  options: { id: string; name: string }[];
  onSelect: (value: string | null) => void;
}) {
  const selected = options.find((o) => o.id === value);
  const empty = options.length === 0;
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-caption">{label}</Label>
      <Select
        value={value ?? ALL}
        onValueChange={(next) => onSelect(next === ALL ? null : (next as string))}
        disabled={empty && !selected}
      >
        <SelectTrigger size="sm" className="w-auto min-w-40" aria-label={label}>
          <SelectValue>
            {selected ? selected.name : <span className="text-muted-foreground">Todos</span>}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectItem value={ALL}>Todos</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
