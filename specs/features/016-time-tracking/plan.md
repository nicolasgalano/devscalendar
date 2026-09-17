# Plan — Carga de horas (time tracking)

- **ID:** 016-time-tracking
- **Spec reference:** `./spec.md`
- **Estado:** ready
- **Depende de:** `015-project-membership-and-tickets`, `012-multiple-roles-and-active-enforcement`, `010-notifications-and-audit`, `018-sprints-and-reporting` (para enriquecer el reporte).

---

## 1. Resumen técnico

Extender enum de roles con `staff`, tres tablas nuevas (`project_activities`, `time_entries`, `active_timers`), triggers de audit + guards, RLS por membresía de proyecto. API con 8 endpoints (CRUD + timer + export). UI con vista semanal (`/my-time`), timer pill en header, sección "Horas cargadas" en ticket detail, tab "Actividades" en workspace, y dos reportes (consumo, plan-vs-real). Notificaciones patrón 010. Sprint report (018) enriquecido con horas cargadas live-queried.

Cero dependencias npm nuevas. Reusa `useSyncIndicator()` de 017 para trabajo asíncrono.

---

## 2. Modelo de datos

### 2.1 Enum extendido

```sql
alter type public.user_role add value 'staff';
```

Postgres 15 permite agregar valores de enum sin rewrite. El `has_role('staff', user_id)` sigue funcionando por reuso del helper existente.

### 2.2 Tabla `project_activities`

```sql
create table public.project_activities (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete restrict,
  name        text not null check (char_length(name) between 1 and 60),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Unique parcial: dos actividades activas del mismo proyecto no pueden compartir nombre.
-- Una desactivada + una activa con el mismo nombre es OK — permite "reciclar" nombres.
create unique index project_activities_name_active_idx
  on public.project_activities (project_id, lower(name))
  where active = true;

create index project_activities_project_idx
  on public.project_activities (project_id);
```

`on delete restrict` en `project_id`: los proyectos no se borran en la app (se desactivan). La convención mantiene la coherencia.

### 2.3 Tabla `time_entries`

```sql
create table public.time_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete restrict,
  created_by   uuid not null references public.profiles(id) on delete set null,
  project_id   uuid not null references public.projects(id) on delete restrict,
  ticket_id    uuid references public.tickets(id) on delete set null,
  activity_id  uuid references public.project_activities(id) on delete set null,
  minutes      int  not null check (minutes > 0 and minutes <= 960 and minutes % 15 = 0),
  logged_at    date not null,
  description  text check (description is null or char_length(description) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index time_entries_user_date_idx on public.time_entries (user_id, logged_at desc);
create index time_entries_project_date_idx on public.time_entries (project_id, logged_at desc);
create index time_entries_ticket_idx on public.time_entries (ticket_id) where ticket_id is not null;
create index time_entries_activity_idx on public.time_entries (activity_id) where activity_id is not null;
```

- **`on delete restrict` en `user_id`**: un profile con entries no se puede borrar (mismo criterio que en `015`).
- **`on delete set null` en `created_by`**: si un admin que cargó por otro se borra (raro), la entry sobrevive con `created_by = null`.
- **`on delete set null` en `ticket_id`**: si se borra el ticket (raro), la entry sobrevive apuntada solo a project + activity.
- **`on delete set null` en `activity_id`**: análogo — la entry queda "sin actividad".
- **`minutes % 15 = 0`**: garantía dura de la disciplina de cuartos de hora.

### 2.4 Tabla `active_timers`

```sql
create table public.active_timers (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete restrict,
  ticket_id    uuid references public.tickets(id) on delete set null,
  activity_id  uuid references public.project_activities(id) on delete set null,
  started_at   timestamptz not null default now()
);
```

`user_id` es PK — **una fila por usuario, garantía dura**. Arrancar un timer con otro corriendo pisa la fila (después de persistir el anterior como entry, ver AC-3.2). El cascade en delete es porque si el profile se borra, su timer huérfano no tiene sentido.

---

