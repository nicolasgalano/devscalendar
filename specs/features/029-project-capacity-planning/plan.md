# Plan — Pantalla de planificación de capacidad por proyecto

- **ID:** 029-project-capacity-planning
- **Estado:** draft
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

Cuatro capas:

- **DB**: tabla nueva `capacity_estimates` (project_id, dev_id, date, hours) con unique por tripla. SELECT abierto por `can_view_project(project_id)`. INSERT/UPDATE/DELETE **sin grant** a `authenticated` — todo pasa por dos RPCs `security definer`: `upsert_capacity_estimate` y `delete_capacity_estimate`. Patrón ADR 0010 heredado tal cual de `028`.
- **API**: endpoint `POST /api/capacity-estimates` (upsert) + `DELETE /api/capacity-estimates/[id]`. Guard `requireProjectMembership(id, 'pm')` para los dos; la RPC también revalida (defense in depth).
- **UI**: ruta `/planning` (nueva). Server component resuelve perfil + proyectos visibles; client component `<CapacityPlanningView>` monta la grilla con selector de proyecto, 28 días × devs del proyecto, popover al clickear celda. Densidad y constantes compartidas con `/calendar?view=planning` via `src/lib/planning/constants.ts` extraído del `planning-view.tsx` existente.
- **Nav**: nuevo ítem "Planificación" en el `AppShell`.

Tres phases deployables:

- **Phase 1**: schema + RPCs + endpoints + validation + tests de integración. Deploy silencioso.
- **Phase 2**: ruta `/planning`, componente de grilla, popover, totales. Depende de Phase 1 en prod.
- **Phase 3**: nav lateral + verificación manual + cierre (`tasks.md` T3.1-T3.3).

---

## 2. Arquitectura

```
/planning (page.tsx — server component)
  │
  ├─ getCurrentProfile() + isAdmin()
  ├─ getVisibleProjects()          ← ya existe (helper de 017/028)
  ├─ parseCapacityUrl(sp)          ← nuevo (projectKey, weekStart)
  │
  ├─ si no hay projectKey o es inválido:
  │     EmptyState "Elegí un proyecto"
  │
  └─ si hay proyecto visible:
       ├─ getProjectByKey(key)         ← ya existe
       ├─ getPlanningDevs(projectId, from, to)  ← NUEVO
       │    - PM primario (si no es miembro)
       │    - miembros activos
       │    - ex-miembros con estimates en el rango
       ├─ getProjectCapacityEstimates(projectId, from, to)  ← NUEVO
       │
       └─ <CapacityPlanningView
              projects={visibleProjects}
              project={project}
              devs={devs}
              estimates={estimates}
              days={days}
              canEdit={isAdmin || project.pm?.id === currentUserId}
              currentUserId={profile.id}
              urlState={urlState}
          />


<CapacityPlanningView> (client)
  │
  ├─ toolbar:
  │     [Select Proyecto ▼]  [←] [Hoy] [→]
  │
  ├─ grid (CSS grid):
  │     columns: LABEL_WIDTH + 28 × CELL_WIDTH + 4 × SUBTOTAL_WIDTH
  │     rows: WEEK_HEADER, DAY_HEADER, dev1, dev2, ..., FOOTER_TOTALS
  │
  │     cada celda editable:
  │        - vacía:   fondo neutro, click (si canEdit) → popover
  │        - con val: "4" sobre fondo primary/10, click → popover prefilled
  │
  │     subtotales por semana al margen derecho de cada bloque de 7 cols
  │     totales por día en la fila FOOTER
  │
  └─ <Popover> (Base UI o Popover de shadcn):
        [Input hours] (step=0.25, min=0.25, max=24)
        [Guardar]  [Borrar (si existe)]
        error inline si falla validación o response


POST /api/capacity-estimates { projectId, devId, date, hours }
       │
       │ requireProjectMembership(projectId, 'pm')
       │
       ▼
  rpc.upsert_capacity_estimate(p_project_id, p_dev_id, p_date, p_hours)
       │  security definer:
       │    1. valida p_hours en rango (0 < p_hours ≤ 24)
       │    2. valida proyecto existe + active
       │    3. valida admin O (pm_id = auth.uid() + has_role('pm'))
       │    4. valida dev_id es miembro activo O PM primario
       │    5. INSERT ... ON CONFLICT (project_id, dev_id, date) DO UPDATE
       ▼
  returns capacity_estimates row


DELETE /api/capacity-estimates/[id]
       │
       │ requireProjectMembership(ownerProjectId, 'pm')
       │
       ▼
  rpc.delete_capacity_estimate(p_id)
       │  security definer:
       │    1. lee project_id de la fila
       │    2. valida admin O PM primario del proyecto
       │    3. DELETE
       ▼
  returns boolean
```

