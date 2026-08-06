# Plan — Calendar UI (day/month/year + grouping + filters)

- **ID:** 003-calendar-ui
- **Estado:** ready-to-implement
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

Pantalla principal del producto: tres vistas de calendario (año / mes / día), dos modos de agrupación (por desarrollador / por proyecto) y seis filtros combinables, todo sobre una grilla propia construida con CSS grid. El estado de la vista (vista, fecha, agrupación, filtros) vive en la URL, así que la persistencia de filtros al navegar (AC-4.1) es una propiedad del diseño, no una feature aparte.

Esta feature es **solo lectura**: no crea, edita ni mueve reservas. Eso es `004-bookings`.

Dos decisiones estructurales que el plan toma y conviene leer antes que nada: la tabla `bookings` nace acá (§3.1) y el calendario es propio, no una librería (§9).

---

## 2. Arquitectura

```
URL (?view&date&group&client&project&dev&pm&status&priority)
        ↓
[calendar/page.tsx — Server Component]
        ↓ resolveRange(view, date, tz) → {from, to}
[lib/calendar/query.ts] → supabase select con embed !inner sobre projects/clients
        ↓
[YearView | MonthView | DayView]  ← funciones puras de layout (lib/calendar/*)
        ↓
[BookingBlock]  color categórico + texto + estado
```

- **Sin route handlers.** En `002` la regla fue "todo por route handlers para poder testear con Vitest", pero esa regla existe para las **escrituras**. Acá no hay ninguna: los datos se leen en Server Components y los filtros se aplican navegando a otra URL, que es un `GET` que Next.js ya sabe manejar. Lo que en `002` cubrían los tests de API, acá lo cubren tests de integración contra el query layer y tests unitarios sobre las funciones puras de layout.
- **Client Components solo donde hay interacción:** la barra de herramientas (cambio de vista, navegación, agrupación) y el panel de filtros. Ambos escriben en la URL con `router.replace` + `useTransition`; el resto del árbol es server.
- **Carga por rango** (requisito no funcional §12 de la spec funcional): cada vista pide exactamente su ventana de fechas, nunca la base entera.

---

## 3. Modelo de datos

### 3.1 Decisión: `bookings` se crea en esta feature

La spec de `003` pide renderizar bloques posicionados por hora (AC-2.1), solapamientos en paralelo (AC-2.2) y distinción visual de prioritarios (AC-2.3). Nada de eso se puede construir ni testear sin la tabla. Las opciones eran datos mockeados o crear la tabla acá; se elige lo segundo, con un corte claro:

| Qué | Feature |
| :---- | :---- |
| Tabla `bookings`, RLS de **lectura**, índices de rango, seed | **003** |
| Policies de escritura, API de CRUD, constraint anti doble-booking, máquina de estados | **004** |

En `003` la tabla es de solo lectura para todo el mundo: no hay policy de `insert`/`update`/`delete`, así que ni un admin puede escribirla desde la app. Los datos de desarrollo y de tests entran por `service_role` (seed y helpers de test). Es una propiedad linda de tener: el camino de lectura queda probado antes de que exista un solo `POST`.

**Consecuencia para `004`:** su plan arranca con la tabla ya creada y su primera migration es el `exclusion constraint` anti doble-booking más las policies de escritura. Hay que reflejarlo en su spec cuando se planifique.

### 3.2 Tabla nueva

```sql
-- bookings
id uuid primary key default gen_random_uuid()
project_id uuid not null references projects(id) on delete restrict   -- dura
dev_id uuid not null references profiles(id) on delete restrict       -- dura
created_by uuid references profiles(id) on delete set null            -- blanda: el PM creador
starts_at timestamptz not null
ends_at timestamptz not null
status text not null default 'pending'
  check (status in ('pending','approved','rejected','cancelled','displaced'))
note text
ticket_ref text                    -- lo completan 008/009; nullable a propósito
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
check (ends_at > starts_at)
```

