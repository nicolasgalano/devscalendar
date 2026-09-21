# Spec — Tareas (rename) + reporte planilla con export XLSX

- **ID:** 021-time-tracker-tasks-and-export
- **Estado:** draft
- **Referencias:** `016-time-tracking` (tabla `project_activities`, `time_entries`, ruta `/reports`, endpoint `GET /api/time-entries/export.csv`, tab "Actividades" en el workspace del proyecto). `018-sprints-and-reporting` (sección "Horas cargadas" del reporte de sprint — se hereda el rename).

---

## 1. Objetivo

Alinear el time tracker de DevsCalendar con el reporte de referencia que ya usa el equipo comercial (planilla exportada de la herramienta anterior), en dos ejes:

1. **Vocabulario.** Lo que hoy se llama **"Actividad"** en la UI pasa a **"Tarea"** — es la palabra que usa el reporte de origen ("Tarea = Meeting, Development, Training, …") y la que ya usan los devs y los PMs al hablar de la carga de tiempo. No hay cambio de modelo: las "tareas" son las mismas filas de `project_activities` que existen desde `016` (texto libre por proyecto, gestión por admin/PM). Solo cambian labels y placeholders. La base **no** se toca.
2. **Reporte tabular estilo planilla.** El export CSV existente (`GET /api/time-entries/export.csv`) se **extiende** con las columnas del reporte de referencia y se le suma un **export XLSX** en paralelo (mismos datos, mismo endpoint pattern). Todo lo relacionado con **facturación y valores en USD** queda **descartado** — no aparece en el export, no se guarda, no se calcula.

**Fuera del alcance (a propósito):**

- Concepto de **"Servicio" global** (Development / Analysis / Training / … como categoría cross-project que aparece en el Excel de origen). El equipo comercial confirmó que **no es prioritario ahora**. Se puede sumar más adelante sin migration si aparece el caso — quedan como pendiente en §9.
- Cualquier campo relacionado con **precio, costo, moneda, facturable, facturado**. La planilla de origen tiene 7 columnas de ese estilo (Facturable, Facturado, Precio por hora, Total, Costo por hora, Costo, Moneda); ninguna entra. **Y esto es una decisión de producto, no técnica**: la facturación se maneja afuera del sistema y no vale la pena espejar campos que van a estar siempre vacíos o desalineados con el proceso real.

---

## 2. Contexto

Dos observaciones que juntas motivan la feature.

**"Actividad" vs. "Tarea".** El equipo comercial trabaja con una planilla exportada de una herramienta previa (TrackingTime) que enumera las filas de carga de tiempo con una columna llamada **"Tarea"** — Meeting, Development, Training, Analysis, Management. En DevsCalendar la misma cosa se llama **"Actividad"** desde `016`: el PM define un catálogo de textos libres por proyecto (`project_activities`), y cada `time_entry` referencia uno opcional. **Son exactamente el mismo concepto con nombre distinto.** El desalineamiento genera fricción — al operar el sistema y hablarlo con el resto del equipo hay que traducir cada vez. Renombrarlo en la UI cierra esa fricción; en la base sigue siendo `project_activities` porque cambiar el nombre de una tabla que ya tiene datos productivos es más costo que valor (migration + refactor de queries + regeneración de types + tests).

**El reporte actual queda corto.** El endpoint `GET /api/time-entries/export.csv` de `016` emite 12 columnas: `fecha, user_email, user_nombre, cliente, proyecto, ticket_key, ticket_titulo, actividad, minutos, horas, descripcion, cargado_por`. Está bien para uso interno, pero el equipo comercial ya tiene una planilla estándar (25 columnas en origen, 11 relevantes tras descartar USD/facturación) y quiere que este sistema la reproduzca — no una versión reducida "porque acá no tenemos todos los campos" (los tenemos, solo hay que exponerlos), sino la misma tabla, ordenada igual, con los mismos nombres de columna. La lectura del reporte de referencia arroja tres campos que **hoy están en la base pero no salen al CSV**: `start_time` (hora exacta de inicio del bloque, agregada en el rediseño reciente del `TimeEntryDialog`), la duración como `HH:MM` (hoy sale como minutos enteros y horas decimales por separado), y la fecha de fin (derivable: `start_time + minutes`). El agregado no es más base — es mostrar lo que ya tenemos.

