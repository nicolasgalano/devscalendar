# Spec — Membresía por proyecto y tickets

- **ID:** 015-project-membership-and-tickets
- **Estado:** draft
- **Referencias en la spec funcional:** § nueva (módulo tickets); complementa §4 (calendario), §11 (roles).

---

## 1. Objetivo

Introducir un módulo de tickets tipo Jira dentro de DevsCalendar: cada proyecto lleva sus unidades de trabajo (tickets con estado, prioridad y asignado) y una membresía explícita (`project_members`) define quién ve y edita qué. Es la base de `016-time-tracking` (los `time_entries` apuntarán a un ticket) y de `017-github-integration` (los commits se linkean por convención de nombre).

---

## 2. Contexto

Hoy DevsCalendar modela **compromisos futuros** (bookings): un PM reserva la agenda de un dev sobre un proyecto. No hay dónde vive el trabajo mismo — qué se está construyendo, en qué estado está, quién lo lleva. Ese vacío se llena hoy con planillas, con Jira externo o con nada. La consecuencia práctica es que la app puede decir "Juan tiene 4 h el jueves en Proyecto X" pero no "Juan está trabajando en `WDW-42: importar CSV de clientes`".

Los tres pilares que fuerzan crearlo dentro del producto y no cablearlo a un Jira externo:

1. **`016-time-tracking` va a apuntar a tickets.** Modelar dos entidades distintas para "unidad de trabajo dentro de un proyecto" (una para el tablero tipo Jira, otra para las tareas del time tracker) es duplicar ABM, permisos y modelo. Se hace en una sola tabla.
2. **`017-github-integration` va a resolver `#PROJ-N` en el mensaje del commit contra los tickets locales.** Sin tickets propios no hay a qué resolver.
3. **El reporte plan-vs-real** (`016`) va a comparar `bookings` con `time_entries` dentro del mismo producto, y los `time_entries` viven contra tickets. Salir de la app rompe la cadena.

Los permisos globales que ya tenemos (`admin` / `pm` / `developer`, ADR 0011) no alcanzan para tickets: un desarrollador de un proyecto no tiene por qué ver los tickets de otro. Lo que hace falta es **membresía por proyecto**, una tabla nueva (`project_members`) con un rol acotado por proyecto (`lead` / `contributor` / `viewer`).

`project_members` no es solo de esta feature: `016` la va a reutilizar para la asignación persona↔proyecto y para el `valor_hora_override` por asignación. Que salga en `015` no es prematuro, es lo que evita duplicar la tabla en `016`.

---

## 3. User stories

- **US-1** — Como admin (o PM del proyecto), quiero asignar personas a un proyecto con un rol dentro del proyecto, para controlar quién puede ver y editar sus tickets.
- **US-2** — Como miembro de un proyecto, quiero crear tickets con título, descripción, estado, prioridad y asignado, para llevar el trabajo del equipo.
- **US-3** — Como miembro, quiero listar los tickets del proyecto con filtros combinables (estado, asignado, prioridad, texto en el título), para encontrar lo que necesito.
- **US-4** — Como miembro con permiso, quiero transicionar un ticket entre estados (`todo` → `in_progress` → `in_review` → `done`, o marcar `blocked` / `cancelled`), para reflejar el avance.
- **US-5** — Como miembro, quiero que cada ticket tenga una clave estable `PROJ-N` (código del proyecto + número correlativo), para referenciarlo en commits, conversaciones y links.
- **US-6** — Como persona **no** miembro de un proyecto (y sin rol admin), no quiero ver sus tickets — ni en el listado, ni en detalle, ni siquiera saber que existen.
- **US-7** — Como admin, quiero ver el listado global de tickets a través de todos los proyectos, para tener el panorama del equipo.

---

## 4. Acceptance criteria

### US-1 · membresía por proyecto

