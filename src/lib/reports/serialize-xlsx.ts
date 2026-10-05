import ExcelJS from "exceljs";

import { REPORT_COLUMNS, type ReportRow } from "./time-entries-report";

/**
 * Serializa el reporte "planilla" a XLSX con `exceljs`. Un solo sheet,
 * header en bold, celdas tipadas:
 *
 *   - `Date` con `numFmt = "dd/mm/yyyy hh:mm"` — locale-neutral (sin `[$-xxx]`
 *     prefix), Excel no lo reinterpreta por locale del cliente que lo abre
 *     (mitiga R-9 del plan).
 *   - `horas` como número con `numFmt = "0.00"` — Excel lo muestra con dos
 *     decimales y permite SUM().
 *   - `ticketKey` con URL como `{ text, hyperlink }` → clickeable en Excel y
 *     Google Sheets. Si `ticketUrl` es null (sin `NEXT_PUBLIC_SITE_URL`),
 *     emite solo el texto.
 *   - `null` → celda vacía (no la string "null").
 *
 * El endpoint (`route.ts` del XLSX) importa este archivo con `await import()`
 * para no pagar el cold start de los ~500 KB de exceljs si nadie pide el XLSX.
 */

const COLUMN_WIDTHS: Record<keyof ReportRow, number> = {
  cliente: 20,
  proyecto: 20,
  usuario: 20,
  tarea: 20,
  fechaInicio: 18,
  fechaFin: 18,
  zonaHoraria: 22,
  duracion: 10,
  horas: 8,
  notas: 40,
  ticketKey: 12,
  ticketUrl: 0, // no es columna renderizada; se usa para armar el hyperlink.
};

export async function serializeReportToXlsx(rows: ReportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Planilla");

  sheet.columns = REPORT_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: COLUMN_WIDTHS[c.key],
  }));

  for (const row of rows) {
    const excelRow = sheet.addRow({
      cliente: row.cliente,
      proyecto: row.proyecto,
      usuario: row.usuario,
      tarea: row.tarea,
      fechaInicio: row.fechaInicio,
      fechaFin: row.fechaFin,
      zonaHoraria: row.zonaHoraria,
      duracion: row.duracion,
      horas: row.horas,
      notas: row.notas,
      ticketKey: row.ticketKey,
    });

    excelRow.getCell("fechaInicio").numFmt = "dd/mm/yyyy hh:mm";
    excelRow.getCell("fechaFin").numFmt = "dd/mm/yyyy hh:mm";
    excelRow.getCell("horas").numFmt = "0.00";

    if (row.ticketKey && row.ticketUrl) {
      excelRow.getCell("ticketKey").value = {
        text: row.ticketKey,
        hyperlink: row.ticketUrl,
      };
    }
  }

  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