**Por qué CSV **más** XLSX y no solo XLSX.** El CSV existe, tiene consumidores (scripts internos, apertura en Google Sheets) y no cuesta mantenerlo. Sumar XLSX como camino paralelo lo pide expresamente el equipo comercial: el archivo "abre bien" en Excel con formatos (fecha como fecha, número como número), permite adjuntar en mail sin que el receptor "no lo abra por miedo a que sea un `.txt`", y da mejor primera impresión. Los dos endpoints comparten el pipeline de query — cambia solo el serializer.

**Por qué no reemplazar `/reports/consumo` o `/reports/plan-vs-real`.** Son reportes agregados con corte propio (Cliente > Proyecto > Persona, plan vs real). El nuevo es plano: una fila por `time_entry`. Convive con los dos, en el mismo `/reports` pero como export directo (sin página propia que muestre la tabla), disparado desde el mismo botón de filtros que ya tiene 016. En la práctica: mismo botón, se agrega un dropdown "CSV / XLSX".

---

## 3. User stories

- **US-1 · Vocabulario alineado** — Como cualquier usuario que carga tiempo (developer / staff / lead / PM / admin), quiero que todo lo relacionado con "actividades" diga **"tareas"** — la tab del workspace del proyecto, el dropdown del diálogo de carga, la sección del reporte de sprint, la columna del export — para no tener que traducir vocabulario entre la UI y las conversaciones del equipo.
- **US-2 · Reporte planilla completo** — Como admin o PM, quiero exportar un reporte tabular de carga de tiempo con las mismas columnas que la planilla comercial de referencia (menos USD/facturación), para adjuntarlo a mails de status y no tener que reprocesarlo en Excel.
- **US-3 · Export XLSX** — Como admin o PM, quiero descargar el mismo reporte en formato **XLSX** además del CSV existente, para que Excel lo abra con formatos de fecha y número correctos y se pueda mandar a otras áreas sin fricción.
- **US-4 · Filtros del reporte** — Como admin o PM, quiero seguir aplicando los mismos filtros que hoy (rango de fechas, cliente, proyecto, usuario) tanto al export CSV como al XLSX, para acotar el reporte a lo que necesito.
- **US-5 · Nombres de columna en español** — Como usuario, quiero que las columnas del export sean legibles en español (Cliente, Proyecto, Usuario, Tarea, Fecha inicio, Fecha fin, Zona horaria, Duración, Horas, Notas, Ticket), para que quien reciba el archivo entienda sin diccionario.
- **US-6 · Consistencia entre UI y export** — Como dueño del sistema, quiero que la columna "Tarea" del export use exactamente el mismo texto que se ve en la UI (nombre de `project_activities.name`) — sin renombrar ni traducir en el pipeline del export, para que dos exports del mismo rango de fechas den el mismo string en la celda.

---

## 4. Acceptance criteria

### US-1 · Rename UI Actividades → Tareas