- **AC-1.1** — Given un admin (o el PM del proyecto) abre el detalle de un proyecto en `/admin/projects/:id`, when agrega a un usuario con rol `lead`, `contributor` o `viewer`, then se crea la fila en `project_members` con `active=true` y el usuario pasa a ver los tickets del proyecto según el rol asignado.
- **AC-1.2** — Given un usuario ya es miembro, when el admin/PM lo desactiva, then `project_members.active = false` y la persona deja de ver los tickets. La fila **no se borra** — es historia. Reactivar es volver el flag a `true`.
- **AC-1.3** — Given un proyecto se crea, when el trigger de creación corre, then el `pm_id` del proyecto queda automáticamente como miembro con `role_in_project = 'lead'` y `active=true`. **No hace falta agregarlo a mano.**
- **AC-1.4** — Given un admin cambia el `pm_id` de un proyecto (`002`), when el update corre, then:
  - El PM entrante se agrega como `lead` si no existía (o se reactiva y se le sube a `lead` si estaba con otro rol).
  - El PM saliente **queda como estaba**: no se lo baja ni se lo desactiva. Puede haber creado tickets, seguido el proyecto, o querer seguir viéndolo. La baja se hace manualmente si corresponde.
- **AC-1.5** — Given un admin (rol global), when consulta cualquier proyecto, then ve todos sus tickets **sin necesidad de figurar en `project_members`**. La membresía es un mecanismo para no-admins.

### US-2 · alta de ticket

- **AC-2.1** — Given un miembro con rol `contributor` o `lead` (o admin, o PM del proyecto), when postea a `POST /api/tickets` con `project_id`, `title` (obligatorio, 1–200 chars), `description` (opcional), `priority` (default `medium`), `assignee_id` (opcional, debe ser miembro del proyecto), then el ticket se crea con `status = 'todo'`, `numero` autoasignado y `created_by = auth.uid()`.
- **AC-2.2** — Given un ticket se crea en un proyecto con `key = 'WDW'`, when queda persistido, then su clave visible es `WDW-N` donde `N` es el siguiente `next_ticket_number` del proyecto. La numeración es **inmutable**: N nunca se reusa aunque se cancele el ticket.
- **AC-2.3** — Given el `assignee_id` se pasa pero **no es miembro activo** del proyecto, when la API valida, then responde `400` con el motivo. Un ticket no puede asignarse a alguien que no puede verlo.
- **AC-2.4** — Given un `viewer` intenta crear un ticket, when postea, then la API responde `403`. Los viewers son lectura pura.
- **AC-2.5** — Given un proyecto está `inactivo`, when se intenta crear un ticket, then la API responde `409` con un mensaje que explica que el proyecto está desactivado. Idem al patrón de `bookings` (D-08, `013`): editar/cerrar lo existente se permite; alta nueva no.

### US-3 · listado y filtros

- **AC-3.1** — Given un usuario abre `/tickets`, when la vista carga, then muestra **solo tickets de proyectos donde es miembro activo** (o todos, si es admin). El listado no revela ni siquiera la existencia de tickets ajenos.
- **AC-3.2** — El listado soporta los siguientes filtros combinables, todos vía search params (estado en URL, patrón `src/lib/calendar/url.ts`):
  - `projectId` — un proyecto específico. Si el usuario no es miembro (y no es admin), 0 resultados.
  - `status` — uno o varios (`todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`).
  - `assigneeId` — un asignado, o `me` como alias de `auth.uid()`, o `unassigned` para tickets sin asignar.
  - `priority` — una o varias.
  - `q` — texto libre, matchea `title` (case-insensitive).