---

## 3. Modelo de datos

Migration 26 `capacity_estimates.sql` — aditiva pura. Crea la tabla, policies, grants y las dos RPCs en una sola migration (son indivisibles conceptualmente: la tabla sin RPCs no acepta escrituras).

### Tabla

```sql
create table public.capacity_estimates (
  id uuid primary key default gen_random_uuid(),
  -- cascade: si se borra el proyecto, las estimaciones se van con él.
  -- Precedente: project_members de 015 usa cascade por los dos lados.
  project_id uuid not null references public.projects(id) on delete cascade,
  dev_id uuid not null references public.profiles(id) on delete cascade,
  -- `date`, no `timestamptz`: la unidad semántica es día calendario, no
  -- instante. Zona horaria del cliente la decide la UI al enviar; la DB
  -- almacena la fecha ya resuelta.
  date date not null,
  -- numeric(4,2): hasta 99.99 h con precisión de 0.01. El check acota a
  -- (0, 24]; la UI pone step=0.25 (15 min) como en time_entries de 016.
  hours numeric(4,2) not null check (hours > 0 and hours <= 24),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Una estimación por (proyecto, dev, día). El upsert la convierte en
  -- "idempotente por tripla" sin que la UI tenga que elegir entre POST y
  -- PATCH según exista o no.
  unique (project_id, dev_id, date)
);

create index capacity_estimates_project_date_idx
  on public.capacity_estimates (project_id, date);

-- Para futuras queries cross-proyecto (fuera del MVP pero sin costo acá).
create index capacity_estimates_dev_date_idx
  on public.capacity_estimates (dev_id, date);

create trigger capacity_estimates_set_updated_at
  before update on public.capacity_estimates
  for each row execute function public.set_updated_at();
```

### RLS

```sql
alter table public.capacity_estimates enable row level security;

-- Grant SELECT a authenticated — la policy filtra por can_view_project.
-- NO grant INSERT/UPDATE/DELETE: las dos RPCs son el único camino de
-- escritura, y como security definer corren con privilegios del owner.
grant select on public.capacity_estimates to authenticated;
grant all on public.capacity_estimates to service_role;

create policy "capacity_estimates: project viewer read"
  on public.capacity_estimates for select
  to authenticated
  using (public.can_view_project(project_id));
```

### RPC — upsert

```sql
create or replace function public.upsert_capacity_estimate(
  p_project_id uuid,
  p_dev_id uuid,
  p_date date,
  p_hours numeric
)
returns public.capacity_estimates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pm_id uuid;
  v_project_active boolean;
  v_result public.capacity_estimates;
begin
  -- 1) Rango de horas. El check de la tabla también lo captura pero
  --    con 23514; traducirlo acá da un mensaje legible desde el handler.
  if p_hours <= 0 or p_hours > 24 then
    raise exception 'Las horas estimadas deben estar entre 0.25 y 24'
      using errcode = 'DC011';
  end if;

  -- 2) Proyecto existe + está activo. Un proyecto desactivado no acepta
  --    estimaciones nuevas, igual que no acepta bookings nuevos (D-08).
  select pm_id, active into v_pm_id, v_project_active
    from public.projects
   where id = p_project_id
     for share;

  if v_pm_id is null or not v_project_active then
    raise exception 'Proyecto no encontrado o desactivado'
      using errcode = 'DC004';  -- reusa semántica de reallocation
  end if;

  -- 3) Autorización. has_role() incluye `and active` (D-01), así que ni
  --    admin desactivado ni PM primario desactivado como profile pasan.
  if not (
    public.has_role('admin'::public.user_role)
    or (v_pm_id = auth.uid() and public.has_role('pm'::public.user_role))
  ) then
    raise exception 'Solo admin o PM primario puede cargar estimaciones'
      using errcode = '42501';
  end if;

  -- 4) El dev tiene que ser miembro activo O ser el PM primario (que puede
  --    no tener fila en project_members). La UI no debería dejar llegar
  --    acá un dev inválido — este check es defense in depth.
  if not (
    exists (
      select 1 from public.project_members
       where project_id = p_project_id
         and user_id = p_dev_id
         and active
    )
    or v_pm_id = p_dev_id
  ) then
    raise exception 'El desarrollador no es miembro activo del proyecto'
      using errcode = 'DC012';
  end if;

  -- 5) Upsert. `updated_at` lo mueve el trigger set_updated_at al update,
  --    y en el insert queda el default. created_by se congela al insert
  --    y no cambia en update (es el autor original).
  insert into public.capacity_estimates (
    project_id, dev_id, date, hours, created_by
  )
  values (p_project_id, p_dev_id, p_date, p_hours, auth.uid())
  on conflict (project_id, dev_id, date)
  do update set hours = excluded.hours
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.upsert_capacity_estimate(uuid, uuid, date, numeric)
  from public;
grant execute on function public.upsert_capacity_estimate(uuid, uuid, date, numeric)
  to authenticated;
```