- **AC-1.1** — Given navego al workspace de un proyecto siendo admin o PM, when veo las tabs (`Sprint / Backlog / Old Sprints / Actividades / Miembros`), then la tab pasa a decir **"Tareas"**. La ruta URL sigue siendo `/projects/[projectKey]/activities` (no se rompen links viejos ni bookmarks — el rename es cosmético).
- **AC-1.2** — Given abro esa tab, when veo su header, then dice "Tareas" con un CTA "+ Nueva tarea" (hoy dice "+ Nueva actividad").
- **AC-1.3** — Given cargo tiempo desde el diálogo (`<TimeEntryDialog>`), when veo el dropdown que hoy dice "Actividad", then dice **"Tarea"**. El placeholder cambia de "Elegí una actividad" / "Sin actividad" a **"Elegí una tarea" / "Sin tarea"**. Todos los textos de validación asociados ("El proyecto no tiene actividades activas") pasan a decir tarea/tareas.
- **AC-1.4** — Given veo el detalle de un ticket con horas cargadas, when veo la columna que resume la fila, then donde antes decía "actividad" o "Actividad" ahora dice "tarea" / "Tarea". Idem para la sección "Horas cargadas" del reporte de sprint de `018`.
- **AC-1.5** — Given navego a `/reports/consumo` o `/reports/plan-vs-real`, when veo columnas o filtros que aluden a "actividad", then pasan a "tarea". Si algún reporte no muestra la actividad hoy, no hace falta sumarla — el alcance del rename es _no romper_ las que sí la muestran.
- **AC-1.6** — Given intento acceder por API a un endpoint que hoy incluye `activity` en el shape de request/response, when reviso la especificación del contrato, then **el contrato NO cambia**: los payloads siguen usando `activity_id` / `activity` en los campos JSON. El rename es solo de UI y de labels visibles. Un cliente que se integre por API sigue funcionando idéntico.
- **AC-1.7** — Given corro `grep -ri "actividad" src/components src/app` después del rename, when veo el output, then **cero coincidencias** en labels visibles al usuario (comentarios del código que expliquen "activities es el nombre de la tabla, en UI se dice tarea" **sí** son válidos y se preservan para el próximo lector).

### US-2/3/4/5/6 · Reporte planilla + export XLSX

- **AC-2.1** — Given soy admin o PM y voy a `/reports` (o cualquier sub-reporte con filtros aplicados), when miro el bloque de export, then veo **dos botones**: "Exportar CSV" (existente, sin cambios en el binario que baja) y **"Exportar XLSX"** (nuevo).
- **AC-2.2** — Given clickeo "Exportar XLSX" con filtros aplicados (rango obligatorio, cliente/proyecto/usuario opcionales), when el server responde, then baja un archivo `.xlsx` con nombre `planilla-<from>-a-<to>.xlsx`, un solo sheet ("Planilla" o "Horas"), con la primera fila como encabezado y una fila por `time_entry` ordenadas por fecha de inicio ascendente.
- **AC-2.3** — Las **columnas del reporte** (mismo orden en CSV y XLSX) son:

  | # | Columna | Fuente | Formato XLSX |
  | :-- | :--- | :--- | :--- |
  | 1 | Cliente | `time_entries.project.client.name` | texto |
  | 2 | Proyecto | `time_entries.project.name` | texto |
  | 3 | Usuario | `time_entries.user.full_name` | texto |
  | 4 | Tarea | `time_entries.activity.name` (o vacío si null) | texto |
  | 5 | Fecha inicio | `logged_at` + `start_time` compuestos | `dd/mm/yyyy hh:mm` |
  | 6 | Fecha fin | `fecha inicio + minutes` | `dd/mm/yyyy hh:mm` |
  | 7 | Zona horaria | `America/Argentina/Buenos_Aires` (fija en el MVP) | texto |
  | 8 | Duración | `minutes` formateado como `HH:MM` | texto |
  | 9 | Horas | `minutes / 60` con dos decimales | número |
  | 10 | Notas | `description` (o vacío) | texto |
  | 11 | Ticket | `PROJ-N` con hyperlink a `<baseUrl>/tickets/<key>` (o vacío si null) | hyperlink |

  El CSV emite los mismos campos con los mismos nombres de columna, pero **sin formatos de celda** (todo string). El hyperlink de Ticket en CSV cae a solo `PROJ-N` sin URL — el CSV no soporta hyperlinks.