- **AC-3.3** — El default cuando el usuario abre `/tickets` sin params: filtra por `status in ('todo', 'in_progress', 'in_review', 'blocked')` — o sea, **oculta `done` y `cancelled` por default**. El toggle para mostrarlos se llama "incluir cerrados" y es análogo al `includePms` de `014`.
- **AC-3.4** — El listado ordena por `updated_at desc` por default. Un futuro `orderBy` en URL puede agregar orden por prioridad o por número — fuera del MVP.
- **AC-3.5** — El detalle de un ticket vive en `/tickets/:key` (por ejemplo `/tickets/WDW-42`). Si la clave no existe o el usuario no puede verlo, la respuesta es `404` (no `403`). No se revela si existe pero está prohibido.

### US-4 · transiciones de estado

- **AC-4.1** — Given un miembro con rol `contributor`, `lead` (o admin/PM del proyecto), when hace `PATCH /api/tickets/:id` con un nuevo `status`, then el update se aplica y `updated_at` avanza.
- **AC-4.2** — Given cualquier estado, cualquier transición está permitida (incluida `done → in_progress` para reabrir). **No hay workflow rígido en el MVP** — la disciplina la lleva el equipo. Reglas de workflow duro se pueden agregar como trigger sin migración de datos.
- **AC-4.3** — Given un `viewer` intenta transicionar, when hace el `PATCH`, then la API responde `403`.
- **AC-4.4** — Given un `contributor` intenta editar un ticket asignado a otro (y no creado por él), when hace el `PATCH` de cualquier campo distinto de `status`, then la API responde `403`. Los contributors editan **solo sus propios tickets** (los que crearon o los que tienen asignados); los `lead` editan cualquiera del proyecto.

### US-5 · numeración

- **AC-5.1** — Given un proyecto se crea con `key = 'WDW'`, when se crean tres tickets, then los tres reciben `numero = 1, 2, 3` y sus claves son `WDW-1`, `WDW-2`, `WDW-3`.
- **AC-5.2** — Given `WDW-2` se cancela, when se crea un ticket nuevo, then su `numero` es `4`, no `2`. La numeración nunca reusa números.
- **AC-5.3** — Given un proyecto tiene ≥1 ticket, when un admin intenta cambiar `projects.key`, then el update falla con `409` y un mensaje que explica que la clave no puede cambiar una vez que hay tickets. Un rename de proyecto no invalida los `#WDW-42` que ya se referenciaron en Slack, GitHub o mensajes.
- **AC-5.4** — La creación de dos tickets en paralelo en el mismo proyecto **no debe** dar el mismo número. La asignación se hace en un trigger con `update ... returning` que serializa contra la fila del proyecto (equivalente a `SELECT ... FOR UPDATE`); dos inserts concurrentes reciben números consecutivos, no duplicados.

### US-6 · aislamiento de proyectos

- **AC-6.1** — Given una persona (no admin) **no** es miembro activa de un proyecto, when hace `GET /api/tickets` o `GET /api/tickets/:key`, then los tickets de ese proyecto **no aparecen** en el listado y `/tickets/:key` devuelve `404`.
- **AC-6.2** — Given una persona (no admin) intenta postear a `POST /api/tickets` con un `project_id` donde no es miembro, when la API valida, then responde `403`. La lectura se protege con `404` para no revelar existencia; la escritura sí puede responder `403` porque el `project_id` viene del cliente.
- **AC-6.3** — Given RLS: `tickets: select` está `using (public.is_project_member(project_id) or public.is_admin())`. Es la única defensa dura; la API es azúcar sobre esa policy. **Un test de integración verifica que un no-miembro no puede leer un ticket ni siquiera con `select` directo a PostgREST** — no se apoya en la API para el aislamiento (patrón ADR 0009).

### US-7 · vista global (admin)

- **AC-7.1** — Given un admin abre `/tickets` sin filtro `projectId`, when la vista carga, then ve tickets de todos los proyectos. La columna "proyecto" (clave `WDW`, `DEVCAL`, etc.) aparece en cada fila.
- **AC-7.2** — Given un PM abre `/tickets` sin filtro `projectId`, when la vista carga, then ve tickets **solo** de los proyectos donde es miembro activo o donde es el `pm_id`. Esto es lo mismo que un miembro cualquiera con múltiples membresías.

