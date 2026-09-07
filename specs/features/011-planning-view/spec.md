# Spec — Planning view (grilla semanal de carga)

- **ID:** 011-planning-view
- **Estado:** draft
- **Referencias en la spec funcional:** §4 (módulo calendario), §12 (usabilidad)

---

## 1. Objetivo

Sumar al calendario una vista de **planificación semanal** que replica la planilla que el equipo usa hoy fuera de la app: una grilla con **cliente > proyecto > dev** en filas y **días** en columnas, con la suma de horas por celda, pensada para responder de un vistazo "¿tenemos devs ociosos?" y "¿hay alguien sobrecargado?".

---

## 2. Contexto

Hoy el equipo usa una Google Sheet horizontal para planificar la semana: filas agrupadas por cliente y proyecto, una sub-fila por dev, y una celda por día con las horas comprometidas. Es la vista que el PM abre para el paneo rápido, no para editar. Las vistas día / mes / año que dejó `003` son buenas para ver una jornada o navegar un mes, pero ninguna deja ver simultáneamente **varias semanas × varios devs × la carga por día**. Esta feature cierra ese hueco reusando el mismo pipeline de datos y filtros, sin nueva tabla ni policy.

---

## 3. User stories

- **US-1** — Como PM, quiero una grilla de 4 semanas con cliente > proyecto > dev en filas y días en columnas, para tener el mismo paneo visual que la planilla actual sin salir de la app.
- **US-2** — Como PM, quiero que un dev sobrecargado (más de 8 h en un día, sumando todos sus proyectos) se distinga visualmente, para reasignar antes de que el dev se queje o rechace.
- **US-3** — Como PM, quiero ver de un vistazo qué devs tienen días vacíos en la ventana, para asignarles trabajo pendiente.
- **US-4** — Como PM, quiero clickear una celda con horas y ver las reservas concretas que la componen, para pasar del panorama al detalle sin cambiar de vista.

---

## 4. Acceptance criteria

### US-1

- **AC-1.1** — Given un usuario logueado abre `/calendar?view=planning`, when la vista carga, then muestra una grilla de **4 semanas (28 días)** anclada al **lunes de la semana en curso**.
- **AC-1.2** — Filas agrupadas en tres niveles: **cliente > proyecto > dev**. Cada combinación distinta `(cliente, proyecto, dev)` con al menos una reserva `approved` o `pending` en la ventana visible aparece como una fila. Un dev que trabaja en dos proyectos aparece dos veces (una fila por combinación), igual que en la planilla actual.
- **AC-1.3** — La cabecera de columnas muestra el **rango de cada semana** arriba (`10/4 – 14/4`) y el **día** abajo (`L M Mi J V S D` con la fecha).
- **AC-1.4** — Sábados, domingos y feriados argentinos se muestran como columnas grises no interactivas ("día no laborable"), coherente con la leyenda de la planilla actual y con `Q-F` (jornada laboral).
- **AC-1.5** — Cada celda muestra la **suma de horas** approved + pending del dev en ese proyecto ese día. Una celda que contiene al menos una reserva `pending` lleva un **indicador visual** que la diferencia de una celda 100% approved (borde punteado o badge — el estilo exacto lo define `plan.md` según `DESIGN.md`).

### US-2

- **AC-2.1** — Given la suma de horas de un dev en un día (contando **todos** sus proyectos, con o sin filtros aplicados, approved + pending) supera **8 h estrictas**, when se renderiza la vista, then la celda de ese día en cada fila del dev se marca como **sobrecarga**.
- **AC-2.2** — Given una celda sobrecargada, when el usuario la hoverea, then un tooltip lista los proyectos y horas que se están sumando (para que el filtro no engañe la percepción — ver R-2).

### US-3

- **AC-3.1** — Una fila con celdas vacías en toda la ventana visible se muestra igual que las demás — **el vacío es la señal de ociosidad y no se oculta**. La fila existe porque hay al menos una reserva de esa combinación en la ventana; días individuales sin carga quedan en blanco.

### US-4

- **AC-4.1** — Given una celda con horas (approved, pending, o mezcla), when el usuario la clickea, then se abre un popover con **cada reserva concreta**: franja horaria, estado, prioridad del proyecto, y link a la vista día para editar/aprobar/rechazar.
- **AC-4.2** — Given una celda vacía en un día laborable, when el usuario la clickea, then **no pasa nada** — la creación de reservas se hace desde la vista día. Esta vista es de solo lectura para no duplicar el flow de alta.

### Filtros y navegación

- **AC-5.1** — Los **seis filtros** existentes (cliente, proyecto, dev, PM, estado, prioridad) aplican: filas y celdas se filtran. **La detección de sobrecarga sigue mirando todos los proyectos del dev**, aunque estén filtrados fuera (ver AC-2.1).
- **AC-5.2** — Los controles anterior/siguiente mueven la ventana **4 semanas** atrás/adelante. El botón "Hoy" reancla al lunes de esta semana.
- **AC-5.3** — Vista, fecha ancla y filtros persisten en la URL siguiendo la convención de `src/lib/calendar/url.ts`; los defaults no se escriben.