## 3. Constraints y validaciones cross-table

- `time_entries.ticket_id` debe pertenecer al mismo `project_id`: chequeo en handler (más simple que un check con subquery).
- `time_entries.activity_id` debe pertenecer al mismo `project_id` y estar `active = true`: chequeo en handler.
- Si el proyecto tiene ≥ 1 actividad activa y `activity_id is null` en el insert → 400 con `reason: 'activity_required'`.
- `logged_at` no puede ser futuro (fecha > current_date): rechaza en handler con reason. Cargar hoy o cualquier día pasado dentro de la ventana.

---

## 4. RLS y grants

### 4.1 Grants

```sql
grant select, insert, update, delete on public.time_entries to authenticated;
grant select, insert, delete on public.active_timers to authenticated;
-- Sin update para active_timers: el timer se para (delete + insert time_entry).
grant select, insert, update on public.project_activities to authenticated;
-- Sin delete para project_activities: se desactivan.
```

**Primera vez que la app expone `delete` a `authenticated`.** Justificación: una time entry con horas equivocadas no es historia útil, es un error. Un timer detenido tampoco.

### 4.2 Policies — `time_entries`

```sql
create policy "time_entries: read for project members"
  on public.time_entries for select to authenticated
  using (public.can_view_project(project_id));

create policy "time_entries: insert as self by contributor+"
  on public.time_entries for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.role_in_project(project_id, auth.uid()) in ('contributor', 'lead')
    or public.is_admin(auth.uid())
    or public.is_pm_of_project(project_id)
  );

create policy "time_entries: insert by admin/pm/lead for others"
  on public.time_entries for insert to authenticated
  with check (
    user_id <> auth.uid()
    and (
      public.is_admin(auth.uid())
      or public.is_pm_of_project(project_id)
      or public.role_in_project(project_id, auth.uid()) = 'lead'
    )
  );

-- Update / delete: propia dentro de 7 días O admin (sin límite).
-- La ventana de 7 días se enforce en el handler; la RLS solo mira "propia o admin".
create policy "time_entries: update own or admin"
  on public.time_entries for update to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

create policy "time_entries: delete own or admin"
  on public.time_entries for delete to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));
```

**La ventana de 7 días no vive en la RLS** porque `using` no expresa "logged_at >= current_date - 7". Vive en el handler `PATCH` / `DELETE` — le devuelve `403 { reason: 'edit_window_expired' }` al user (no admin) que intenta editar más viejo. Motivo: mensaje legible al cliente vs "policy denied" ciego.

### 4.3 Policies — `active_timers`

```sql
create policy "active_timers: only own"
  on public.active_timers for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

Cada usuario ve y toca solo su timer. Admin no ve timers ajenos — no hay caso de uso para eso.

### 4.4 Policies — `project_activities`

```sql
create policy "project_activities: read for project members"
  on public.project_activities for select to authenticated
  using (public.can_view_project(project_id));

create policy "project_activities: admin/pm write"
  on public.project_activities for insert to authenticated
  with check (public.is_admin(auth.uid()) or public.is_pm_of_project(project_id));

create policy "project_activities: admin/pm update"
  on public.project_activities for update to authenticated
  using (public.is_admin(auth.uid()) or public.is_pm_of_project(project_id))
  with check (public.is_admin(auth.uid()) or public.is_pm_of_project(project_id));