---

## 5. Alcance

### Dentro

- Tabla `project_members` con `role_in_project ∈ {lead, contributor, viewer}`, `active`, y unique `(project_id, user_id)`.
- Tabla `tickets` con estados enum `todo` / `in_progress` / `in_review` / `blocked` / `done` / `cancelled` y prioridades enum `low` / `medium` / `high` / `critical`.
- `projects.key` (varchar 2–8, uppercase, unique, inmutable con tickets existentes) y `projects.next_ticket_number` (int, incrementado por trigger).
- Autoasignación del PM primario como `lead` al crear un proyecto (trigger).
- RLS: `tickets` y `project_members` con policies para `select` (miembros activos + admin), `insert` (contributors + admin + PM), `update` (según rol dentro del proyecto), `delete` **no expuesto** (los tickets se cancelan, no se borran).
- API REST: `POST /api/tickets`, `PATCH /api/tickets/:id`, con guards por membresía. Lecturas van directo a PostgREST vía cliente.
- ABM de miembros: sección **"Miembros"** en `/admin/projects/:id`, accesible para admin y para el `pm_id` del proyecto.
- Vista de tickets: `/tickets` (listado con filtros) y `/tickets/:key` (detalle). Se usa el mismo patrón de estado-en-URL que `/calendar` (`src/lib/calendar/url.ts`).
- Audit log: creación, transición de estado y edit de campos "importantes" (`title`, `assignee_id`, `priority`) escriben a `audit_log` en la misma transacción.

### Fuera (explícito)

- **Time tracking**: los `time_entries.ticket_id` los agrega `016`. En `015` los tickets no saben nada de horas cargadas más allá de `estimacion_horas` (columna informativa).
- **Rol `staff`**: aunque salió del cuestionario, corresponde a `016` (habilita cargar horas). Agregar el enum en `015` sería adelantar sin uso.
- **Relación `bookings ↔ tickets`**: la agrega `016`. En `015` los bookings no cambian.
- **GitHub commits**: `017`.
- **Comentarios**, **attachments**, **labels/tags**, **subtareas**, **sprints**, **campos custom**, **watchers/notificaciones de ticket**: fase 2. Se puede modelar la propuesta cuando aparezca la necesidad; no se hace sin caso concreto.
- **Historial visible en el detalle** (activity log): la información queda en `audit_log`, pero no hay UI de "quién cambió qué" en `015`.
- **Workflow rígido de estados**: cualquier transición se permite (AC-4.2).
- **Import bulk de tickets**: fuera del MVP. Si mañana hay un Jira externo del que migrar, se resuelve como script one-off.

---

## 6. Dependencias

- **Features previas:** `001-auth-and-permissions` (roles globales, RLS base), `002-entities-admin` (proyectos, ABM), `012-multiple-roles-and-active-enforcement` (roles múltiples y `active` aplicado).
- **Externas:** ninguna.
- **Datos maestros:** todos los proyectos activos que quieran usar el módulo deben tener `projects.key` cargado. La migration incluye un default (`upper(substring(nombre, 1, 4))` limpiado a-z) para no forzar back-fill manual, pero los admins deberían revisarlas antes de crear tickets.

---

## 7. Preguntas abiertas

