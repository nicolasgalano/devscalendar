# Plan — Planning view

- **ID:** 011-planning-view
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `003-calendar-ui`, `004-bookings`, `005-approval-flow`, `006-priority-reallocation`

---

## 1. Resumen técnico

**No hay cambios de esquema y no hay endpoint nuevo.** Toda la feature son cuatro cosas:

- Un cuarto valor `planning` en `calendarViewSchema`, con su rango (`viewBounds`) y su `shiftDate` propios.
- Una **matriz** construida en JS a partir de las mismas queries de `query.ts`, agrupando por `(cliente, proyecto, dev, día)`.
- Una **segunda consulta sin filtros de usuario** para detectar sobrecarga por dev-día, análoga a `countConsideredDevs` del denominador de la rampa.
- Un componente React con la grilla, el popover al clickear y la marca de sobrecarga.

Reusa la RLS, el `BOOKING_COLUMNS` completo, los seis filtros de la toolbar, el helper de días no laborables y el URL-state de `003`. Lo único conceptualmente nuevo es que la celda es un **agregado por día** en lugar de un bloque por hora — igual que las vistas Mes y Año, pero con dos ejes en vez de uno.

### Decisiones heredadas que no se re-discuten

- **Solo lectura** (spec §5, Fuera). La creación / edición / cancelación se hacen en la vista día, no acá.
- **`displaced` no cuenta para las horas** (spec §5, Fuera) pero **sí aparece en el popover** — es exactamente el mismo criterio que `DEFAULT_STATUSES` de `003` (que también las muestra por default) y sigue la razón que ya está documentada ahí: obligan al PM a reasignar, y esconderlas es peor que mostrarlas.
- **La ventana ancla al lunes** de la semana de `params.date`, y el `date` en la URL se guarda como ese lunes. Los defaults del URL-state no se escriben (`src/lib/calendar/url.ts`).

---

## 2. Arquitectura

```
src/lib/validation/calendar.ts
  calendarViewSchema     agregar "planning"

src/lib/calendar/
  range.ts               mondayOf(), y las tres ramas nuevas de viewBounds/shiftDate/resolveRange
  planning.ts            buildPlanningMatrix() + computeDevDayLoad() + splitBookingByDay() — puras
  query.ts               getDevDayLoad() — misma forma que getDayLoad, sin filtros de entidad

src/components/calendar/
  planning-view.tsx      la grilla server component
  planning-cell.tsx      celda + popover (client component, porque el popover es interactivo)

src/app/(app)/calendar/page.tsx
  renderPlanning()       tercera rama del switch de vista
```

Cero migrations, cero nuevas policies, cero API routes. Lo confirma la sección "Sin cambios de esquema" arriba y lo repite acá porque es lo primero que un reviewer va a buscar.

---

## 3. Modelo de datos

### 3.1 Sin cambios de esquema

Nada que migrar. La feature vive entera del lado del cliente (Next server components + JS puro), leyendo lo que ya está.

### 3.2 Por qué no hace falta una tabla `project_devs`

La planilla que se está reemplazando tiene filas persistentes por combinación proyecto × dev, aunque estén vacías: alguien las agrega a mano. En el modelo actual **no existe esa relación estable** — el dev se elige en el diálogo de reserva y punto. Se podría inventar una tabla `project_devs` para replicar la planilla al pie de la letra, pero:

1. Es una feature nueva de producto, no un facilitador de esta vista.
2. Cambia el flow de alta (habría que asignar dev al proyecto antes de reservar) y el ABM de `002`.
3. Sin ella, las filas de la matriz son "todas las combinaciones con al menos una reserva en la ventana", que es la definición operativa correcta: **si no hubo reservas, tampoco hubo compromiso**.

Queda anotada como Q-P4 en el spec por si el cliente insiste; por ahora, no se agrega.

---

## 4. La matriz

### 4.1 Estructura