```

---

## 5. Triggers de audit y notificación

### 5.1 `audit_time_entries`

`after insert or update or delete on time_entries`. Escribe una fila a `audit_log` con `entity = 'time_entry'`, `action`, `actor_id = auth.uid()`, `diff = jsonb del old/new`. Delete guarda el payload completo pre-borrado en `diff.deleted_row`.

### 5.2 `notify_time_entry_events`

`after insert on time_entries`. Si `created_by ≠ user_id`, notifica al `user_id` con `type = 'time_entry_created_by_other'`.

`after delete on time_entries`. Si el actor era admin y no el propio user, notifica al `user_id` con `type = 'time_entry_deleted_by_admin'`. El payload incluye la fecha, horas, ticket/project — para que el user sepa qué le sacaron.

Extensión de `NOTIFICATION_TYPES` en `src/lib/notifications/events.ts` con dos tipos nuevos.

### 5.3 `touch_time_entry_updated_at`

Estándar — `new.updated_at := now()` on update.

---

## 6. API

Ocho endpoints, todos con `readJsonBody` + Zod + `requireProjectMembership`.

- `POST /api/time-entries` — crear entry. Body: `{project_id, ticket_id?, activity_id?, minutes, logged_at, description?, user_id?}`. Si `user_id` viene y no es el propio, chequea guard admin/PM/lead.
- `PATCH /api/time-entries/:id` — editar. Lee la entry, chequea ownership + ventana de 7 días (o admin bypass). Traduce triggers a HTTP.
- `DELETE /api/time-entries/:id` — borrar. Misma lógica.
- `POST /api/time-entries/timer/start` — arranca timer. Si ya hay uno para el user, lo para y persiste como entry primero (transacción — via RPC `stop_and_start_timer`).
- `POST /api/time-entries/timer/stop` — para el timer, calcula minutos, inserta entry, borra fila. Transacción (RPC `stop_timer`).
- `POST /api/project-activities` — crear. Solo admin/PM.
- `PATCH /api/project-activities/:id` — cambiar nombre o `active`. Solo admin/PM.
- `GET /api/time-entries/export.csv` — download CSV. Query params: `from`, `to`, `clientId?`, `projectId?`, `userId?`. Filtra por alcance del viewer, arma stream `text/csv`.

RPCs security definer para timer:

```sql
create or replace function public.stop_timer(p_user_id uuid)
returns uuid  -- id del time_entry creado, o null si no había timer
language plpgsql
security definer
as $$
declare
  v_timer public.active_timers%rowtype;
  v_minutes int;
  v_entry_id uuid;
begin
  select * into v_timer from public.active_timers where user_id = p_user_id;
  if not found then return null; end if;

  v_minutes := greatest(
    15,
    (extract(epoch from (now() - v_timer.started_at)) / 60 / 15)::int * 15
  );

  insert into public.time_entries (
    user_id, created_by, project_id, ticket_id, activity_id,
    minutes, logged_at, description
  )
  values (
    p_user_id, p_user_id, v_timer.project_id, v_timer.ticket_id, v_timer.activity_id,
    v_minutes, (v_timer.started_at at time zone 'America/Argentina/Buenos_Aires')::date, ''
  )
  returning id into v_entry_id;

  delete from public.active_timers where user_id = p_user_id;

  return v_entry_id;
end;
$$;