- **AC-2.4** — Given `time_entries.start_time` es null para una entry vieja (la columna se agregó en el rediseño reciente de `016`), when se emite "Fecha inicio" en el reporte, then usa `logged_at` a las `00:00` como fallback. "Fecha fin" en ese caso queda `logged_at + minutes` a las `00:00 + minutes`. Es aceptable — es data legacy y el filtro por rango la sigue capturando.
- **AC-2.5** — El endpoint del XLSX es `GET /api/time-entries/export.xlsx` con la **misma query string** que `export.csv` (los mismos filtros vía `exportQuerySchema`). Mismos permisos: solo admin o PM. Un contributor / developer / staff recibe 403 (idéntico al CSV).
- **AC-2.6** — El header `Content-Type` es `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` y `Content-Disposition: attachment; filename="planilla-<from>-a-<to>.xlsx"`. El binario abre en Excel, Google Sheets, Numbers y LibreOffice sin advertencias.
- **AC-2.7** — Given el rango filtrado tiene ≥ 5.000 entries, when se genera el XLSX, then la request no debe tirar timeout (Vercel serverless default: 10s free / 60s pro). El pipeline se elige mirando el volumen esperado — hoy la base tiene ~500 entries totales, el techo del rango de un mes es del orden de 1.000, y el peor caso posible con un año entero es del orden de 12.000 (proyectando a un equipo de 15 personas × 100 entries/mes). Con `exceljs` streaming o con `xlsx-populate`/`write-excel-file` el tiempo debería estar debajo de 3s para 12k filas. Si el timeout se acerca, se reduce en el plan (limit de 10.000 filas o streaming a un `WritableStream` de Response).
- **AC-2.8** — Given el reporte se descarga con celdas de fecha, when se abre en Excel, then las celdas están **tipadas como fecha** (`Cell.numFmt = 'dd/mm/yyyy hh:mm'`) — no strings. Idem para la columna "Horas" (tipo número con dos decimales).

### US-6 · Consistencia UI/export

- **AC-6.1** — Given un `project_activities.name` es "Development / Frontend" (con caracteres especiales), when aparece en la UI, en el CSV y en el XLSX, then los tres muestran el mismo string tal cual — sin escape visible en el usuario final, con escape sintáctico solo donde el formato lo requiere (CSV: comillas dobles envolviendo; XLSX: nada).
- **AC-6.2** — Given un `time_entry` tiene `activity_id = null` (entrada válida: se cargó tiempo contra un proyecto sin tarea asociada), when se emite en cualquiera de los dos exports, then la columna "Tarea" queda vacía. En XLSX la celda es `null` (no la string `"null"`).

---

## 5. Alcance

**Dentro:**

- **Rename UI.** Todos los archivos que muestran labels o strings con "actividad"/"actividades" en la UI (arriba de ~10 lugares — la tab del workspace, `<TimeEntryDialog>`, `<TicketTimeEntries>`, `<TimeEntryCard>`, títulos de reportes, headers de export). Los identificadores de código (`activityId`, `activity_id`, `project_activities`, `ActivityForm`, `useActivities`) **se conservan** — cambiar los nombres del código es un refactor puro sin valor para el usuario.
- **Extensión del CSV existente.** El endpoint `GET /api/time-entries/export.csv` se refactorea para producir las 11 columnas del reporte planilla en el orden y con los nombres de AC-2.3. Los headers del CSV **cambian** — es un breaking change chiquito del formato (pero es un export de texto, no un contrato de API con clientes externos; y no hay reportes automatizados que dependan del formato viejo — se confirma con el usuario).
- **Nuevo endpoint XLSX.** `GET /api/time-entries/export.xlsx` con la misma query y schema de filtros, escribiendo un `.xlsx` con formatos de celda de fecha y número.
- **Nuevo botón UI.** El bloque de export en `/reports` gana un dropdown o dos botones separados (CSV / XLSX). Reutiliza el mismo componente de filtros — sin duplicar UI.
- **Test unit** del serializer XLSX (dado un fixture de 3 entries, el archivo generado tiene los headers correctos, las celdas están tipadas, los formatos numéricos coinciden). El test se apoya en la librería que se elija (`exceljs` lee y valida `.xlsx` en Node sin depender de instalación externa).
- **Test unit** del rename: un test simple busca strings "actividad" / "Actividad" en `src/components/**` y `src/app/**` tras el rename y falla si encuentra alguno fuera de comentarios explicativos. Es un guardrail contra regresiones.

