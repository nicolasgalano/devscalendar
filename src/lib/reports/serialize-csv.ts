import { REPORT_COLUMNS, type ReportRow } from "./time-entries-report";

/**
 * Serializa el reporte "planilla" a CSV. Headers en español (desde
 * `REPORT_COLUMNS`), orden fijo, una fila por entry. Fechas como
 * `dd/mm/yyyy HH:mm` para que Excel argentino y Google Sheets las lean
 * sin reinterpretación de locale. `horas` con dos decimales. `null` → `""`.
 *
 * El CSV no soporta hyperlinks — el `ticketUrl` del `ReportRow` solo lo
 * usa el serializer XLSX. Acá emitimos `ticketKey` plano.
 */
export function serializeReportToCsv(rows: ReportRow[]): string {
  const lines: string[] = [];
  lines.push(REPORT_COLUMNS.map((c) => escapeCsv(c.header)).join(","));
  for (const row of rows) {
    lines.push(
      REPORT_COLUMNS.map((c) => escapeCsv(formatValue(row, c.key))).join(","),
    );
  }
  return lines.join("\n");
}

function formatValue(row: ReportRow, key: keyof ReportRow): string {
  const value = row[key];
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDateTime(value);
  if (key === "horas" && typeof value === "number") return value.toFixed(2);
  return String(value);
}

/**
 * Formatea un `Date` cuyos componentes UTC representan la wall-clock de BA
 * (ver nota en `time-entries-report.ts`). `UTC` acá es intencional: lee los
 * componentes tal como se almacenaron, sin aplicar offset.
 */
function formatDateTime(date: Date): string {
  const d = date.getUTCDate().toString().padStart(2, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const y = date.getUTCFullYear();
  const h = date.getUTCHours().toString().padStart(2, "0");
  const min = date.getUTCMinutes().toString().padStart(2, "0");
  return `${d}/${m}/${y} ${h}:${min}`;
}

function escapeCsv(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