```ts
type PlanningCell = {
  hoursApproved: number;
  hoursPending: number;
  bookingIds: string[]; // populates the popover
};

type PlanningRow = {
  client: { id: string; name: string };
  project: { id: string; name: string; priority: ProjectPriority };
  dev: { id: string; name: string };
  cells: Map<string, PlanningCell>; // key = isoDate
};

function buildPlanningMatrix(
  bookings: CalendarBooking[],   // already filtered by user filters
  days: string[],                 // 28 iso-dates in the visible window
  tz: string,
): PlanningRow[];
```

### 4.2 Reglas de agregación

- **Una fila por combinación** `(client.id, project.id, dev.id)` con al menos una reserva `approved | pending | displaced` en la ventana. Combinaciones sin ninguna reserva no se incluyen (spec §5, Fuera → Q-P4).
- **La celda suma** solo las horas de reservas `approved` y `pending`. Las `displaced` se listan en `bookingIds` para el popover pero **no aportan horas** — esa reserva ya no está comprometida.
- **`hasPending`** es `hoursPending > 0`, y decide el tratamiento visual "hay pendientes en esta celda" (borde punteado, ver §7.2).
- **Filas ordenadas** alfabéticamente por `client.name → project.name → dev.name`. Sin agrupar prioritarios primero: la planilla actual no lo hace y meter un orden distinto acá sorprendería al PM que la mira hoy.

### 4.3 Cross-midnight

Q-P2 del spec, resuelto acá porque no cuesta más: una reserva `22:00–02:00` cuenta como 2 h para el día X y 2 h para el X+1. La partición se hace **en zona local** (`tz`), no en UTC, porque el día calendario es un concepto local.

```ts
function splitBookingByDay(
  booking: CalendarBooking,
  days: string[],
  tz: string,
): Array<{ isoDate: string; minutes: number }>;
```

`range.ts` ya tiene `zonedToInstant` y `minutesOfDay`; esto es aritmética sobre ellos. **Es la misma lógica que el clamp de `visibleDayWindow`**, extraída a una función propia para poder testearla sin renderizar.

### 4.4 Datos para el popover

El popover de una celda recibe la lista de reservas concretas mediante `bookingIds`. La página ya tiene el array completo `bookings` para armar la matriz, así que el popover mapea ids → `CalendarBooking` sin ir de nuevo a la base. Muestra franja horaria, estado, prioridad, y un link a la vista día para editar / aprobar / rechazar (spec AC-4.1).

---

## 5. Sobrecarga: por qué es una segunda consulta

AC-2.1 pide que la sobrecarga cuente **todos** los proyectos del dev, aunque estén filtrados fuera. Si la sacáramos del mismo array `bookings` filtrado por la UI, un PM que filtra por su cliente vería a "sus" devs siempre por debajo de 8h — porque las reservas de otros clientes están fuera de ese array. Ese sería justo el caso que la feature quiere prevenir: un dev sobrecargado que parece libre.

Solución: **una consulta secundaria sin filtros de entidad**, con la misma silueta que `getDayLoad`:

```ts
// src/lib/calendar/query.ts
export type DevDayLoadRow = { devId: string; startsAt: string; endsAt: string };

export async function getDevDayLoad(
  supabase: Client,
  range: CalendarRange,
): Promise<DevDayLoadRow[]>;
```

- Selecciona `dev_id, starts_at, ends_at` de `bookings` con `status in ('approved', 'pending')` que se solapen con `range`.
- **No aplica ningún filtro de entidad** — es exactamente el punto.
- Respeta la RLS, y con la Q-5 cerrada (dev y PM ven el calendario global en modo lectura) eso alcanza para la sumatoria correcta.

```ts
// src/lib/calendar/planning.ts
export function computeDevDayLoad(
  rows: DevDayLoadRow[],
  days: string[],
  tz: string,
): Map<string, number>; // key = `${devId}::${isoDate}`, value = hours
```