### RPC — delete

```sql
create or replace function public.delete_capacity_estimate(
  p_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_pm_id uuid;
begin
  select project_id into v_project_id
    from public.capacity_estimates
   where id = p_id
     for update;

  if v_project_id is null then
    raise exception 'Estimación no encontrada'
      using errcode = 'DC010';  -- mismo "not found" que 028
  end if;

  -- A diferencia de upsert, no se chequea `active`. Un proyecto
  -- desactivado tiene que seguir pudiendo limpiar sus estimaciones
  -- viejas (análogo a D-08 de bookings).
  select pm_id into v_pm_id
    from public.projects
   where id = v_project_id;

  if not (
    public.has_role('admin'::public.user_role)
    or (v_pm_id = auth.uid() and public.has_role('pm'::public.user_role))
  ) then
    raise exception 'Solo admin o PM primario puede borrar estimaciones'
      using errcode = '42501';
  end if;

  delete from public.capacity_estimates where id = p_id;
  return true;
end;
$$;

revoke all on function public.delete_capacity_estimate(uuid) from public;
grant execute on function public.delete_capacity_estimate(uuid) to authenticated;
```

### Códigos de error — tabla de referencia

| Código  | Dónde            | Significado                                | HTTP del handler |
| :------ | :--------------- | :----------------------------------------- | :--------------- |
| DC004   | upsert           | Proyecto no existe o desactivado           | 400              |
| DC010   | delete           | Estimación no encontrada                   | 404              |
| DC011   | upsert           | Horas fuera de rango                       | 400              |
| DC012   | upsert           | Dev no es miembro activo del proyecto      | 400              |
| 42501   | upsert + delete  | Sin permiso (ni admin ni PM primario)      | 403              |

---

## 4. API surface

### Endpoints

| Método | Ruta                              | Body                            | Response                           | Guard |
| :----- | :-------------------------------- | :------------------------------ | :--------------------------------- | :---- |
| POST   | `/api/capacity-estimates`         | `{ projectId, devId, date, hours }` | 200 `{ estimate }` \| 400/403/500 | `requireProjectMembership(projectId, 'pm')` |
| DELETE | `/api/capacity-estimates/[id]`    | —                               | 200 `{ ok: true }` \| 403/404/500  | custom (ver abajo) |

### DELETE guard — detalle

`requireProjectMembership(id, 'pm')` espera un `project_id`, no el id de la estimación. Dos caminos:

- **A.** Hacer un query previo para resolver el `project_id` desde `capacity_estimates.id`, y después llamar al guard.
- **B.** Dejar que la RPC haga el chequeo de autorización sola — igual lo hace defense-in-depth, y la respuesta sería un 403 desde la RPC mapeado por el handler.

**Elegido B.** El query extra solo para pasarlo al guard es desperdicio: la RPC va a leer el proyecto de todas formas. El handler mapea `42501` → 403 como en 028. El costo: si el id es un UUID bien formado pero no existe, el handler responde 404 vía `DC010`, no 403 — el atacante no distingue "no existe" de "no tenés permiso" por el status solo mirando el response, lo cual es aceptable para datos no sensibles como estimaciones de capacidad.