- **Q-1** — `projects.key` (código del proyecto): ¿lo elige el admin al crear el proyecto, o se autogenera? **Recomendación por defecto:** editable por el admin, con un default sugerido tomado del nombre (mayúsculas, sin espacios, primeras 4–6 letras). Validador: `^[A-Z][A-Z0-9]{1,7}$`, único. **Bloquea:** no — se puede refinar en `plan.md`.
- **Q-2** — ¿La transición entre estados tiene reglas duras (workflow)? **Recomendación por defecto:** no en `015` (AC-4.2). Si más adelante hace falta bloquear `cancelled → in_progress` o forzar `in_review` antes de `done`, se agrega como trigger sin migración de datos. **Bloquea:** no.
- **Q-3** — ¿Path de la UI: `/tickets` con filtro de proyecto o `/projects/:id/tickets`? **Recomendación por defecto:** `/tickets` como vista global con filtros en URL (coherente con `/calendar` y con el patrón de state-in-URL, `003`). El detalle en `/tickets/:key`. **Bloquea:** no.
- **Q-4** — ¿Los PMs primarios ven tickets de proyectos donde **no** están como miembros pero sí figuran como `pm_id`? **Recomendación por defecto:** sí — el `pm_id` es una relación equivalente a `lead` implícito, además del auto-add del trigger (AC-1.3). Preguntar en la policy `is_project_member(project_id) or projects.pm_id = auth.uid() or is_admin()`. **Bloquea:** no.
- **Q-5** — ¿Un `contributor` puede reasignar tickets ajenos (cambiar `assignee_id`) sin editar otros campos? **Recomendación por defecto:** no. Solo `lead` y admin reasignan tickets ajenos. Un contributor puede asignarse un ticket sin asignar (`assignee_id is null`) a sí mismo. **Bloquea:** no.
- **Q-6** — ¿Un ticket puede depender de otro (`blocked_by`)? **Recomendación por defecto:** no en `015`. Si aparece la necesidad, se agrega tabla `ticket_dependencies` sin tocar `tickets`. **Bloquea:** no.
- **Q-7** — El auto-add del PM primario al crear un proyecto: ¿se hace también con **retroactividad** para proyectos que ya existen antes de esta feature? **Recomendación por defecto:** sí — la migration incluye un `insert ... on conflict do nothing` que agrega a cada `projects.pm_id` como `lead`. **Bloquea:** no.

---

## 8. Métricas de éxito

- Cada proyecto activo tiene ≥1 miembro (el PM primario, mínimo). Cuenta trivial: 100 % desde el día uno gracias al auto-add.
- El listado global `/tickets` cierra en <500 ms para un usuario con 5–10 proyectos y ~200 tickets totales visibles.
- Cero incidentes de "vi un ticket que no debía": auditable por `audit_log` cruzado contra `project_members`.
- Adopción operativa (indicador cualitativo, no de código): el equipo empieza a referenciar tickets como `WDW-42` en Slack en lugar de descripciones libres. Es el proxy real de que la feature funciona.

---

## 9. Riesgos conocidos