---

## 5. Alcance

### Dentro

- Nueva vista `planning` como cuarto valor del selector actual (`day` / `month` / `year` / `planning`), dentro de `/calendar`.
- Query agregada por `(cliente, proyecto, dev, día)` sobre la ventana visible, reusando la RLS existente.
- Popover con las reservas concretas al clickear una celda.
- Detección visual de **sobrecarga** por dev-día (>8 h) y **ociosidad** (celdas vacías visibles).
- Días no laborables marcados (sábado, domingo, feriados argentinos) — usa el mismo helper que las vistas actuales.
- **Approved vs pending** diferenciados visualmente en la celda.
- Filtros y URL-state reusando la infra de `003`.

### Fuera (explícito)

- **Creación, edición o cancelación de reservas desde esta vista** — para eso está la vista día. Duplicar el flow de alta acá multiplica la superficie de bugs sin resolver un problema del usuario.
- **Drag & drop** de reservas entre días o devs.
- **Tratamiento especial de proyectos "recurrentes"** (agrupación separada o color distinto, como aparece en la planilla actual): hoy no hay campo `is_recurring` en el modelo — si el cliente lo pide, se agrega en Fase 2.
- **Export a CSV / impresión.**
- **Vista de disponibilidad** ("quién está libre esta semana") independiente de proyectos: la señal de ociosidad de AC-3.1 la cubre parcialmente y es suficiente para el MVP.
- **Reservas `displaced`**: aparecen en el popover al clickear una celda (para trazabilidad), pero **no cuentan** para la suma de horas — ya no están comprometidas.
- **Subtotales agregados** por proyecto o cliente en las filas de cabecera: se puede sumar si aparece la necesidad.

---

## 6. Dependencias

- **003-calendar-ui** — reusa la ruta `/calendar`, el selector de vista, los seis filtros y el patrón de URL-state.
- **004-bookings** — fuente de datos.
- **005-approval-flow** — para distinguir `approved` de `pending` en la celda.
- **006-priority-reallocation** — el estado `displaced` existe gracias a esta feature; la vista lo consume pero no lo genera.

**No depende de 007 / 008 / 009 / 010**, así que es paralelizable y no bloquea el gate de deploy que representa `010`.

---

## 7. Preguntas abiertas

- **Q-P1** — ¿La sobrecarga se dispara con **>8 h** estricto o con **≥8 h**? **Recomendación por defecto:** `>8 h` estricto — una jornada completa 09:00–17:00 son 8 h netas y no es sobrecarga; sí lo es una hora extra. **Bloquea:** definición visual en `DESIGN.md`.
- **Q-P2** — Reservas que **cruzan medianoche**: ¿cómo se distribuyen las horas entre días? **Recomendación por defecto:** dividir por día calendario (una reserva 22:00–02:00 cuenta 2 h para el día X y 2 h para el día X+1). No es un caso común dentro de 09–17, pero está permitido (Q-G). **No bloquea** el MVP; se puede pushear al primer ejemplo real.
- **Q-P3** — Proyectos **recurrentes**: la planilla actual los agrupa aparte y los marca en el nombre. ¿Se refleja en la app? **Recomendación por defecto:** **no** en MVP; si el cliente lo pide, se suma un `clients.is_recurring` (o `projects.is_recurring`) y un tratamiento visual en la vista.
- **Q-P4** — ¿Un dev **sin ninguna reserva** en la ventana pero asignado a un proyecto activo debe aparecer como fila vacía? **Recomendación por defecto:** **no** — no hay concepto de "asignación estable de dev a proyecto" en el modelo actual, la relación existe solo a través de reservas. Si el cliente quiere ver todos los proyectos activos con todos sus devs siempre, hace falta una tabla `project_devs` antes.

---

## 8. Métricas de éxito

- **p95 de carga inicial** de la vista con 200 bookings en la ventana < **800 ms** (mismo target que la vista Mes de `003`).
- **Tiempo hasta identificar** un dev sobrecargado o un proyecto sin recursos: **< 5 s** de mirada (cualitativo, se valida al primer uso real con el cliente).
- **Cero regresiones** en las vistas día / mes / año existentes.

---

## 9. Riesgos conocidos

- **R-1** — Con muchos clientes × proyectos × devs, la grilla puede volverse ilegible por scroll vertical. **Mitigación:** los seis filtros existentes acotan filas. Si aparece antes de tiempo, agrupación colapsable por cliente.
- **R-2** — Sobrecarga marcada visualmente puede sorprender si el usuario tiene filtros activos que ocultan los proyectos que la generan. **Mitigación:** AC-2.2 — tooltip que enumera los proyectos sumados en ese día, incluso los que están fuera del filtro.
- **R-3** — La grilla actual (`src/lib/calendar/layout.ts`) está pensada para bloques por hora, no para celdas-día agregadas. **Mitigación:** el cálculo de la matriz vive en un módulo aparte; se comparte el helper de días no laborables y poco más. Se detalla en `plan.md`.