### Validación Zod

Append a `src/lib/validation/`:

```typescript
// src/lib/validation/capacity-estimates.ts
import { z } from "zod";

export const upsertCapacityEstimateSchema = z.object({
  projectId: z.string().uuid(),
  devId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser yyyy-MM-dd"),
  hours: z.number().positive().max(24),
});

export type UpsertCapacityEstimateInput = z.infer<typeof upsertCapacityEstimateSchema>;
```

### Shape del POST handler

```typescript
// src/app/api/capacity-estimates/route.ts
export async function POST(request: Request) {
  const parsed = upsertCapacityEstimateSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const guard = await requireProjectMembership(parsed.data.projectId, "pm");
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase.rpc("upsert_capacity_estimate", {
    p_project_id: parsed.data.projectId,
    p_dev_id: parsed.data.devId,
    p_date: parsed.data.date,
    p_hours: parsed.data.hours,
  });

  if (error) {
    switch (error.code) {
      case "DC004": return NextResponse.json({ error: "Proyecto no encontrado o desactivado" }, { status: 400 });
      case "DC011": return NextResponse.json({ error: "Horas fuera de rango (0.25 a 24)" }, { status: 400 });
      case "DC012": return NextResponse.json({ error: "El desarrollador no es miembro activo del proyecto" }, { status: 400 });
      case "42501": return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
      default:      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ estimate: data });
}
```

### Shape del DELETE handler

```typescript
// src/app/api/capacity-estimates/[id]/route.ts
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { error } = await supabase.rpc("delete_capacity_estimate", { p_id: id });

  if (error) {
    switch (error.code) {
      case "DC010": return NextResponse.json({ error: "Estimación no encontrada" }, { status: 404 });
      case "42501": return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
      default:      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
```

---

## 5. Componentes

### Nuevos

- **`src/lib/planning/constants.ts`** — extracción de las constantes de grilla del `planning-view.tsx` existente:

  ```typescript
  export const PLANNING_CELL_WIDTH = 40;
  export const PLANNING_LABEL_WIDTH = 240;
  export const PLANNING_ROW_HEIGHT = 36;
  export const PLANNING_WEEK_SIZE = 7;
  export const PLANNING_VISIBLE_WEEKS = 4;
  export const PLANNING_VISIBLE_DAYS = PLANNING_WEEK_SIZE * PLANNING_VISIBLE_WEEKS;
  ```

- **`src/lib/planning/range.ts`** — helper puro:

  ```typescript
  /** 4 semanas, hoy en la cuarta fila (patrón 024). */
  export function getCapacityWeekBounds(
    today: Date = new Date(),
    offsetWeeks: number = 0,
  ): { days: string[]; weekStart: string };
  ```

- **`src/lib/planning/capacity.ts`** — queries server-side:

  ```typescript
  export type CapacityEstimateRow = {
    id: string;
    devId: string;
    date: string;
    hours: number;
  };
  export type PlanningDev = {
    id: string;
    name: string;
    isProjectPm: boolean;
    isExMember: boolean;
  };

  export async function getProjectCapacityEstimates(
    projectId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<CapacityEstimateRow[]>;

  export async function getPlanningDevs(
    projectId: string,
    pmId: string,
    estimates: CapacityEstimateRow[],
  ): Promise<PlanningDev[]>;
  ```

  Nota: `getPlanningDevs` recibe `estimates` ya resueltas en vez de volver a querear — así el llamador controla el rango sin que el helper duplique la query. Interno: fetchea `project_members where active` + `profiles` de ex-miembros via `dev_ids distinct` que estén en estimates y no en members activos.

- **`src/lib/planning/totals.ts`** — funciones puras:

  ```typescript
  export function sumByDay(estimates: CapacityEstimateRow[]): Map<string, number>;
  export function sumByDevWeek(
    estimates: CapacityEstimateRow[],
    days: string[],
  ): Map<string, Map<number, number>>;
  ```

- **`src/lib/planning/url.ts`** — parser + serializer:

  ```typescript
  export type CapacityUrl = { projectKey: string | null; weekStart: string | null };
  export function parseCapacityUrl(sp: URLSearchParams): CapacityUrl;
  export function capacityHref(current: CapacityUrl, patch: Partial<CapacityUrl>): string;
  ```

