import { NextResponse } from "next/server";

import { isAdmin, isPm } from "@/lib/auth/roles";
import { queryTimeEntriesForReport } from "@/lib/reports/time-entries-report";
import { getCurrentProfile } from "@/lib/supabase/session";
import { exportQuerySchema } from "@/lib/validation/time-entries";

/**
 * Export XLSX del reporte "planilla" (021 T2.6). Hermano del CSV con los
 * mismos filtros, el mismo pipeline de query y el mismo mapeo — cambia
 * solo el serializer. Columnas en orden alineado con la planilla comercial
 * (ver `src/lib/reports/time-entries-report.ts`).
 *
 * **Dynamic import de exceljs y del serializer.** `exceljs` pesa ~500 KB
 * server-side; cargarlo estático metía ese costo en el cold start del resto
 * de los handlers. Con el import diferido, solo se paga en el primer request
 * a este endpoint — después queda cacheado en el runtime.
 *
 * **Permisos.** Mismo criterio que el CSV: solo admin o PM.
 */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (!isAdmin(profile.roles) && !isPm(profile.roles)) {
    return NextResponse.json(
      { error: "Solo admin y PMs pueden exportar" },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const parsed = exportQuerySchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    clientId: url.searchParams.get("clientId") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
    userId: url.searchParams.get("userId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parámetros inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let rows;
  try {
    rows = await queryTimeEntriesForReport(parsed.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error consultando entries";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { serializeReportToXlsx } = await import("@/lib/reports/serialize-xlsx");
  const buffer = await serializeReportToXlsx(rows);
  const filename = `planilla-${parsed.data.from}-a-${parsed.data.to}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