create or replace function public.stop_and_start_timer(
  p_user_id uuid,
  p_project_id uuid,
  p_ticket_id uuid,
  p_activity_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_stopped_entry_id uuid;
begin
  v_stopped_entry_id := public.stop_timer(p_user_id);

  insert into public.active_timers (user_id, project_id, ticket_id, activity_id)
  values (p_user_id, p_project_id, p_ticket_id, p_activity_id);

  return jsonb_build_object('stopped_entry_id', v_stopped_entry_id);
end;
$$;
```

---

## 7. UI

### 7.1 Sidebar

- Sumar ítem **"Mi Tiempo"** después de "Mi trabajo", visible para cualquier autenticado. Icono Lucide `ClockIcon` o `TimerIcon`.
- Sumar ítem **"Reportes"** después de "Mi Tiempo", visible para admin y PMs de al menos un proyecto (chequeo en `AppShell` con `hasPmScope(profile)` — helper nuevo).

### 7.2 `/my-time` — grilla semanal

Server component: fetch de entries de la semana + del user seleccionado + de proyectos donde carga (para el Select de "Cargar tiempo"). Client component `WeeklyGrid` renderiza columnas por día con cards apiladas.

- **7 columnas** (Lun–Dom). Header: día del mes + nombre + total del día (badge en rojo si `0`, gris si hay entries).
- **Cards**: `KEY-N` o "Sin ticket", nombre de actividad, minutos (formateados como `Xh Ymin` o `X:YY`), descripción truncada.
- **Botón "+ Cargar tiempo"** en el header, abre `<TimeEntryDialog mode="create">`.
- Click en columna vacía → dialog con esa fecha pre-completada.
- Navegación semanal con `<Link>` que reconstruyen `?w=YYYY-MM-DD`. Estado en URL.
- Selector de usuario visible solo si viewer es admin o PM. `?userId=<uuid>` en URL.

### 7.3 `<TimeEntryDialog>`

Reusado create/edit. Campos: proyecto (select, en create), actividad (select, aparece si el proyecto tiene actividades), ticket (autocomplete opcional, filtrado a los del proyecto), fecha (date), minutos (input con múltiplos de 15 — botones `+15` `+30` `+60` para carga rápida), descripción (textarea opcional).

### 7.4 Timer pill en header

`<TimerPill>` client component en el `AppShell`. Consume `getMyActiveTimer()` server-side (por request). Renderiza fixed en el header cuando hay timer:

- Muestra "▶ ticket/activity · 45min" con cronómetro actualizado cada minuto (React state con `setInterval`).
- Click abre menú: "Parar y guardar" | "Descartar" | "Ver detalle" (link al ticket).
- Badge de warning si `now - started_at > 12h`.

### 7.5 Ticket detail — sección "Horas cargadas"

Server-fetch de time entries del ticket. Header con total (y comparación con `estimated_hours` si el ticket tiene). Lista de entries con actor, fecha, minutos, descripción, botones editar/borrar (hover) para autor + admin. Botón "Cargar tiempo" abre el dialog con el ticket pre-seleccionado.

### 7.6 Tab "Actividades" en workspace de proyecto

Nueva tab entre "Old Sprints" y "Miembros" (solo visible a admin/PM del proyecto). Tabla con nombre + estado + acciones (Editar / Desactivar / Reactivar). Dialog para agregar. Similar al panel de miembros pero más simple.

### 7.7 Reportes

- `/reports` — index redirige a `/reports/consumo`.
- `/reports/consumo` — server component. Query con `getConsumo({from, to, clientId?, projectId?, userId?, groupBy?})`. Tabla con las agrupaciones. Sin plata.
- `/reports/plan-vs-real` — server component. Dos queries agregadas (bookings + time_entries) por (proyecto × persona × período). Tabla con `plan`, `real`, `delta`, `%`.
- `/api/time-entries/export.csv` — streaming response `text/csv`, filtros del URL, respeta scope.

---

## 8. Migrations

Una sola migration (`00000000000017_time_tracking.sql`) porque todo es aditivo:

1. `alter type user_role add value 'staff'`
2. Tabla `project_activities`
3. Tabla `time_entries`
4. Tabla `active_timers`
5. Extensión de `notifications.type` check (agregar `time_entry_created_by_other`, `time_entry_deleted_by_admin`)
6. Triggers audit + notify + touch
7. RPCs `stop_timer` y `stop_and_start_timer`
8. Grants + policies

Two-phase safe: cero remoción, cero cambio de tipos. El deploy previo (que no conoce las tablas nuevas) sigue funcionando.

---

## 9. Testing (aspiracional)

- **Unit**: parseo de duración (15min múltiplos), agregaciones de reporte, permisos de edición dentro de la ventana.
- **Integración**: RLS de select por proyecto, insert ajeno solo admin/PM/lead, ventana de 7 días enforced en handler, timer stop crea entry atómicamente.
- **Smoke**: embeds `time_entries ← tickets ← projects ← clients` para el reporte de consumo.

Phase de tests queda abierta si el equipo no la prioriza — como en 015, 017 y 018.

---

## 10. Cierre

- Actualizar `specs/features/README.md` con 016 done.
- Actualizar `CLAUDE.md`: nuevas rutas, nueva tab, nuevo rol, nuevas convenciones (primera vez con DELETE en `authenticated`).
- Verificación visual manual.