- **`src/lib/validation/capacity-estimates.ts`** — Zod schema (ya mostrado en §4).

- **`src/app/(app)/planning/page.tsx`** — server component (ya mostrado en §2).

- **`src/components/planning/capacity-planning-view.tsx`** — client component. Grilla + popover + sync con URL. Reusa constantes de `src/lib/planning/constants.ts`.

- **`src/components/planning/capacity-cell.tsx`** — celda individual. Props: `value?: number`, `canEdit`, `isWorkday`, `onClick`. Decide el fondo (vacía / con valor / weekend).

- **`src/components/planning/capacity-popover.tsx`** — popover con input + botones. Props: `estimate?: CapacityEstimateRow`, `projectId`, `devId`, `date`, `onSaved`, `onDeleted`, `onCancel`.

- **`src/app/api/capacity-estimates/route.ts`** — handler POST.

- **`src/app/api/capacity-estimates/[id]/route.ts`** — handler DELETE.

### Modificados

- **`src/components/calendar/planning-view.tsx`** — importa `CELL_WIDTH`, `LABEL_WIDTH`, `ROW_HEIGHT` desde `src/lib/planning/constants.ts` en vez de declararlas locales. Cambio puntual, cero riesgo visual si los valores coinciden.

- **`src/components/app-shell/*`** — sumar ítem "Planificación" en el nav. Ícono `CalendarRange` (lucide), href `/planning`. Posición entre "Calendario" y "Proyectos". (Verificar nombre exacto del componente del nav al implementar.)

### Sin cambios

- `src/lib/calendar/range.ts` — se mantiene como está. Capacity planning no es un view del calendar.
- Tipos de `src/types/database.ts` — se regeneran después de `db:push`.

---

## 6. Plan por phases

### Phase 1 — Schema + API (silencioso)

1. Migration 26 `capacity_estimates.sql` con tabla, policies, grants y las dos RPCs.
2. `pnpm db:push` + `pnpm db:types` (requiere OK del usuario — base compartida).
3. Zod schema en `src/lib/validation/capacity-estimates.ts`.
4. Handler POST en `src/app/api/capacity-estimates/route.ts`.
5. Handler DELETE en `src/app/api/capacity-estimates/[id]/route.ts`.
6. Integration tests `tests/integration/capacity-estimates.test.ts` — ver §7.
7. Unit tests del schema Zod.

**Al final de Phase 1**: endpoint vivo, UI inexistente. Visualmente nada cambia.

### Phase 2 — UI de la grilla

1. Helpers puros: `constants.ts`, `range.ts`, `totals.ts`, `url.ts` con unit tests.
2. Query helpers: `getProjectCapacityEstimates`, `getPlanningDevs`.
3. Server component `/planning/page.tsx` con selector de proyecto y sin grilla (solo EmptyState o la grilla cuando hay projectKey).
4. Client component `<CapacityPlanningView>` + `<CapacityCell>` + `<CapacityPopover>`.
5. Refactor de `planning-view.tsx` del calendar para importar las constantes compartidas (verificación visual rápida: nada se mueve).

**Al final de Phase 2**: ruta `/planning` funcional. Falta el nav lateral para que sea descubrible.

### Phase 3 — Nav + cierre

1. Agregar "Planificación" al nav lateral del `AppShell`.
2. Verificación manual (ver §7 "Manual").
3. Actualizar `specs/features/README.md` con `code done (deployed YYYY-MM-DD)`.
4. Nota corta en `CLAUDE.md` bajo la sección de proyectos / planning: "Capacity planning vive en `/planning` sobre `capacity_estimates`, aparte de `/calendar?view=planning` que sigue siendo sobre bookings. Dos ejes, no colisionan."
5. Confirmar que `docs/deuda-tecnica.md` no suma entradas.

---

## 7. Testing

### Unit (`tests/unit/`)