**Fuera:**

- **Rename de identificadores de código.** `activity_id`, `activityId`, `project_activities`, `useActivities`, etc. se mantienen. La razón es la misma que arrastra desde `016` con `bookings` (booking vs. reserva): en el código va el nombre del schema (inglés); en el producto va el nombre del negocio (español). Un ADR ya existe para justificarlo (ver `docs/adr/0002-language-conventions.md`).
- **Rename de la tabla `project_activities`.** No se toca. Zero migration; toda la RLS, triggers y consultas siguen igual.
- **Concepto de "Servicio" global.** El Excel de origen tiene una columna "Servicio" (Development / Analysis / Meeting / Training / Management, 46% de filas) que categoriza el trabajo cross-project. El equipo comercial confirmó que no es prioritario hoy. Pensado a futuro (ver §9).
- **Facturación (Facturable, Facturado, Precio, Costo, Total, Moneda).** No entran. No se persisten. No aparecen en el export. Toda la lógica de billing queda afuera del sistema en el MVP.
- **Zona horaria multi-usuario.** El reporte fija `America/Argentina/Buenos_Aires` — todos los usuarios del equipo trabajan en esa TZ. Si en algún momento entra alguien en otra TZ, se resuelve como Q-P1 (ver §6).
- **Columnas huecas del Excel de referencia** — `Lista de tareas`, `Fecha de entrega`, `Horas estimadas` (las de time, no las del ticket), `Archivado`, `Status (campo del evento)`, `Hiring Date (campo de usuario)`. Ninguna se llena en el Excel de origen; ninguna entra en el nuestro.
- **Página nueva de reporte planilla.** Solo export directo (botones en `/reports`). No hay una tabla en pantalla que muestre las mismas columnas — para eso siguen los reportes agregados de `016`.
- **XLSX del reporte de sprint (`018`).** El reporte de sprint es una vista en HTML con snapshot inmutable en `sprints.report jsonb`. Convertirlo a XLSX es otra feature; hoy queda como está.

---

## 6. Preguntas abiertas

- **Q-1 · Librería XLSX.** **Abierta.** Opciones:
  - **`exceljs`** — la más estándar en Node, streaming, cell formats completos, ~500 KB. Se usa en producción en toneladas de proyectos.
  - **`xlsx-populate`** — más moderna, tiene issues activos y menos features de streaming; ~200 KB.
  - **`write-excel-file`** (node) — API declarativa, ligera (~100 KB), pero requiere que el schema se defina de antemano. Con nuestros ~10 campos fijos alcanza sobrado.

  **Preferencia inicial: `exceljs`.** Es la más segura para el volumen esperado; el bundle no importa porque corre server-side. Volver atrás a otra si el bundle server crece demasiado es factible — el serializer va a estar en un solo archivo (`src/lib/reports/xlsx.ts`).

- **Q-2 · Nombre y ubicación del botón.** **Abierta.** Preferencia inicial: extender el componente `<ReportFiltersBar>` existente (`src/components/reports/report-filters-bar.tsx`) con un dropdown "Exportar ▾" que ofrece CSV y XLSX. Un segundo botón separado también funciona, pero un dropdown lee más limpio y escala si se suman formatos.

