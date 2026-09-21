# Plan — Tareas (rename) + reporte planilla con export XLSX

- **ID:** 021-time-tracker-tasks-and-export
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `016-time-tracking` (dueño de `project_activities`, `time_entries`, endpoint `export.csv`, `<TimeEntryDialog>`, `<ProjectActivitiesPanel>`, `/reports`).

---

## 1. Resumen técnico

Feature chica, dos ejes que no comparten código:

1. **Rename UI Actividades → Tareas.** Es un pass de reemplazos de strings sobre ~8 archivos del frontend. Cero base, cero API, cero types. La tabla `project_activities` no se toca, los identificadores del código (`activity_id`, `activityId`, `ActivitiesPanel`, `project-activities-panel.tsx`) tampoco. Solo cambian labels visibles y el copy asociado (placeholders, tooltips, mensajes de validación). Un test-guardrail busca "actividad" residual como safety net.

2. **Reporte planilla + export XLSX.** Se refactorea el endpoint `GET /api/time-entries/export.csv` para producir las 11 columnas del reporte de referencia (Cliente, Proyecto, Usuario, Tarea, Fecha inicio, Fecha fin, Zona horaria, Duración, Horas, Notas, Ticket) — es un **breaking change** del shape del CSV (confirmado que no hay consumidores externos). Se suma un nuevo endpoint `GET /api/time-entries/export.xlsx` que corre la **misma query** pero serializa a XLSX con `exceljs`, celdas tipadas (Date, número, hyperlink en Ticket). Los dos endpoints comparten un helper `src/lib/reports/time-entries-report.ts` que expone (a) `queryTimeEntriesForReport(filters)` y (b) el mapeo `entry → ReportRow`. La UI del export en `<ReportFiltersBar>` gana un dropdown "Exportar CSV / XLSX".

Sin migrations. Sin cambios en RLS. Sin cambios en el contrato de API (los payloads siguen usando `activity_id` en JSON).

### Qs de la spec cerradas en el plan

- **Q-1 · Librería XLSX:** **`exceljs`**. Estándar Node, streaming, cell formats completos. El bundle server-side es de ~500 KB — irrelevante para runtime.
- **Q-2 · UI del botón:** **dropdown "Exportar ▾"** con dos ítems (CSV, XLSX) dentro del `<ReportFiltersBar>` existente. Un `<DropdownMenu>` de shadcn (ya instalado) — sin sumar componente nuevo.
- **Q-3 · Breaking change del CSV:** **sí, hacer el cambio.** Sin consumidores externos automatizados conocidos. Se documenta en el commit.
- **Q-4 · Hyperlink en Ticket del XLSX:** **sí**, apuntando a `${NEXT_PUBLIC_SITE_URL}/tickets/<key>`. Sin variable base, cae a texto plano `PROJ-N`.
- **Q-5 · Zona horaria fija:** **sí**, `America/Argentina/Buenos_Aires` hardcodeado. Path futuro por `profiles.timezone` documentado.
- **Q-6 · Snapshot del sprint report no se toca:** **sí**. El JSON de `sprints.report` mantiene la key interna `activity_name`; la vista lo muestra como "Tarea". Ningún dato histórico se rescribe.
- **Q-7 · Test guardrail del rename con exclusion list:** **sí**. Test unit único.

---

## 2. Modelo de datos

**Sin cambios.** Ninguna migration.

- La tabla `project_activities` sigue igual (`id`, `project_id`, `name`, `is_active`, `created_at`, `updated_at`, RLS existente).
- `time_entries.activity_id` sigue apuntando a `project_activities.id`.
- El `sprints.report` jsonb existente sigue guardando `activity_name` en su snapshot inmutable — no se rescribe.

**Deliberado:** cambiar el nombre de la tabla productiva sería un refactor puro sin valor. ADR 0002 (`docs/adr/0002-language-conventions.md`) ya justifica que el schema queda en inglés y el producto en español; esta feature es exactamente ese patrón.

---

## 3. Phase 1 — Rename UI Actividades → Tareas

Toca 8 archivos del frontend. Todos son reemplazos de string; ningún cambio de lógica. Se hace archivo por archivo, con un test-guardrail al final que garantice que no quedó nada suelto.

### 3.1 Archivos y strings a cambiar

Del grep de la spec, con conteo de ocurrencias:

| Archivo | # | Strings visibles a reemplazar |
| :--- | :-: | :--- |
| `src/components/projects/project-activities-panel.tsx` | 10 | Título, CTA, empty state, form ("Nueva actividad" → "Nueva tarea", etc.) |
| `src/components/time-entries/time-entry-dialog.tsx` | 4 | Label del select, placeholders ("Elegí una actividad", "Sin actividad"), mensaje "El proyecto no tiene actividades activas" |
| `src/app/(app)/my-time/page.tsx` | 2 | Encabezado o filtro que aluda a actividades |
| `src/components/tickets/ticket-detail.tsx` | 1 | Chip/label de la columna de tarea en el listado de horas |
| `src/components/timer-pill.tsx` | 1 | Label del cronómetro que muestra la tarea activa |
| `src/app/(app)/projects/[projectKey]/activities/page.tsx` | 1 | Heading de la página (mantener el segmento URL `/activities` intacto — no se rompe bookmarks) |
| `src/components/projects/project-workspace-header.tsx` | 1 | Label de la tab del workspace |
| _api routes_ | (varios) | **Los strings de `/api/*` son comentarios en código o mensajes de error internos, no UI. No se tocan.** Excepción: `export.csv` cambia enteramente en Phase 2, ahí va. |

### 3.2 Regla de rename

**Se cambia:** todo label, placeholder, tooltip, título de página, texto de botón, mensaje de validación, empty state y texto de confirmación que un usuario final lea.

**No se cambia:**

- Identificadores de código (`activityId`, `activity_id`, `ActivitiesPanel`, `useActivities`, nombre de archivos).
- Comentarios explicativos del código que aludan a la tabla `project_activities` — al contrario, se preservan como puente entre el nombre del schema (inglés) y el del producto (español), agregando en algunos comentarios clave la nota **"en la UI se llama Tarea"**.
- Segmentos de URL (`/projects/[projectKey]/activities`). Cambiarlo sería un breaking change de bookmarks internos y no aporta al usuario final.
- El nombre del campo `activity` en respuestas JSON de la API. Nada externo lo consume, pero cambiarlo obliga a tocar client + server en paralelo, sumar deprecations, etc. Sin caso a favor.

### 3.3 Copywriting

Concordancia de género/número consistente:

- Singular: "Tarea", "una tarea", "esta tarea", "sin tarea"
- Plural: "Tareas", "las tareas", "sin tareas asignadas"
- Verbos: "Crear tarea", "Editar tarea", "Elegí una tarea"

Un pass de review contra la planilla de referencia antes de mergear (R-6 de la spec). El plan no lista línea por línea — eso vive en `tasks.md`.

### 3.4 Test guardrail

Un test unit nuevo en `tests/unit/rename-tareas.test.ts` que:

1. Lee recursivamente `src/components/**/*.tsx` y `src/app/**/*.tsx`.
2. Para cada archivo, remueve comentarios (`//…` y `/*…*/`).
3. Busca `\bactividad(es)?\b` en el remanente, case-insensitive.
4. Falla si hay match **fuera de una lista de exclusión** — archivos donde "actividad" aparece legítimamente por otra razón (p.ej. un `docs/` embebido en jsx, un ejemplo dentro de un texto). En la práctica, la lista debería quedar vacía o casi.

**Trade-off aceptado:** este test es scrappy (regex sobre código fuente), no perfecto — puede tener falsos positivos en strings dinámicos o falsos negativos si "actividad" aparece en un identificador raro. Es un guardrail, no una garantía dura. Alcanza para el caso.

### 3.5 Fuera de la Phase 1

- Rename del segmento URL `/projects/[projectKey]/activities` — se conserva.
- Rename de la ruta de API `/api/project-activities` — se conserva.
- Actualización del `sprints.report jsonb` snapshot — inmutable por diseño, se preserva.

---

## 4. Phase 2 — Reporte planilla + serializers

Refactor del pipeline de export para producir las 11 columnas alineadas con la planilla de referencia. Serializadores separados (CSV y XLSX) que comparten el pipeline de query y el mapeo `entry → ReportRow`.

### 4.1 Helper compartido `src/lib/reports/time-entries-report.ts`

Un archivo nuevo con tres exports:

```ts
export type ReportRow = {
  cliente: string;
  proyecto: string;
  usuario: string;
  tarea: string | null;
  fechaInicio: Date;
  fechaFin: Date;
  zonaHoraria: string; // fijo "America/Argentina/Buenos_Aires" en el MVP
  duracion: string;    // "HH:MM"
  horas: number;       // 2 decimales
  notas: string | null;
  ticketKey: string | null;   // "PROJ-N" o null
  ticketUrl: string | null;   // `${NEXT_PUBLIC_SITE_URL}/tickets/PROJ-N` o null
};

export const REPORT_COLUMNS: { key: keyof ReportRow; header: string }[] = [
  { key: "cliente", header: "Cliente" },
  { key: "proyecto", header: "Proyecto" },
  { key: "usuario", header: "Usuario" },
  { key: "tarea", header: "Tarea" },
  { key: "fechaInicio", header: "Fecha inicio" },
  { key: "fechaFin", header: "Fecha fin" },
  { key: "zonaHoraria", header: "Zona horaria" },
  { key: "duracion", header: "Duración" },
  { key: "horas", header: "Horas" },
  { key: "notas", header: "Notas" },
  { key: "ticketKey", header: "Ticket" },
];

export async function queryTimeEntriesForReport(
  filters: ExportQueryInput,
): Promise<ReportRow[]>;
```

`queryTimeEntriesForReport` centraliza:
- El `select` con los mismos embeds que el `export.csv` de hoy, ampliado con `logged_at`, `start_time`, `projects.key` (para armar el ticket key sin un segundo query — hoy hay un TODO de eso en el `route.ts`), y el `client.name`.
- El filtro por `clientId` (via `project.client_id`), `projectId`, `userId` y rango de fechas.
- El mapeo entry → ReportRow, incluyendo:
  - **`fechaInicio`:** composición de `logged_at` (fecha) + `start_time` (hora local). Si `start_time` es null, cae a `logged_at 00:00` (AC-2.4 de la spec).
  - **`fechaFin`:** `fechaInicio + minutes` (JavaScript Date con offset local de la TZ fija).
  - **`duracion`:** `formatDurationHHMM(minutes)` — string `HH:MM` con leading zeros.
  - **`horas`:** `minutes / 60` con dos decimales.
  - **`ticketKey`:** `PROJ-N` armado desde `project.key + ticket.numero` (el bug del TODO del CSV actual se cierra acá).
  - **`ticketUrl`:** `${process.env.NEXT_PUBLIC_SITE_URL}/tickets/PROJ-N` si la variable existe.

**Contract:** el helper no filtra por permisos — asume que el caller ya autorizó. RLS de `time_entries` sigue vigente en la query (respeta el alcance del viewer).

### 4.2 Serializer CSV: `src/lib/reports/serialize-csv.ts`

Función pura `serializeReportToCsv(rows: ReportRow[]): string`.

- Header: `REPORT_COLUMNS.map(c => c.header).join(",")`.
- Cada row: `REPORT_COLUMNS.map(c => escapeCsv(formatCsvValue(row[c.key]))).join(",")`.
- `formatCsvValue`:
  - `Date` → `yyyy-MM-dd HH:mm` en TZ fija (o el string que Excel/Sheets abra como fecha sin ambigüedad; opción alternativa: ISO 8601 con TZ). Elegimos `dd/mm/yyyy HH:mm` **para consistencia con XLSX** — CSV pasa por regionalización en Excel; si emitimos ISO, Google Sheets lo lee bien pero Excel argentino lo interpreta raro. `dd/mm/yyyy HH:mm` es el formato que los dos abren correctamente.
  - `number` → `toFixed(2)` para `horas`.
  - `null` → `""`.
  - `ticketKey` en CSV: solo el string `PROJ-N` (sin hyperlink — CSV no lo soporta). `ticketUrl` no se emite en CSV.
- `escapeCsv`: envuelve en `"..."` si contiene coma, comilla, salto de línea. Comillas dobles internas se duplican. Idéntico al helper del `export.csv` actual (se reusa).

**Salida:** string, listo para responder con `Content-Type: text/csv; charset=utf-8`.

### 4.3 Serializer XLSX: `src/lib/reports/serialize-xlsx.ts`

Función `serializeReportToXlsx(rows: ReportRow[]): Promise<Buffer>` con `exceljs`.