- `on delete` explícito en las tres FKs, según la convención de `CLAUDE.md`: la reserva **necesita** su proyecto y su desarrollador (`restrict` — el camino es desactivar, no borrar), pero sobrevive a la baja del PM que la creó (`set null`).
- `status` como `check` y no como enum, por la misma razón que `projects.priority` en `002` §9: los cinco estados de la spec funcional §5.2 todavía pueden moverse (Q-6 sigue abierta) y migrar un `check` es barato.
- **Sin `priority` propia.** La spec funcional §10 menciona "prioridad heredada" en la reserva; se resuelve por join con `projects.priority` en vez de denormalizar. Copiarla obligaría a mantenerla sincronizada cuando cambia la del proyecto, que es exactamente el evento que `002` ya audita. Si el rendimiento lo pide, se denormaliza en `006`, que es quien la escribe.
- **Reservas intra-día.** El MVP asume que una reserva empieza y termina el mismo día (spec funcional §5.1: fecha + franja). No se agrega constraint de DB porque "el mismo día" depende de la timezone (Q-10, §12); lo valida el formulario de `004` y la vista Día recorta lo que se pase.

### 3.3 RLS

- `select` para todo `authenticated` — es el default de Q-5 (el desarrollador ve el calendario global en modo lectura), recomendado por la spec funcional §11.
- **Ninguna policy de escritura** (§3.1). Es un test explícito, no un olvido.
- Grants: `select` a `authenticated`; `select, insert, update, delete` a `service_role` (seed y fixtures de test). Sin grant la policy deniega en silencio — la lección de `001`.

### 3.4 Cambio a la RLS de `profiles` (no previsto en la planificación)

El calendario muestra el nombre del desarrollador en cada bloque, para cualquier viewer (spec funcional §4.2). La RLS de `001` permitía leer **el propio perfil, o todos si sos admin**: alcanzaba mientras `/admin/users` era la única pantalla que listaba gente, pero con esa policy un PM recibe el embed en `null` y los bloques quedan sin nombre.

Se agrega una policy en `00000000000005_profiles_team_directory.sql`:

```sql
create policy "profiles: team directory read"
  on public.profiles for select to authenticated
  using (role is not null);
```

El corte es `role is not null`: los usuarios en `pending-access` siguen siendo invisibles para todos salvo ellos mismos y los admins, así que el test de `001` que verifica que un usuario no lee el perfil de otro **sigue pasando sin tocarlo** (sus usuarios de prueba no tienen rol). Amplía lo que ve un no-admin: nombre, email y rol de sus compañeros. En una herramienta interna donde todos ven quién está reservado en qué, es el nivel de visibilidad buscado — la misma decisión que Q-5.

### 3.5 Índices

- `bookings (dev_id, starts_at)` — vista Día agrupada por desarrollador.
- `bookings (project_id, starts_at)` — agrupada por proyecto y filtro por proyecto.
- `bookings (starts_at)` — barrido por rango de las vistas Mes y Año.

El índice GiST sobre `tstzrange(starts_at, ends_at)` va con el `exclusion constraint` de `004`; acá no hace falta y no se adelanta.

---

## 4. Estado en la URL

Una sola fuente de verdad para toda la pantalla:

```
/calendar?view=day&date=2026-08-05&group=dev
         &client=<uuid>&project=<uuid>&dev=<uuid>&pm=<uuid>
         &status=pending,approved&priority=high
```

| Param | Valores | Default |
| :---- | :---- | :---- |
| `view` | `year` \| `month` \| `day` | `month` |
| `date` | `YYYY-MM-DD` (ancla del rango) | hoy |
| `group` | `dev` \| `project` | `dev` |
| `client`, `project`, `dev`, `pm` | uuid | sin filtro |
| `status` | lista separada por coma de los 5 estados | `pending,approved,displaced` |
| `priority` | `high` \| `normal` | sin filtro |

Consecuencias: AC-1.3 y AC-4.1 (no perder filtros al navegar) salen gratis porque cada control de navegación es un link que conserva el resto de los params; la vista es compartible por link y el botón "atrás" del navegador funciona como se espera. Todo se parsea con un schema Zod en `lib/validation/calendar.ts`, que además normaliza basura en la query string a los defaults en vez de romper.

El default de `status` excluye `cancelled` y `rejected`: son estados terminales que ensucian la grilla. El filtro los muestra cuando alguien los pide.

---

## 5. Query layer