- **R-1 — Numeración con carrera.** Dos inserts concurrentes en el mismo proyecto podrían recibir el mismo `numero` si la asignación se hace naive. **Mitigación:** trigger `before insert` que hace `update projects set next_ticket_number = next_ticket_number + 1 where id = new.project_id returning next_ticket_number - 1 into new.numero`. El `update` toma lock de fila sobre `projects`, así que dos inserts concurrentes se serializan sobre esa fila. Test de integración: 20 inserts en paralelo, verificar que los `numero` son 1..20 sin repeticiones.
- **R-2 — `projects.key` cambiando rompe referencias externas.** Si un admin cambia la clave después de haber compartido `#WDW-42` en Slack o en un commit, el link se rompe. **Mitigación:** la clave es **inmutable** una vez que el proyecto tiene tickets (AC-5.3). Antes del primer ticket, sí se puede editar.
- **R-3 — Membresía "olvidada".** Un dev deja de trabajar en un proyecto pero nadie lo saca de `project_members`. Sigue viendo tickets que ya no son de su incumbencia. **Mitigación:** no es un problema de seguridad (los tickets son internos), pero sí de ruido. El listado de miembros en `/admin/projects/:id` lista fecha del último `time_entry` del miembro en ese proyecto (que viene con `016`), lo que hace visible el olvido. En `015` no hay más que la disciplina.
- **R-4 — RLS y `403` vs `404`.** Devolver `404` en lugar de `403` cuando no se puede leer un ticket es lo correcto para no revelar existencia, pero es fácil equivocarse (una policy de `select` que filtra en silencio + una policy de `update` que rechaza explícito daría `403` en un caso donde la lectura previa habría dado `404`). **Mitigación:** en la API, hacer siempre `select` primero. Si `null`, `404`; si existe, aplicar la operación y traducir el error de RLS al code correcto. Igual patrón que ADR 0010 (`reallocate_booking`) — no confiar en el código de error de Postgres, leer las filas de vuelta.
- **R-5 — Migration en dos fases obliga a coordinar `db:push`.** Agregar `projects.key` y `projects.next_ticket_number` con default es no-breaking (backfill automático). Pero eliminar la vieja columna equivalente **no aplica** — no hay vieja columna. Igual, cualquier trigger o policy que dependa de `is_project_member` requiere que `project_members` exista antes de que el trigger corra. Orden de la migration: (1) crear `project_members` con RLS, (2) crear tabla `tickets` con FKs, (3) crear funciones `is_project_member` / `is_admin_or_pm_of`, (4) crear triggers de numeración y de auto-add. **Mitigación:** una sola migration con todo el orden interno correcto, un solo `db:push`, verificación en CI antes de tocar la base productiva (regla de migrations post-2026-09-08 del CLAUDE.md).
- **R-6 — Proyectos sin `key`.** Un admin crea un proyecto y se olvida de asignar `key`. El siguiente ticket no tiene cómo llamarse. **Mitigación:** `projects.key` es `not null` con default `null` denegado — la columna es obligatoria en el form de alta de proyecto (`002`), con default sugerido a partir del nombre. Los proyectos ya existentes se rellenan con el mismo default en la migration (Q-7).
- **R-7 — El default de `status in ('todo', ..., 'blocked')` esconde `done`.** Alguien que busca "el ticket que hicimos la semana pasada" no lo encuentra y piensa que no existe. **Mitigación:** el toggle "incluir cerrados" está visible en el panel de filtros, no oculto. Igual patrón que `014` con "incluir PMs" — la solución al filtro-oculto es hacerlo evidente, no eliminarlo.

---

## 10. Notas

- **Auth y RLS**: se agregan dos helpers de SQL, `is_project_member(project_id uuid, user_id uuid default auth.uid())` y `role_in_project(project_id uuid, user_id uuid default auth.uid())`. Igual convención que `has_role()` (D-01): la función incluye la comparación con `active = true` **adentro**, para que ningún consumidor se olvide.
- **Convención de código del proyecto**: la autorización de handlers pasa por un helper nuevo `requireProjectMembership(project_id, min_role)` en `@/lib/api/require-project-membership.ts`, análogo a `requireAdmin()` y `requireBookingAccess()`. Los payloads van con Zod en `@/lib/validation/tickets.ts`. Body con `readJsonBody()`.
- **`role_in_project` es un `enum`, no una tabla de roles**: la jerarquía `viewer < contributor < lead` es lineal y no se espera que crezca. Si aparece un cuarto rol (`editor` para permitir editar sin transicionar, por ejemplo) se agrega al enum sin migrar datos.
- **Server components por default**: la vista de `/tickets` es un Server Component que hace la query directo a Supabase (ADR sobre PostgREST) y filtra por search params. La grilla es un client component solo para los filtros interactivos.
- **`audit_log`** ya existe (ADR 0005, `010`). Se agrega `entity = 'ticket'` como uno más de los tipos auditados. La escritura la hace un trigger análogo a los de bookings (no depende del handler, ADR 0012).
- **Sobre eliminar la columna vieja `role` de `profiles`**: no aplica acá; ya se eliminó en `012`. Este slug queda separado a propósito para no mezclar la evolución de auth con la introducción del módulo de tickets.