- **Q-3 · Nombres de columna en el CSV existente.** **Abierta con impacto.** El CSV actual usa `fecha, user_email, user_nombre, cliente, proyecto, ticket_key, ticket_titulo, actividad, minutos, horas, descripcion, cargado_por`. La spec propone reemplazar por `Cliente, Proyecto, Usuario, Tarea, Fecha inicio, Fecha fin, Zona horaria, Duración, Horas, Notas, Ticket` (11 columnas, sin `user_email`, sin `ticket_titulo`, sin `cargado_por`). Es un breaking change para cualquier consumidor del CSV que espere el shape viejo.

  **Preferencia inicial: sí, hacer el breaking change.** No hay consumidores automatizados conocidos (solo apertura manual en Google Sheets). Sumar un flag `?legacy=1` para compatibilidad es sobreingeniería para un uso interno de un equipo chico.

- **Q-4 · Hyperlink en la columna Ticket del XLSX.** **Abierta.** Preferencia inicial: **sí**, sumar hyperlink al `/tickets/<key>` para que el archivo abierto en Excel/Sheets sea navegable. La URL base sale de `NEXT_PUBLIC_SITE_URL` (ya definida). Sin variable, cae a texto plano.

- **Q-5 · `zona horaria` como columna fija.** **Abierta.** Preferencia inicial: **sí, columna fija con valor "America/Argentina/Buenos_Aires"** en cada fila. Redundante pero fiel al reporte de origen. Si en algún momento el equipo se distribuye, la columna ya existe y se puede alimentar por `user.timezone` (que hoy no existe).

- **Q-6 · Columnas del reporte de sprint.** **Abierta.** El reporte de sprint de `018` muestra "Horas cargadas" con corte por persona/tarea. Con el rename Actividades → Tareas, ¿se sacan campos que aludan a "actividad" en el snapshot histórico ya guardado? **Preferencia inicial: no**. El snapshot es inmutable — su clave interna sigue siendo `activity_name` en el JSON. La vista lo muestra como "Tarea". Al abrir un sprint viejo cerrado el usuario ve "Tarea: Development" — no importa que la fecha del cierre haya sido antes del rename.

- **Q-7 · Testing del rename UI.** **Abierta.** Un unit test que grep-ea "actividad" en `src/components/**` como guardrail está bien para catch regresiones pero es frágil (falsos positivos por comentarios en español que expliquen el modelo). **Preferencia inicial:** un test así **con lista de exclusión** por archivo (los archivos donde "actividad" aparece solo en comentarios se ignoran explícitamente). Es scrappy pero suficiente.

---

## 7. Riesgos

- **R-1 · Rename incompleto** — Se olvida una cadena "actividad" perdida en un `<span>` o en un `alert()`. El usuario ve mezclas del tipo "Elegí una tarea (actividad requerida)". **Mitigación:** el test-guardrail de AC-1.7 (`grep -ri "actividad" src/components src/app` — sin coincidencias fuera de comentarios permitidos). Correr como parte de la suite de tests, no como una tarea manual.
- **R-2 · Break de consumidores del CSV** — Si alguien tiene un script/planilla que consume el CSV con los nombres viejos, se rompe. **Mitigación:** Q-3 abierta. Confirmar con el user que no hay consumidores externos antes de hacer el cambio. Si aparecen, sumar `?legacy=1` — o versionar el endpoint (`export.v2.csv`).
- **R-3 · Timeout del XLSX en rangos grandes** — Un rango de un año con volumen actual (~500 entries) es trivial. Con un equipo mayor, podría escalar. **Mitigación:** AC-2.7 sugiere `exceljs` con streaming; si aparece el timeout, cap del rango a un año o streaming a `WritableStream`. Si Vercel devuelve 504, se anota como F.
- **R-4 · Formato de fecha malinterpretado por Excel** — Excel es históricamente hostil con `dd/mm/yyyy` vs. `mm/dd/yyyy` según locale del usuario. Emitir la fecha como número serializable de Excel (Date object serializado, no string) evita ese caso — `exceljs` lo hace nativo. **Mitigación:** cell.value = new Date(...), cell.numFmt = 'dd/mm/yyyy hh:mm'. Al abrir en Google Sheets tam funciona igual.
- **R-5 · `start_time` vacía en entries viejas** — El fallback a `logged_at 00:00` puede ser confuso si alguien filtra el reporte por hora del día. **Mitigación:** aceptado, documentado en AC-2.4. Es una limitación heredada de que la columna `start_time` se sumó tarde a `016`. Los entries de antes del rediseño quedan con "hora indeterminada", que es lo que había hasta ahora.
- **R-6 · Copywriting inconsistente entre vistas** — El rename toca ~10 archivos. Es fácil que uno diga "Tareas" en plural y otro "Tarea", o mezclar mayúsculas ("tarea" vs. "Tarea"). **Mitigación:** un pass de review dedicado al copywriting antes de mergear. Idealmente comparar contra la planilla de referencia caso por caso.
- **R-7 · Confusión con "Tarea" vs "Ticket"** — En español, "tarea" puede sonar como "ticket". El usuario puede confundirse entre la "tarea de time tracking" (categoría) y el "ticket del backlog". **Mitigación:** aceptado, es un riesgo de vocabulario ya presente en el reporte de origen. El sistema separa las dos entidades bien (Ticket = `tickets`, Tarea = `project_activities`), y el usuario final se acostumbra rápido — es la misma convención de la herramienta anterior.
- **R-8 · Fase 2 "Servicios" cambia el reporte** — Cuando se sume el concepto de Servicio global, el reporte va a tener una columna nueva o va a haber que decidir cómo se relaciona con "Tarea". La spec de ese momento resuelve. **Mitigación:** aceptado, no es problema hoy. El orden actual (Cliente, Proyecto, Usuario, Tarea, …) deja lugar para insertar "Servicio" antes de "Tarea" sin reordenar el resto.