- **`capacity-estimates-validation.test.ts`** — Zod: acepta válidos, rechaza horas 0/>24/negativas, rechaza fecha mal formada, rechaza uuid mal.
- **`capacity-range.test.ts`** — `getCapacityWeekBounds`: con `today=2026-10-21` ancla la semana en la cuarta fila, offset=1 adelanta, offset=-1 atrasa, los 28 días devueltos son ISO ordenados.
- **`capacity-totals.test.ts`** — `sumByDay`, `sumByDevWeek`: casos vacíos devuelven maps vacíos; con una estimación devuelven el único valor; con varias suma por bucket correctamente; semanas se cuentan desde el primer día del `days[]`.
- **`capacity-url.test.ts`** — parse + serialize: round-trip estable; defaults no se escriben; projectKey inválido cae a null; weekStart inválido cae a null (no tira).

### Integration (`tests/integration/capacity-estimates.test.ts`)

Un describe por operación, cada caso lee la fila de vuelta (patrón 028: un `update` que la RLS filtra no falla).

- **`capacity_estimates: SELECT`**:
  - viewer del proyecto (contributor) lee ✓
  - miembro ajeno al proyecto no lee ✓
  - admin lee ✓
- **`upsert_capacity_estimate` (admin)**:
  - crea nueva fila, devuelve el row ✓
  - segunda llamada con mismo proyecto/dev/día actualiza `hours` (unique no viola) ✓
- **`upsert_capacity_estimate` (PM primario)**:
  - sobre su proyecto, OK ✓
  - sobre proyecto ajeno, 42501 ✓
- **`upsert_capacity_estimate` (contributor)**:
  - 42501 ✓
- **`upsert_capacity_estimate` (PM con profile desactivado)**:
  - 42501 (por `has_role('pm')` + D-01) ✓
- **`upsert_capacity_estimate` (proyecto desactivado)**:
  - DC004 ✓
- **`upsert_capacity_estimate` (horas inválidas)**:
  - hours=0 → DC011
  - hours=24.1 → DC011
  - hours=-1 → DC011
- **`upsert_capacity_estimate` (dev no-miembro)**:
  - dev que no está en project_members ni es PM primario → DC012
  - PM primario que no está en project_members → OK (es el caso especial)
- **`delete_capacity_estimate`**:
  - admin ✓
  - PM primario del proyecto ✓
  - PM ajeno → 42501
  - contributor → 42501
  - id inexistente → DC010
  - proyecto desactivado → delete sigue funcionando (D-08 aplicado)

### Smoke

Si el proyecto suma un smoke test para HTTP: shape de response + status codes del POST/DELETE con usuario autenticado. Como en 028, no hay infra para esto; se puede dejar la nota.

### Manual (pre-merge en producción, Phase 3)

- Como admin: entrar a `/planning`, elegir proyecto, cargar estimación, editarla, borrarla. Totales se actualizan en vivo.
- Como PM primario de X: solo veo X en el selector, puedo editar sus estimaciones. Si en el `?project=` pongo un proyecto ajeno a mano, la grilla no renderiza (sin permiso).
- Como contributor: veo mis proyectos, la grilla aparece pero las celdas no abren popover.
- Navegar semanas con flechas y "Hoy". Compartir el URL y abrir en una pestaña nueva — mismo estado.
- Un dev que fue dado de baja del proyecto pero tenía estimaciones: aparece al pie, read-only.

---

## 8. Riesgos y mitigaciones