La vista consulta este mapa en render y, si `hours > 8` (spec Q-P1: **estricto**, una jornada 09–17 son 8 h netas y no es sobrecarga), marca la celda con el tratamiento de §7.3.

**Volumen:** la ventana son 28 días × ~10 devs activos × ~2 reservas/día = ~560 filas máximo, con tres columnas. El costo es despreciable comparado con la query principal (que trae `BOOKING_COLUMNS` completo).

---

## 6. Datos y query

La página existente hace un `Promise.all` de tres cosas (datos, facets, options); esta rama suma una cuarta:

```ts
async function renderPlanning(): Promise<ViewContent> {
  const [bookings, devDayLoad] = await Promise.all([
    getBookingsInRange(supabase, { range, filters: params.filters }),
    getDevDayLoad(supabase, range),
  ]);

  if (bookings.length === 0) return emptyOrNoResults();

  const days = eachDay(...viewBounds("planning", params.date));
  const matrix = buildPlanningMatrix(bookings, days, TIMEZONE);
  const overload = computeDevDayLoad(devDayLoad, days, TIMEZONE);

  return { state: "data", node: <PlanningView matrix={matrix} overload={overload} days={days} /> };
}
```

**Vale la pena decirlo explícito:** la query principal usa exactamente `getBookingsInRange`, la misma que la vista día. No hay una función nueva `getPlanningBookings()`. Duplicar el shape del select por una vista más lo único que trae es dos lugares para actualizar cuando cambie una columna.

---

## 7. UI

### 7.1 Layout de la grilla

```
┌────────────────────────┬───────────────────────────────────────────────┐
│ Cliente / Proyecto     │  Sem 15 (6-12/4)  Sem 16 (13-19/4)  ...      │  ← cabecera semanal, sticky top
│      Dev               │  L M Mi J V S D   L M Mi J V S D    ...      │  ← cabecera diaria + fecha, sticky top
├────────────────────────┼───────────────────────────────────────────────┤
│ Cliente A              │                                                │
│   Proyecto X           │                                                │
│     Emi                │       6  6  6                                  │
│     Cris               │  4    3  3  3  3                               │
│   Proyecto Y           │                                                │
│     Matias             │                                                │
│ Cliente B              │                                                │
│   Proyecto Z           │                                                │
│     Bruno              │                          4  4  4  4            │
└────────────────────────┴───────────────────────────────────────────────┘
                              ^ scroll horizontal si no entra              ↑ scroll vertical
```

- **Columnas:** 28 (4 semanas × 7 días). Weekends y feriados AR con fondo `--muted`, no interactivos (spec AC-1.4). Aprovecha `isWorkday()` de `workdays.ts`.
- **Ancho de celda:** 40px (compacto). Con 28 columnas más la columna de labels (240px), el ancho total ronda 1360px — cabe en la mayoría de los viewports; con scroll horizontal dentro del panel cuando no.
- **Alto de fila:** 36px, la fila de tabla estándar de `DESIGN.md §5`. Las filas de cabecera (cliente, proyecto) usan la misma altura pero con jerarquía tipográfica: cliente en `text-body` peso 600, proyecto en peso 500 y ligera indentación, dev en `text-body` con el avatar de `DESIGN.md §8`.
- **Cabecera:** dos filas —semana arriba, día abajo— compartiendo el mismo `grid-template-columns` (la misma técnica que la vista día — `DESIGN.md §5`). `position: sticky; top: 0` en un contenedor con `overflow-auto` para que la cabecera acompañe el scroll vertical.
- **Columna izquierda:** `position: sticky; left: 0` en el panel scrolleable, para que las etiquetas cliente / proyecto / dev sigan visibles al scrollear hacia la derecha.

### 7.2 Celda

Cuatro estados visuales, sin colores nuevos —usa los tokens que ya están—:

| Estado | Tratamiento |
| :----- | :---------- |
| Vacía (día laborable) | Fondo transparente, sin borde. |
| Vacía (día no laborable) | Fondo `--muted`, sin número. Coherente con la rampa de `DESIGN.md §8`. |
| Con horas, sin pending | Número centrado en `--foreground`, tipografía de datos (`.font-data`). |
| Con horas, hay pending | Igual que la anterior, más un **borde punteado 1px `--secondary-foreground` interno**. No es color de fondo por la regla de `DESIGN.md §8` ("el color nunca es el único portador de información") — el borde es la seña, y el hover / popover confirma con texto. |

El número es siempre el total `hoursApproved + hoursPending` (spec AC-1.5).

### 7.3 Sobrecarga

Cuando `overload.get(`${devId}::${isoDate}`) > 8`:

- La celda de ese día en cada fila del dev suma un **outline de 1.5px `--danger`** hacia adentro (no fondo, para no chocar con el tratamiento de pending del punto anterior).
- **Hover con `aria-describedby`** apuntando a un tooltip que lista los proyectos y horas que se están sumando ese día (spec AC-2.2). El texto lo arma `describeOverload(devId, isoDate, devDayLoad, projects)` desde los datos ya cargados.
- El outline hereda de `--danger`, no de `--attention`: **8h es la jornada completa; superarla es la sobreasignación** que la rampa de `DESIGN.md §8` ya define como `--danger-bg`. Coherencia con lo que el PM ya sabe leer.

### 7.4 Popover

Al clickear una celda con horas (spec AC-4.1):

- Popover ancla en la celda, 240px de ancho, radio 6px (`DESIGN.md §5`).
- Header: nombre del dev, proyecto, y fecha absoluta (`vie 10/4`).
- Lista de reservas: franja horaria (`09:00–13:00`), estado (icono + label de `booking-status`), prioridad si es prioritario (badge de `DESIGN.md §8`).
- Footer: link a la vista día de esa fecha, con los filtros preservados vía `calendarHref(params, { view: "day", date: isoDate })`.

Celda vacía: **no hace nada al click** (spec AC-4.2). Sin cursor pointer, para que el affordance sea correcto.

### 7.5 Estados de datos

Los cuatro de `DESIGN.md §9`:

- **Cargando:** `loading.tsx` de `/calendar` ya cubre la vista actual. La grilla de planning renderiza `TableSkeleton` con la forma de las primeras N filas mientras carga.
- **Vacío:** `bookings.length === 0` sin filtros → `EmptyState` con `CreateBookingButton`, igual que las otras vistas (`page.tsx` ya lo hace en `emptyOrNoResults()`).
- **Sin resultados:** con filtros → `NoResultsState` que nombra los filtros aplicados. Reusa `describeFilters()` ya existente.
- **Error:** el error boundary de `src/app/(app)/error.tsx` la absorbe.

---

## 8. Navegación y URL-state

### 8.1 El cuarto valor de la vista

```ts
// src/lib/validation/calendar.ts
export const calendarViewSchema = z.enum(["year", "month", "day", "planning"]);
```

`DEFAULT_VIEW` sigue siendo `month`, así que abrir `/calendar` sin `?view=` no cambia. El param `view=planning` se escribe en la URL como cualquier otro no-default (mismas reglas de `calendarHref`).

### 8.2 Ancla en el lunes

```ts
// src/lib/calendar/range.ts
export function mondayOf(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0=dom, 1=lun, ...
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(isoDate, offset);
}
```

- `viewBounds("planning", isoDate) → [mondayOf(isoDate), addDays(mondayOf(isoDate), 28)]`
- `shiftDate("planning", isoDate, steps) → addDays(mondayOf(isoDate), steps * 28)`

La URL almacena `date=YYYY-MM-DD` sin normalizar al lunes; la normalización ocurre al calcular el rango, no al escribir la URL. Eso preserva la propiedad de que un usuario pueda pasar `?view=planning&date=2026-05-14` (miércoles) y ver la semana que lo contiene, sin que el router reescriba la URL en cada carga.