Un solo módulo, `src/lib/calendar/query.ts`, con una función por caso:

```ts
getBookingsInRange(supabase, { from, to, filters })  // Día y Mes
getDayLoad(supabase, { from, to, filters })          // agregado para Mes y Año
```

- El overlap de rango es `starts_at < to and ends_at > from` (no `between`: una reserva que arranca antes del rango pero lo cruza tiene que aparecer).
- Los filtros por cliente, PM y prioridad viven en `projects`, así que se resuelven con embed inner de PostgREST: `select(..., projects!inner(id, name, priority, client_id, pm_id, clients!inner(id, name)))` y `.eq("projects.client_id", ...)`. RLS de `projects` y `clients` sigue aplicando sobre el embed.
- `getDayLoad` agrega **en el servidor Node, no en Postgres**: trae las columnas mínimas del rango y suma minutos por día en JS. Para los volúmenes objetivo (spec §8: 200 reservas en un mes, 500 en tres meses) es intrascendente, y evita comprometerse a una semántica de "día" en SQL antes de que Q-10 (timezone) esté respondida. Si el volumen crece, se reemplaza por una vista con `security_invoker` o un RPC sin tocar los componentes — está aislado detrás de estas dos funciones. Queda anotado como R-5.

---

## 6. Sistema de diseño del calendario

`DESIGN.md` §2 y §5 dejan explícitamente pendientes tres cosas "a definir en `003-calendar-ui`". Se definen acá y se escriben en `globals.css` como tokens; ningún componente inventa un hex (§3 de `DESIGN.md`).

### 6.1 Paleta categórica

Ocho hues, usados **solo dentro de la grilla** y bajo las tres condiciones de `DESIGN.md` §2. Dos tokens por categoría: `--cat-N-surface` (relleno del bloque) y `--cat-N-line` (borde izquierdo de 2px). El texto del bloque siempre es `--foreground`, nunca un color derivado del hue: así el contraste AA se valida una vez contra ocho superficies y no contra dieciséis combinaciones.

**Regla dura de selección:** la paleta categórica **excluye ámbar, naranja y rojo**, que están reservados para `--attention` (rechazada / desplazada), `--priority-high` (prioritario) y `--danger` (conflicto). Sin esa exclusión, un bloque "color por proyecto" naranja sería indistinguible de uno que reclama acción, que es justo lo que `DESIGN.md` §2 condición 2 prohíbe.

Los ocho: pizarra · índigo · azul · cian · verde azulado · verde · violeta · rosa. Valores propuestos (se validan por contraste al implementar, T2.1):

| # | claro surface / line | oscuro surface / line |
| :---- | :---- | :---- |
| 1 pizarra | `#eef1f5` / `#64748b` | `#1c2028` / `#94a3b8` |
| 2 índigo | `#eeeffc` / `#5b60c9` | `#1d1e2e` / `#9aa0ee` |
| 3 azul | `#e9f1fd` / `#3b7dd8` | `#172336` / `#6fa5f2` |
| 4 cian | `#e6f3f7` / `#0e7490` | `#10262c` / `#5fbcd0` |
| 5 verde azulado | `#e7f4f0` / `#0f766e` | `#112724` / `#4fb3a3` |
| 6 verde | `#ecf4e9` / `#4d7c2f` | `#182619` / `#86c06a` |
| 7 violeta | `#f2edfa` / `#7857c8` | `#221a33` / `#b096ea` |
| 8 rosa | `#fbecf3` / `#b03a72` | `#2c1a25` / `#e08bb0` |

**Asignación:** hash determinístico del uuid (proyecto o desarrollador, según `group`) módulo 8. Estable entre sesiones, entre vistas y entre usuarios, sin columna en la DB ni estado de servidor. Dos entidades pueden compartir hue; es aceptable porque el bloque siempre muestra desarrollador y proyecto en texto (condición 3 de `DESIGN.md` §2), y ocho colores adyacentes distinguibles es más de lo que una grilla soporta legiblemente.

### 6.2 Rampa de ocupación (vistas Mes y Año)

Neutra por diseño: la ocupación no es una alerta hasta que se pasa. Cuatro escalones `--load-0` … `--load-3` en grises, más los dos casos que sí reclaman atención, que reusan tokens existentes en vez de crear nuevos:

| Ocupación del día | Fondo | Texto acompañante |
| :---- | :---- | :---- |
| Día no laborable | `--muted`, número del día en `--secondary-foreground` | — |
| 0% | `--load-0` (transparente) | — |
| 1–33% | `--load-1` | contador |
| 34–66% | `--load-2` | contador |
| 67–99% | `--load-3` | contador |
| 100% | `--attention-bg` + línea `--attention` | contador |
| >100% | `--danger-bg` + línea `--danger` | contador |

Ocupación = horas reservadas del día / (desarrolladores considerados × 8 h). "Desarrolladores considerados" son los activos con rol `dev`, o el subconjunto que dejen los filtros — así filtrar por un dev muestra *su* ocupación y no una fracción diluida del equipo.

**Días no laborables (Q-F, respondida — §12).** La jornada es fija de 09:00 a 17:00, y no se trabaja fines de semana ni feriados argentinos. Consecuencias:

- Sábados, domingos y feriados quedan **fuera del denominador**: su capacidad es 0, así que no se les calcula ocupación (dividir por cero) y se pintan con `--muted`, sin rampa.
- **Reservar en un día no laborable es excepcional pero posible.** El cliente confirmó (Q-G) que `004` solo advierte, nunca bloquea. La celda muestra el contador y se marca como sobreasignada: capacidad 0 con horas reservadas es, literalmente, exceso. No es un error del cálculo, es la señal correcta — un sábado con reservas es raro, y justamente por eso tiene que saltar a la vista.
- El calendario de feriados vive en `src/lib/calendar/workdays.ts` como una constante por año. **No es un dato derivable:** en Argentina los feriados con fines turísticos y los trasladables se fijan por decreto cada año, así que la lista necesita mantenimiento anual (R-7).

El contador de reservas va **siempre en texto** dentro de la celda, con `.font-data`: la rampa es refuerzo, no el portador de la información (`DESIGN.md` §8 y checklist 12).

### 6.3 Densidad de la grilla

Respetando la escala `4 · 8 · 12 · 16 · 24 · 32` de `DESIGN.md` §5:

- **Vista Día:** franja de 30 min = 24 px de alto. Rango visible por defecto **09:00–17:00**, la jornada real (16 franjas = 384 px). Ajustar la grilla a la jornada en vez de mostrar 24 h es lo que hace que un día entero entre en pantalla sin scroll vertical, que es el punto de §1 de `DESIGN.md`. Carril de 160 px mínimo, con scroll horizontal cuando hay más carriles que ancho — nunca comprimir por debajo de 160 px ni aplicar `max-width` al contenedor (§6).
- **La extensión del rango es rara, y por eso se calcula siempre.** Trabajar fuera de 09:00–17:00 es excepcional (Q-G), pero `004` no lo bloquea, así que va a ocurrir. El rango visible se calcula siempre como `min(09:00, primer inicio) … max(17:00, último fin)`, redondeado a la media hora: un solo camino de renderizado, sin rama especial para el caso raro — que es precisamente el tipo de rama que nadie ejercita y termina rota. En la enorme mayoría de los días el cálculo devuelve 09:00–17:00 y la grilla queda en sus 384 px compactos.
- Las franjas fuera de la jornada se dibujan con fondo `--muted`, y **nunca se recortan ni se colapsan**: una reserva que el calendario esconde es peor que una grilla más larga. Como es una situación excepcional, tiene que distinguirse a simple vista del horario normal — es el mismo criterio con el que un sábado con reservas se marca como sobreasignado en las vistas Mes y Año (§6.2).
- **Vista Mes:** celda de día de 96 px de alto mínimo, grilla de 7 columnas a ancho completo.
- **Vista Año:** 12 mini-meses en grilla responsive (4×3 a 1440 px, 3×4 a 1280 px), celda de día de 12 px.
- Hairlines de 1 px `--border` en toda la grilla, sin `gap`.

### 6.4 Bloques enfocables sin vista de detalle