- **R-1 — Divergencia visual con el planning del calendar**: mitigado extrayendo las constantes compartidas a `src/lib/planning/constants.ts`. Si alguien cambia `CELL_WIDTH`, cambia en los dos a la vez.
- **R-2 — RPC con escalada de privilegios**: cubierto por 10+ casos de integración de autorización. Mismo patrón de 028.
- **R-3 — Carrera entre dos admins editando la misma celda**: el `on conflict ... do update` resuelve con el último escritor. No es un problema para capacity (no es compromiso).
- **R-4 — Dev con `project_members.active=false` + estimaciones viejas**: AC-1.7 los muestra al pie, read-only. Al implementar: la query `getPlanningDevs` tiene que incluirlos a partir de `dev_ids distinct in estimates` que no estén en `members activos`.
- **R-5 — El popover no cierra al cambiar de proyecto en el selector**: el componente cambia de key → unmount → remount → popover se desarma. Verificar al implementar que el `<CapacityPopover>` esté anidado en el bloque que depende de `projectId`.
- **R-6 — Performance en grillas grandes**: proyecto con 30 devs × 28 días = 840 celdas. React renderiza bien hasta ~1500 nodos sin virtualización. Si aparece lag, patrón `@tanstack/react-virtual` del kanban (017).
- **R-7 — `getPlanningDevs` necesita 3 queries (project_members, profiles de miembros, profiles de ex-miembros)**: aceptable para la pantalla. Si se nota, se cachea por request con `cache()` de React.
- **R-8 — PM primario que no tiene fila en `project_members`**: el trigger `autoadd_pm_as_lead` de 015 lo agrega automáticamente al crear el proyecto. Pero puede no estar si el PM se agregó cambiando `projects.pm_id` después. La query de devs lo contempla con el union del PM, y la RPC acepta "PM primario o miembro" en el check de dev válido. Dos capas cubren el caso.
- **R-9 — El selector de proyecto muestra proyectos inactivos**: la lista base es `getVisibleProjects()` que incluye inactivos. La UI tiene que filtrar a solo activos para esta pantalla, porque sobre inactivos no se puede escribir (DC004 al upsert). Decisión: filtrar en el client antes de pasarlo al `<Select>` — un flag `activeOnly` al componente alcanza.
- **R-10 — El AppShell nav no distingue "Planificación" (nueva) de "Calendario → Planning"**: dos entradas con la palabra "planning" en contextos distintos. Mitigación de copy: label del ítem nuevo = "Planificación", el view interno del calendar se llama "Planning" también, pero vive adentro del calendar. Si el equipo confunde, se renombra el nuevo a "Planificación de capacidad" — es un cambio de string.

---

## 9. Decisiones de diseño (ADRs referenciados, no nuevos)

- **D-1 — RPC `security definer` en vez de policies finas**: ADR 0010, mismo patrón que 028. Dos RPCs porque son dos operaciones distintas: upsert devuelve la fila (para que el cliente actualice optimistamente) y delete devuelve `boolean` (no hay fila nueva que devolver).
- **D-2 — Escrituras cerradas desde cliente (sin grant INSERT/UPDATE/DELETE)**: evita la clase de bug "la policy olvida un with check". Si no hay grant, la RPC es el único camino, y la autorización vive en un solo lugar.
- **D-3 — `date` en vez de `timestamptz`**: la unidad semántica de capacity es día, no instante. La UI resuelve TZ al enviar; la DB almacena el día ya resuelto. Mismo criterio que `time_entries.date` de 016.
- **D-4 — Reusar `requireProjectMembership(id, 'pm')`**: ya existe (015), ya acepta "admin O PM primario", ya devuelve el supabase cliente. Cero código de guard nuevo.
- **D-5 — Códigos de error separados por semántica, no por operación**: `DC004` para "proyecto desactivado" (reutilizado de reallocation), `DC010` para "no encontrado" (reutilizado de 028), `DC011`/`DC012` nuevos. Un código HTTP está determinado por el código SQL, no por el endpoint.
- **D-6 — Un solo endpoint POST para create + update (upsert)**: la unicidad de `(project_id, dev_id, date)` lo permite. Para la UI simplifica — el popover no necesita saber si está creando o actualizando. Para el DELETE sí hay endpoint separado porque la operación es distinta.
- **D-7 — Pantalla con selector de proyecto en vez de ruta por-proyecto**: respondido con el usuario (US-1 global). `/planning?project=KEY` compartible por URL.
- **D-8 — Nav lateral con ítem nuevo**: para que sea descubrible. Si queda muy junto a "Calendario", se agrupa en una sección "Planificación" con dos sub-items — pero eso es Phase 3 opcional.

---

## 10. Notas

- **Migration aditiva pura.** Sin dos fases (D-11 no aplica porque no hay columna de coexistencia).
- **Sin ADR nuevo.** Se apoya en 0010 (RPC + guard), 0011 (roles como conjunto), 0003 (shadcn on-demand).
- **Feature mediana.** 3 phases deployables; Phase 1 silenciosa, Phase 2 ya es usable con URL manual, Phase 3 la descubre todo el equipo via nav.
- **El `tasks.md` se escribe junto con esta pasada.**
- **Potenciales follow-ups (fuera de 029)**:
  - Vista cross-proyecto (ver todas las estimaciones de un dev en el mes).
  - Alertas de sobrecarga calculando capacity + bookings.
  - Reporte "plan vs real" en `/reports/*`.
  - Atajo "repetir en todos los días hábiles de la semana" en el popover.
