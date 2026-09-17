import { EmptyState } from "@/components/empty-state";
import { ReportFiltersBar } from "@/components/reports/report-filters-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseReportFilters } from "@/lib/reports/filters";
import { createClient } from "@/lib/supabase/server";
import { formatMinutesDecimal } from "@/lib/time-entries/format";
import { getConsumoReport } from "@/lib/time-entries/query";

export const dynamic = "force-dynamic";

/**
 * Reporte de consumo (016 T6.3). Tabla Cliente > Proyecto > Persona con
 * horas cargadas en el rango. Los filtros viven en la URL; el export CSV
 * usa los mismos.
 */
export default async function ConsumoReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = parseReportFilters(raw);

  const supabase = await createClient();
  const [rows, clients, projects, people] = await Promise.all([
    getConsumoReport(filters),
    supabase
      .from("clients")
      .select("id, name")
      .order("name", { ascending: true })
      .then((res) => res.data ?? []),
    supabase
      .from("projects")
      .select("id, name, client_id")
      .order("name", { ascending: true })
      .then((res) =>
        (res.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          clientId: p.client_id,
        })),
      ),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("active", true)
      .order("full_name", { ascending: true })
      .then((res) =>
        (res.data ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.email })),
      ),
  ]);

  const totalMinutes = rows.reduce((acc, r) => acc + r.totalMinutes, 0);

  return (
    <>
      <ReportFiltersBar
        basePath="/reports/consumo"
        filters={filters}
        clients={clients}
        projects={projects}
        people={people}
        showExport
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Sin cargas en este rango"
          description="Probá ampliar las fechas o quitar filtros."
        />
      ) : (
        <>
          <p className="text-caption text-muted-foreground mb-2">
            Total en el rango:{" "}
            <span className="font-data text-foreground">
              {formatMinutesDecimal(totalMinutes)}
            </span>{" "}
            en {rows.length} {rows.length === 1 ? "combinación" : "combinaciones"}.
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Persona</TableHead>
                <TableHead className="text-right">Horas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.projectId}-${row.userId}`}>
                  <TableCell>{row.clientName}</TableCell>
                  <TableCell>{row.projectName}</TableCell>
                  <TableCell>{row.userName}</TableCell>
                  <TableCell className="font-data text-right">
                    {formatMinutesDecimal(row.totalMinutes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </>
  );
}