`DESIGN.md` §12 exige que los bloques sean enfocables con nombre accesible; §7 prohíbe elementos enfocables que no lleven a ningún lado. En `003` no existe todavía la vista de detalle de una reserva (es de `004`). Se resuelve como en `002` con el empty state: el bloque abre un **popover de detalle en solo lectura** (desarrollador, proyecto, cliente, franja, estado, nota, ticket si lo hay) con click o `Enter`. El foco lleva a algo real, y `004` reemplaza el popover por el panel de edición sin tocar el resto de la grilla.

`aria-label` del bloque: `"{dev} · {proyecto} · 09:00 a 13:00 · pendiente"`. Cubre el requisito de alternativa no visual de `DESIGN.md` §12.

---

## 7. UI — componentes

```
src/app/(app)/calendar/
  page.tsx            server: parsea la URL, resuelve rango, consulta, elige vista
  loading.tsx         skeleton con la forma de la grilla (no un spinner)
src/components/calendar/
  calendar-toolbar.tsx    server: año/mes/día, ← hoy →, agrupación (ver nota)
  calendar-filters.tsx    client: los 6 filtros, chips de filtros activos, "limpiar"
  year-view.tsx           server
  month-view.tsx          server
  day-view.tsx            server: carriles + franjas
  booking-block.tsx       client (popover de detalle)
  booking-status.tsx      icono + texto de los 5 estados (DESIGN.md §8)
  occupancy-cell.tsx      celda de día con rampa + contador
src/lib/calendar/
  range.ts        resolveRange(view, date, tz) → {from, to} + navegación anterior/siguiente
  layout.ts       toGridRows(booking) y assignColumns(bookings) para solapamientos
  palette.ts      categoryIndex(id) → 1..8
  workdays.ts     jornada 09–17, fines de semana y feriados (Q-F)
  load.ts         agregación por día + cálculo de ocupación
  url.ts          calendarHref(params, patch) — un solo constructor de URLs
  format.ts       fechas y horarios en es-AR
  query.ts        §5
```

> **La barra de herramientas terminó siendo un Server Component**, no un Client Component como decía este plan. Al construirla quedó claro que no necesita estado: cada control es un `<Link>` que ya lleva el resto de los params en el href. Eso hace que perder un filtro al cambiar de vista sea imposible por construcción (no hay estado que sincronizar), y de paso el botón "atrás" del navegador funciona solo. El único componente cliente de la feature es el bloque, por el popover.

`booking-status.tsx` sale de la tabla de `DESIGN.md` §8 (pendiente/aprobada/cancelada sin color; rechazada/desplazada en `--attention`). `DESIGN.md` §14 lo daba como componente de `004`, pero el calendario tiene que mostrar el estado en cada bloque (spec funcional §4.2), así que nace acá y `004`/`005` lo reusan. Se actualiza §14.

### Estados de datos (los cuatro de `DESIGN.md` §9)

- **Cargando:** `loading.tsx` con la silueta de la grilla.
- **Vacío:** sin ninguna reserva en el rango → `EmptyState`. El botón con verbo sería `Crear reserva`, que no existe hasta `004`: en `003` el empty state va sin acción y con una línea que explica que todavía no hay reservas. Se completa en `004`.
- **Sin resultados de filtro:** rango con reservas pero ninguna que pase los filtros → `NoResultsState` nombrando los filtros activos y ofreciendo limpiarlos. `DESIGN.md` §14 anticipa que este estado va a ser frecuente acá; es su primer uso real.
- **Error:** lo cubre el error boundary de `(app)/error.tsx`.

### Navegación

Se agrega `Calendario` como primer item del sidebar y **`/` pasa a redirigir a `/calendar`**. La home de bienvenida de `002` era un placeholder hasta que existiera la pantalla principal; la spec funcional §4 dice que el calendario *es* la pantalla principal. El item activo se resuelve por segmento, como el resto (`DESIGN.md` §7).

---

## 8. Integraciones externas

Ninguna. El bloque muestra `ticket_ref` como texto si existe, pero no consulta Jira ni Slack — eso es `008`/`009`.

---

## 9. Alternativas consideradas

### Librería de calendario vs. grilla propia (Q-D)

**Elegido: grilla propia sobre CSS grid.** Amerita ADR (0007).