### 8.3 Toolbar

`CalendarToolbar` (de `003`) ya renderiza el selector de vista y los botones anterior / hoy / siguiente. Se le agrega un ítem `"Planificación"` al selector; los botones ya llaman a `shiftDate(params.view, ...)`, así que **funcionan solos** en cuanto `viewBounds` y `shiftDate` conozcan `planning`. Es el mismo patrón por el que `year` fue barato de sumar.

El botón "Hoy" reancla a `today` (que es la fecha de hoy en `TIMEZONE`); `mondayOf(today)` sale del cálculo del rango.

---

## 9. Dependencias entre features

- **`003-calendar-ui`** — la ruta, el toolbar, los filtros, el URL-state, el helper de días no laborables, y el patrón de `CalendarBooking` que la query devuelve. Toda la infra reusable vive ahí.
- **`004-bookings`** — fuente de datos. Sin cambios; el fetch usa `getBookingsInRange` tal cual.
- **`005-approval-flow`** — para poder distinguir `approved` de `pending` en la celda y en el popover.
- **`006-priority-reallocation`** — `displaced` existe. La feature no lo genera pero lo tiene que mostrar en el popover (y no contarlo en las horas).
- **No depende de `010`** — la vista es de solo lectura, no dispara notificaciones ni escribe en `audit_log`.

---

## 10. Riesgos y mitigaciones

**R-1 — La sobrecarga engaña al filtrar.** Sin la query separada de §5, un PM que filtra por su cliente ve todos los devs "libres" y toma decisiones equivocadas. **Mitigación:** la query es aparte por diseño, y el tooltip de AC-2.2 nombra los proyectos que están sumando, aunque estén fuera del filtro. Si el tooltip se rompe o no se implementa, el número que se ve deja de ser explicable — es la razón por la que AC-2.2 no es opcional.

**R-2 — La grilla se vuelve ilegible con muchas filas.** Un PM sin filtros con un equipo grande puede ver 40+ filas. **Mitigación:** los seis filtros existentes acotan. Si aparece antes de tiempo, el próximo paso es **agrupación colapsable por cliente** (guarda estado en URL como `collapsed=clientA,clientB`), no reordenar. Anotado en `tasks.md` como follow-up F1.

**R-3 — El `mondayOf` con timezone equivocada corre el ancla un día.** El bug clásico: pedir `getUTCDay` sobre un `Date` construido en la zona local desplaza la semana en zonas con offset negativo. **Mitigación:** la función acepta un `isoDate` (string `YYYY-MM-DD` ya en local), lo interpreta como `Z` y opera en UTC — mismo patrón que `isWeekend` en `workdays.ts`, que ya justifica por qué. Tests unitarios sobre `mondayOf` con casos de lunes, domingo, y cambio de mes.

**R-4 — Cross-midnight mal contabilizado.** Una reserva `23:00–01:00` que se cuenta entera al día del `starts_at` produce sumas que no cierran con la vista día. **Mitigación:** `splitBookingByDay` implementado desde el principio (§4.3), con tests que ejercitan el cruce y el caso DST. No es un caso común, pero está permitido (Q-G) y no cuesta.

**R-5 — La segunda query descoordina con la principal.** Si el usuario filtra por `status=[approved]`, la matriz cuenta solo approved pero la sobrecarga incluye pending. Al pasar el mouse sobre una celda "sobrecargada" el tooltip lista horas de pending que la celda no mostraba, y el PM se confusa. **Mitigación:** el tooltip nombra explícitamente el estado (`4 h aprobadas · 3 h pendientes en Proyecto Y`), así que las dos cifras se pueden reconciliar leyendo. No hay forma limpia de evitar la asimetría sin apagar el filtro de estado — que sería peor.

---

## 11. Alternativas consideradas