---

## 8. Dependencias

- **016-time-tracking** — dueña de `project_activities`, `time_entries`, `/reports`, `GET /api/time-entries/export.csv`, `<TimeEntryDialog>`, `<TicketTimeEntries>`, `<WeeklyGridView>`. **Esta feature no le agrega columnas** — solo cambia labels de UI y refactorea el serializer del CSV + suma uno de XLSX. La tabla `project_activities` no se toca.
- **018-sprints-and-reporting** — dueña del snapshot inmutable en `sprints.report jsonb` que incluye "Horas cargadas". El rename Actividades → Tareas afecta solo la **vista** del reporte, no el snapshot ya persistido (Q-6).
- **019-ticket-rich-editor / 020-ticket-attachments** — no relacionadas. Sin conflicto.

---

## 9. Compatibilidad con features futuras

- **Servicios globales.** Si el equipo comercial decide sumar la columna "Servicio" en el futuro:
  - Nueva tabla `services` con ~10 filas fijas o un enum global.
  - Nueva columna en `time_entries.service_id nullable`.
  - Sumar la columna al reporte en la posición 4 (antes de "Tarea") y a los filtros.
  - Sumar UI para elegir servicio en `<TimeEntryDialog>` — arriba del selector de tarea o al costado.
  - **No es breaking:** las filas viejas quedan con `service_id null` y el reporte las emite con la celda vacía.
- **Ampliación del catálogo de tareas.** El texto libre por proyecto sigue igual. Si en algún momento hay que categorizar tareas (subtareas, etiquetas), es una migration aditiva sin tocar esta feature.
- **XLSX para el reporte de sprint (`018`).** El pipeline `src/lib/reports/xlsx.ts` de esta feature se puede reusar para exportar el snapshot de sprint como XLSX (spec aparte cuando se decida).
- **Timezone del usuario.** Si en algún momento entra alguien en otra TZ, sumar `profiles.timezone text default 'America/Argentina/Buenos_Aires'` y usarlo en el reporte. La columna "Zona horaria" ya existe en el layout — solo cambia el valor.
- **Filtro por tarea en `/reports`.** Hoy los filtros son cliente/proyecto/usuario. Sumar "Tarea" es aditivo: entry en el `<ReportFiltersBar>` y en `exportQuerySchema`. Fuera del scope de esta feature — se agrega si lo piden.