- **FullCalendar** — el modo "agrupar por desarrollador" es exactamente su *resource timeline*, que está bajo licencia comercial. Pagar una licencia por la mitad de una feature del MVP no se justifica, y su DOM y CSS propios pelean de frente con la escala de densidad y los tokens de `DESIGN.md`.
- **Schedule-X** — moderno y prolijo, pero la vista de recursos (los carriles, que son el corazón de US-3) también es del plan pago, y arrastra el mismo problema de estilos.
- **react-big-calendar** — gratis y con `resources` en la vista Día, pero no tiene vista Año (habría que escribirla igual), su CSS es un tema completo que habría que sobrescribir entero, y su modelo de layout no contempla la rampa de ocupación.
- **Propia** — lo que hay que escribir es: posicionar bloques por hora, repartir solapamientos en columnas y pintar una grilla. Son tres funciones puras (`range.ts`, `layout.ts`, `load.ts`) que se testean unitariamente sin DOM, más marcado. A cambio: control total sobre densidad, tokens, accesibilidad y estados, que es donde este producto se juega la UX. El drag & drop, que es la parte cara de hacer a mano, no está en `003` y en `004` se resuelve con la API de pointer events sobre la misma grilla.

### Otras

- **Rutas `/calendar/[view]/[date]` en vez de query params:** más lindas, pero los filtros iban a terminar igual en la query string y quedaba el estado partido en dos lugares. Una sola fuente.
- **Vista Semana:** fuera del MVP (Q-C). La grilla de la vista Día ya es paramétrica en cantidad de carriles; agregar Semana después es una vista nueva sobre las mismas funciones puras, no un rediseño.
- **Modo combinado dev × proyecto (matriz):** fuera, como dice la spec §5. La agrupación es un solo eje.
- **Denormalizar `priority` en `bookings`:** §3.2.

---

## 10. Dependencias entre features

- Requiere `001` (RLS, sesión) y `002` (clientes, proyectos y usuarios reales para filtrar y agrupar; `AppShell`; tokens y componentes de `DESIGN.md`).
- Bloquea `004-bookings` (que hereda la tabla y la grilla) y, por transitividad, `005`–`009`.

---

## 11. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
| :---- | :---- | :---- |
| R-1 | `bookings` nace en `003` aunque su CRUD sea de `004`: riesgo de que el esquema no le sirva a quien implemente `004`. | La tabla sale del modelo conceptual de la spec funcional §10, no de una necesidad de esta vista. Solo lectura: sin policies de escritura, `004` las agrega junto al constraint anti doble-booking. Anotado como follow-up en `tasks.md`. |
| R-2 | Timezone (Q-10). El límite de un "día" depende de la TZ y hoy no está decidida. | Todo se guarda en `timestamptz` (UTC), que es correcto en cualquier escenario. La conversión ocurre en **un solo lugar**, `resolveRange(view, date, tz)`, que hoy recibe la TZ del navegador. Si el cliente pide TZ fija por proyecto, se cambia el argumento, no la arquitectura. |
| R-3 | Calendario propio = más superficie de código propio. | Alcance acotado (tres vistas, sin escritura ni drag & drop) y las partes difíciles son funciones puras con tests unitarios. |
| R-4 | La paleta categórica puede no llegar a contraste AA en ambos temas, o competir con las señales de atención. | Texto siempre en `--foreground` sobre superficies de luminosidad pareja; se excluyen ámbar, naranja y rojo (§6.1); contraste verificado en T2.1 en los dos temas. |
| R-5 | La agregación por día en JS no escala más allá de los volúmenes objetivo. | Aislada en `getDayLoad`; se reemplaza por vista `security_invoker` o RPC sin tocar componentes. Los tests de rendimiento (T5.5) marcan cuándo. |
| R-6 | Q-5: si el cliente decide que el dev NO ve el calendario global, cambia lo que cada uno ve. | Es una policy de RLS más un default de filtro, no un cambio de arquitectura: la vista ya está preparada para filtrar por desarrollador. |
| R-7 | La lista de feriados argentinos se desactualiza. Los trasladables y los "con fines turísticos" se fijan por decreto cada año, así que una lista hardcodeada envejece y el calendario empieza a mostrar como laborable un día que no lo es. | La lista vive en un solo archivo (`workdays.ts`), por año, con los años cargados explícitos. Un test unitario falla cuando se consulta un año sin cargar, en vez de asumir en silencio que todos sus días son laborables. Migrar a tabla en DB o fuente externa cuando llegue la gestión de vacaciones y licencias (Fase 2, spec funcional §2.3) — anotado como F5. |