- **Ruta propia (`/planning`).** Duplica el shell, la toolbar, el manejo de filtros y el URL-state. Un cuarto valor del selector es la extensión natural del diseño de `003`. Descartada.
- **Una tabla `project_devs` que persista asignaciones estables.** Ver §3.2. Es una feature nueva de producto, no un facilitador.
- **Precalcular la matriz en Postgres con una función.** Con el volumen del MVP (200–500 reservas/mes) es sobreingeniería, y **acopla la vista al esquema** justo cuando la respuesta a Q-10 (timezones) podría cambiar la definición de "día". Con la matriz en JS, cambiar Q-10 toca `range.ts` y nada más.
- **Query única para matriz y sobrecarga.** Se descartó por §5: mezclar "lo filtrado por el usuario" con "lo real para calcular sobrecarga" en un solo fetch obliga a duplicar filas (una para cada semántica), que es más caro y más confuso que dos queries.
- **Ocultar weekends y feriados por completo.** La planilla actual no los muestra, pero la vista Mes de `003` sí los muestra con `--muted` y esa consistencia importa: si acá los ocultamos, un PM que ve un booking de sábado en la vista Mes lo pierde al pasar a Planning. Muted y no interactivas es la solución honesta.

---

## 12. Testing strategy

- **Unit** — `buildPlanningMatrix` sobre fixtures con reservas approved/pending/displaced, incluidos días compartidos y reservas cross-midnight; verifica orden, `hasPending`, exclusión de horas de `displaced`, y presencia en `bookingIds`. `computeDevDayLoad` sobre fixtures de sobrecarga: 8h exacto (no marca), 9h (marca), 16h en dos proyectos (marca con las dos contribuciones). `mondayOf` sobre lunes / domingo / cambio de mes / cambio de año.
- **Unit** — `splitBookingByDay` con `22:00–02:00`, `23:00–08:00`, y una reserva que abarca tres días. Y un caso DST (los tres domingos por año que aplican en Argentina — hoy no aplica, pero el código no puede depender de eso).
- **Integración** — que la query filtrada y la de sobrecarga devuelvan lo mismo cuando no hay filtros aplicados (excepto por el column set). Que la sobrecarga cuente reservas de un PM ajeno cuando el usuario es admin/PM/dev (por RLS de Q-5).
- **E2E** — abrir `/calendar?view=planning`, verificar que se ven 4 semanas ancladas al lunes, que el filtro de cliente esconde filas pero **el tooltip de sobrecarga sigue nombrando el proyecto oculto** (esta es la aserción crítica de R-1), que un click en celda con horas abre el popover con las reservas concretas y que el link va a la vista día correcta con los filtros preservados.
- **E2E** — semana con feriado en el medio: la columna se ve muted y no interactiva; si hay una reserva que cae ese día (Q-G), la celda muestra las horas igual, pero sobre fondo muted.

Los tests de integración y E2E, como siempre, corren en CI contra el stack efímero. Los unit son los únicos que corren local (ver `docs/testing.md`).

---

## 13. Rollout

Sin migration, sin cambios de policy, sin route handler nuevo. **El deploy es un merge a `main`** y punto — Vercel builds and serves. No hay `pnpm db:push` que hacer.

La feature se pone atrás de un feature flag ambiental (`NEXT_PUBLIC_ENABLE_PLANNING_VIEW`) solo si el equipo la quiere estrenar internamente antes de que aparezca en el selector para todos. **Recomendación:** salir directo, sin flag. Es de solo lectura, la peor consecuencia de un bug es que la grilla se vea rara, no que se pierda una reserva.

Un detalle: **con datos reales cargados**, la vista es útil recién cuando hay 3–4 semanas de historial. Antes de eso las columnas están en blanco por buenas razones y el "empty state" es lo que se ve. Nada que hacer al respecto — es la naturaleza de una vista de planificación en un producto que arranca.