```ts
import ExcelJS from "exceljs";

export async function serializeReportToXlsx(rows: ReportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Planilla");
  
  sheet.columns = REPORT_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: /* ancho razonable por columna */,
  }));
  
  for (const row of rows) {
    const excelRow = sheet.addRow(row);
    // Cell type hints — exceljs mapea Date/number nativos, pero forzamos numFmt
    excelRow.getCell("fechaInicio").numFmt = "dd/mm/yyyy hh:mm";
    excelRow.getCell("fechaFin").numFmt = "dd/mm/yyyy hh:mm";
    excelRow.getCell("horas").numFmt = "0.00";
    
    // Hyperlink en Ticket
    if (row.ticketUrl && row.ticketKey) {
      const cell = excelRow.getCell("ticketKey");
      cell.value = { text: row.ticketKey, hyperlink: row.ticketUrl };
    }
  }
  
  // Bold en la primera fila (header)
  sheet.getRow(1).font = { bold: true };
  
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
```

**Decisiones concretas del formato:**

- **Anchos de columna** (chars aprox): Cliente 20, Proyecto 20, Usuario 20, Tarea 20, Fecha inicio 18, Fecha fin 18, Zona horaria 22, Duración 10, Horas 8, Notas 40, Ticket 12.
- **Cell types:**
  - `Date` → `exceljs` lo serializa como número de días desde 1900 (formato interno de Excel). El `numFmt = "dd/mm/yyyy hh:mm"` fuerza el display.
  - `number` (`horas`) → cell numérica, `numFmt = "0.00"`.
  - `string` → texto plano.
  - `ticketKey` con URL → `{ text, hyperlink }` — Excel lo abre como link clickeable con color azul y subrayado.
  - `null` → celda vacía (no la string `"null"`).
- **Zona horaria del Date:** las fechas se instancian en TZ local del server (por default UTC en Vercel). Como el reporte tiene la columna "Zona horaria" fija en Buenos Aires, formateamos las fechas en esa TZ. Usamos `Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })` a nivel del mapeo `entry → ReportRow` para que el Date que llega a exceljs ya represente el momento local. **No forzamos** el tz al Date object (JavaScript Date no lo soporta nativo); lo que llega a exceljs es un Date interpretable como "el momento absoluto que corresponde a las 09:00 de Buenos Aires del día X" — Excel lo muestra en la TZ del cliente que abre. **Trade-off:** si alguien abre el reporte en otra TZ, ve las horas convertidas — que es lo correcto para un tipo `Date`. Si quisiéramos ver "siempre las horas de Buenos Aires sin importar dónde se abre", tendríamos que emitir strings, no Date, y perder el typing.

### 4.4 Endpoint CSV refactoreado: `src/app/api/time-entries/export.csv/route.ts`

Reemplaza el body actual por:

```ts
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return unauthorized();
  if (!isAdmin(profile.roles) && !isPm(profile.roles)) return forbidden();
  
  const parsed = exportQuerySchema.safeParse({ /* misma query string */ });
  if (!parsed.success) return badRequest(parsed.error);
  
  const rows = await queryTimeEntriesForReport(parsed.data);
  const csv = serializeReportToCsv(rows);
  
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="planilla-${parsed.data.from}-a-${parsed.data.to}.csv"`,
    },
  });
}
```

- **El código actual del handler queda como un shell delgado** — toda la lógica se movió al helper y al serializer.
- **Los headers del CSV cambian.** Es el breaking change confirmado. Se documenta en el commit.
- **El nombre del archivo cambia** de `time-entries-<from>-to-<to>.csv` a `planilla-<from>-a-<to>.csv` — consistente con el XLSX y con el nombre del reporte de origen.

### 4.5 Endpoint XLSX nuevo: `src/app/api/time-entries/export.xlsx/route.ts`

Nuevo archivo, mismo patrón que el CSV:

```ts
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return unauthorized();
  if (!isAdmin(profile.roles) && !isPm(profile.roles)) return forbidden();
  
  const parsed = exportQuerySchema.safeParse({ /* misma query string */ });
  if (!parsed.success) return badRequest(parsed.error);
  
  const rows = await queryTimeEntriesForReport(parsed.data);
  const buffer = await serializeReportToXlsx(rows);
  
  return new Response(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="planilla-${parsed.data.from}-a-${parsed.data.to}.xlsx"`,
    },
  });
}
```

**Timeout de Vercel:** el free tier corta a 10 s, el pro a 60 s. Con `exceljs` no-streaming (write al buffer completo en memoria) el peor caso proyectado (12k filas) queda debajo de 3 s en local — margen sobrado. Si la producción crece más, se pasa a streaming (`workbook.xlsx.write(response)` sobre `WritableStream`), pero eso es una optimización para el futuro, no del MVP.

**Bundle:** exceljs se importa dinámicamente en el handler (`const ExcelJS = await import("exceljs")`) para que no cargue en cold start si nadie pide el XLSX. Reduce cold start del rest del bundle server.

### 4.6 Deps

- `pnpm add exceljs`. Sin `@types/exceljs` — trae sus propios types.

### 4.7 Fuera de Phase 2

- Página web nueva que muestre la planilla en pantalla — no. Solo botones de export.
- Filtro nuevo por "Tarea" en `<ReportFiltersBar>` — no en esta feature (se anota en §9 de la spec como futuro).
- Retro-emisión de reportes de sprint viejos en XLSX — no.

---

## 5. Phase 3 — UI del botón export

El componente `<ReportFiltersBar>` (`src/components/reports/report-filters-bar.tsx`) tiene hoy un link/botón que dispara `/api/time-entries/export.csv?...`. Se cambia a un **dropdown de dos opciones**.

### 5.1 Cambios en `<ReportFiltersBar>`

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// ...

const exportQuery = new URLSearchParams({ from, to, ... }).toString();

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm">
      Exportar <ChevronDownIcon className="ml-1 size-3" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem asChild>
      <a href={`/api/time-entries/export.csv?${exportQuery}`}>CSV</a>
    </DropdownMenuItem>
    <DropdownMenuItem asChild>
      <a href={`/api/time-entries/export.xlsx?${exportQuery}`}>XLSX (Excel)</a>
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

- **`<DropdownMenu>` de shadcn** — verificar que esté instalado; si no, `pnpm dlx shadcn@latest add dropdown-menu` y ajustar a la escala de densidad (ADR 0006, mismo pattern que los otros componentes de `src/components/ui/`).
- El botón sigue siendo `variant="outline" size="sm"` para no romper el layout de la barra.
- Los `<a href>` disparan la descarga nativa del browser — sin `fetch`, sin loading state. Es lo que hace hoy con el CSV; se preserva.

### 5.2 Comportamiento cuando faltan filtros obligatorios

El rango de fechas es obligatorio (validado en `exportQuerySchema`). Si el usuario clickea Export sin rango, el server responde 400 y el browser abre una página con JSON de error. **Eso ya pasa hoy** con el CSV — no se cambia. La UX de "botón deshabilitado si no hay rango" queda para una feature futura si aparece.

---

## 6. Phase 4 — Tests

### 6.1 Test guardrail del rename

`tests/unit/rename-tareas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

// Archivos donde "actividad" es legítima por otra razón (comentario que
// documenta el nombre del schema, ejemplo dentro de una string dinámica, etc.).
// Se agregan uno por uno si aparecen, con comentario que explica por qué.
const EXCLUSION_LIST: string[] = [];

const UI_ROOTS = ["src/components", "src/app"];

describe("021 rename Actividades → Tareas", () => {
  it("no queda ninguna 'actividad' visible en la UI", () => {
    const files = UI_ROOTS.flatMap((root) => 
      globSync(`${root}/**/*.{ts,tsx}`, { nodir: true }),
    );
    
    const violations: { file: string; line: number; text: string }[] = [];
    
    for (const file of files) {
      if (EXCLUSION_LIST.includes(file)) continue;
      
      const content = readFileSync(file, "utf-8");
      // Remover comentarios de línea y de bloque
      const stripped = content
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      
      const matches = stripped.match(/\bactividad(es)?\b/gi);
      if (matches) {
        // Rearmar contexto para el mensaje de error
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (/\bactividad(es)?\b/i.test(lines[i]) && 
              !/^\s*\/\//.test(lines[i]) && 
              !/^\s*\*/.test(lines[i])) {
            violations.push({ file, line: i + 1, text: lines[i].trim() });
          }
        }
      }
    }
    
    expect(violations).toEqual([]);
  });
});
```

**Filosofía del test:** falla ruidoso si aparece. La `EXCLUSION_LIST` empieza vacía y solo se llena si hay un caso legítimo puntual (con comentario del PR que la agrega). Es scrappy pero suficiente — cubre R-1 de la spec.

### 6.2 Fuera del scope de testing

- **Unit del serializer XLSX:** decidido no hacer. Se confía en que `exceljs` produce archivos válidos. Un test que abra el buffer con `xlsx-parser` o similar y valide las celdas sería útil pero es mucha maquinaria para un serializer que solo mapea columnas.
- **Integration test contra el endpoint real:** decidido no hacer. Requiere fixtures de `time_entries` en la base efímera de CI + parseo del binario. No compensa hoy.
- **Test del serializer CSV:** ya existe indirectamente por el shape del CSV actual (la suite de 016 lo cubre). Se ajustan los expectations si se rompen al cambiar los headers.

Si algún test existente de 016 rompe por el cambio de headers del CSV, se actualiza en la misma Phase.

---

## 7. Migrations

**Cero migrations.** No se agrega, modifica ni borra nada del schema.

---

## 8. Deps

- **Nueva:** `exceljs` (~500 KB, server-side).
- **Sin cambios en deps existentes.**

---

## 9. Riesgos revisitados

Los riesgos R-1 a R-8 de la spec siguen vigentes. Actualización mínima con lo que decidió el plan:

- **R-1 · Rename incompleto** — cubierto por el test guardrail (§6.1).
- **R-2 · Break de consumidores del CSV** — confirmado que no hay externos. El commit lo documenta.
- **R-3 · Timeout XLSX en rangos grandes** — mitigado con `exceljs` no-streaming (proyectado bajo 3 s para 12k filas). Si aparece, se pasa a streaming.
- **R-4 · Formato de fecha malinterpretado por Excel** — mitigado con `numFmt` explícito en XLSX y `dd/mm/yyyy HH:mm` en CSV. Los dos abren consistente en Excel argentino y Google Sheets.
- **R-5 · `start_time` null en entries viejas** — aceptado. Fallback documentado en §4.1.
- **R-6 · Copywriting inconsistente** — pass de review dedicado. Sin automatización — es un review humano puntual.
- **R-7 · Confusión "Tarea" vs "Ticket"** — aceptada. Misma convención que la herramienta anterior.
- **R-8 · Fase 2 Servicios** — futuro, sin impacto en la Phase actual.

**Un riesgo nuevo del plan:**

- **R-9 · Formatos regionales de Excel al abrir el XLSX.** Excel usa el locale del sistema para interpretar las fechas del reporte. Emitirlas como `Date` object nativo + `numFmt` es el path correcto para que Excel no reinterprete — pero **si el server corre en TZ distinta a Buenos Aires** (Vercel por default UTC), el Date object internamente representa "el instante correspondiente" y Excel lo va a mostrar en la TZ del cliente. **Mitigación:** el `numFmt` `dd/mm/yyyy hh:mm` sin flag `[$-...]` de locale es locale-neutral — Excel lo muestra tal cual sin convertir. Si Argentina abre el archivo, ve `18/09/2026 09:30`; si USA lo abre, ve `18/09/2026 09:30` también (no `09/18/2026`). Testeado en Excel + Google Sheets antes de mergear.

---

## 10. Cierre

Al terminar la feature:

1. Marcar 021 como done en `specs/features/README.md`.
2. Actualizar `CLAUDE.md`:
   - Estructura del repo: sumar `src/lib/reports/` con los tres archivos nuevos (`time-entries-report.ts`, `serialize-csv.ts`, `serialize-xlsx.ts`).
   - Sección "Convenciones de código > Tiempo y reportes" (o donde encaje mejor): recordatorio de que **"Tarea" es el término del producto para lo que en el schema se llama `project_activities`**. El próximo lector que vea `activity_id` no se pierde.
   - Estado de features: línea para 021 done.
3. `docs/adr/0002-language-conventions.md` — sumar el caso "Actividad/Tarea" al listado de ejemplos, si el ADR los lista. Si no, no.
4. Verificación visual del usuario:
   - Abrir la tab del workspace del proyecto → dice "Tareas".
   - Cargar tiempo → dropdown dice "Tarea".
   - `/reports` → botón "Exportar ▾" con CSV/XLSX.
   - Descargar XLSX, abrirlo en Excel y Google Sheets → columnas correctas, fechas formateadas, hyperlink en Ticket clickeable.
   - Descargar CSV, abrirlo en Google Sheets → mismas columnas.
