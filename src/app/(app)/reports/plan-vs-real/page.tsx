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
import { getPlanVsRealReport } from "@/lib/time-entries/query";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Reporte plan-vs-real (016 T6.4). Agrupa por (proyecto × persona) en el
 * rango; muestra plan (horas comprometidas en bookings approved), real
 * (horas cargadas en time_entries), delta y %.
 *
 * Casos especiales:
 *   - plan > 0 y real = 0 → "plan sin real" (compromiso incumplido).
 *   - plan = 0 y real > 0 → "real sin plan" (trabajo no anticipado).
 */
export default async function PlanVsRealReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = parseReportFilters(raw);

  const supabase = await createClient();
  const [rows, clients, projects, people] = await Promise.all([
    getPlanVsRealReport(filters),
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

  const totals = rows.reduce(
    (acc, r) => ({
      plan: acc.plan + r.planMinutes,
      real: acc.real + r.realMinutes,
    }),
    { plan: 0, real: 0 },
  );

  return (
    <>
      <ReportFiltersBar
        basePath="/reports/plan-vs-real"
        filters={filters}
        clients={clients}
        projects={projects}
        people={people}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Sin datos en este rango"
          description="No hay bookings aprobados ni time entries en el período."
        />
      ) : (
        <>
          <p className="text-caption text-muted-foreground mb-2">
            Totales:{" "}
            <span className="font-data text-foreground">
              {formatMinutesDecimal(totals.plan)}
            </span>{" "}
            planificadas ·{" "}
            <span className="font-data text-foreground">
              {formatMinutesDecimal(totals.real)}
            </span>{" "}
            cargadas
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Persona</TableHead>
                <TableHead className="text-right">Plan</TableHead>
                <TableHead className="text-right">Real</TableHead>
                <TableHead className="text-right">Delta</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const delta = row.realMinutes - row.planMinutes;
                const pct =
                  row.planMinutes > 0
                    ? Math.round((row.realMinutes / row.planMinutes) * 100)
                    : null;
                const kind =
                  row.planMinutes === 0
                    ? "real_sin_plan"
                    : row.realMinutes === 0
                      ? "plan_sin_real"
                      : "normal";
                return (
                  <TableRow key={`${row.projectId}-${row.userId}`}>
                    <TableCell>{row.projectName}</TableCell>
                    <TableCell>{row.userName}</TableCell>
                    <TableCell className="font-data text-right">
                      {row.planMinutes > 0
                        ? formatMinutesDecimal(row.planMinutes)
                        : "—"}
                    </TableCell>
                    <TableCell className="font-data text-right">
                      {row.realMinutes > 0
                        ? formatMinutesDecimal(row.realMinutes)
                        : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "font-data text-right",
                        delta > 0 && "text-attention",
                        delta < 0 && "text-muted-foreground",
                      )}
                    >
                      {kind === "normal"
                        ? `${delta > 0 ? "+" : ""}${formatMinutesDecimal(delta)}`
                        : kind === "real_sin_plan"
                          ? "sin plan"
                          : "sin real"}
                    </TableCell>
                    <TableCell className="font-data text-right">
                      {pct !== null ? `${pct}%` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </>
  );
}