---

## 12. Preguntas abiertas

Todas con default aplicado; ninguna bloquea la implementación.

| # | Pregunta | Default aplicado | Necesaria antes de |
| :---- | :---- | :---- | :---- |
| Q-5 | ¿El desarrollador ve el calendario global o solo el suyo? | Global en modo lectura (recomendación de la spec funcional §11). RLS: `select` para todo `authenticated`. | `005-approval-flow` |
| Q-10 | Multi-timezone. | `timestamptz` en DB; se renderiza en la TZ del navegador. Si el equipo es de una sola TZ, es invisible. | `007-google-calendar` |
| Q-C | ¿Hace falta vista Semana? | No en el MVP. | Fase 2 |
| Q-D | Librería de calendario. | Grilla propia (§9, ADR 0007). | — resuelta acá |
| Q-F | **Nueva. Respondida por el cliente el 2026-08-05.** ¿Cuál es la jornada laboral y qué días no se trabaja? | **Jornada fija de 09:00 a 17:00. No se trabaja fines de semana ni feriados argentinos.** Aplicado en §6.2 (denominador de ocupación y días no laborables) y §6.3 (rango visible de la vista Día). | — resuelta |

> La letra `E` ya estaba tomada: `004/spec.md` §7 tiene su propia Q-E sobre si editar una reserva aprobada invalida la aprobación. Por eso esta es Q-F.

---

## 13. Testing strategy

- **Unit (Vitest, sin DOM):** son los primeros tests unitarios reales del repo, y acá se justifican porque la lógica difícil es toda pura.
  - `range.ts`: rangos de las tres vistas, cruces de mes y de año, año bisiesto, navegación anterior/siguiente, y el rango visible de la vista Día con reservas antes de las 09:00, después de las 17:00 y en los dos extremos a la vez.
  - `workdays.ts`: fin de semana, feriado fijo, feriado trasladado, día laborable común, y el error al consultar un año no cargado (R-7).
  - `layout.ts`: mapeo hora → fila de grilla, y reparto en columnas de solapamientos (incluido el caso de tres reservas encadenadas, donde el algoritmo ingenuo falla).
  - `palette.ts`: estabilidad del hash y distribución sobre los 8 hues.
  - `load.ts`: ocupación 0 / parcial / exacta al 100% / sobreasignada, y día no laborable con reservas (capacidad 0, sin división por cero).
  - Parser Zod de la URL: query strings inválidas caen a los defaults en vez de romper.
- **Integration (DB):** RLS de `bookings` (todo `authenticated` lee; **nadie** escribe, ni el admin); overlap de rango correcto en los bordes; filtros combinados devolviendo el conjunto exacto.
- **E2E (Playwright):** año → mes → día conservando filtros (AC-1.1, 1.2, 1.3, 4.1); agrupar por dev y por proyecto muestra la cantidad de carriles esperada (AC-3.1, 3.2); dos reservas de devs distintos superpuestas se ven en paralelo (AC-2.2).
- **Rendimiento (AC-4.2, spec §8):** con 500 reservas sembradas, se mide el **query layer** (presupuesto: <150 ms para un rango de 3 meses) en un test de integración. El resto del presupuesto de 500 ms es render y red, que se verifica a ojo en el navegador — un test que pretenda medir eso en CI mide el CI, no el producto.
- **Manual:** ambos temas, 1280 px y 1440 px, y el colapso por debajo de 1024 px (checklist de `DESIGN.md` 5 y 15). Esta feature es la que más lo necesita: es la primera pantalla con color categórico.

---

## 14. Rollout

- Feature flag: no.
- Migraciones destructivas: no (`bookings` es tabla nueva).
- Rollback: sin datos productivos; `supabase db reset` revierte limpio.
- La redirección de `/` a `/calendar` es el único cambio que toca una pantalla existente de `002`; es reversible en una línea.
