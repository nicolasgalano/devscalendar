# Plan — Pantalla de proyectos: orden, buscador, filtro activos y acciones

- **ID:** 028-projects-list-filters-and-actions
- **Estado:** draft
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

Cambio chico en forma de dos piezas que viven en capas distintas:

- **Base de datos** — una RPC `security definer` nueva (`set_project_active(uuid, boolean)`) que valida que el caller sea admin o PM primario, hace el update y escribe el `audit_log`. Patrón ADR 0010 — necesario porque la policy `projects: admin write` filtra al PM primario en silencio (misma categoría de problema que `reallocate_booking`). Migration aditiva pura, cero cambios de schema de tablas.
- **UI** — refactor de `<ProjectList>` a client component que lee de `useSearchParams()`, aplica filtros (buscador + switch de activos + sort) en cliente sobre la lista ya traída por el server, y agrega columna de acciones con "Ver" y "Activar/Desactivar" (esta última condicionada por rol). La columna "Tickets abiertos" **sale**, y con ella la segunda query agregada contra `tickets` que la alimentaba.

Dos phases independientes y deployables en orden: Phase 1 instala la RPC + endpoint sin consumidores (silenciosa; no cambia la UI); Phase 2 reemplaza el `<ProjectList>` y empieza a usarlos.

---

## 2. Arquitectura

```
/projects (page.tsx — server component)
  │
  ├─ getVisibleProjects()        ← PHASE 2: sin openTicketCount (-1 query)
  │    - admin: todos
  │    - no-admin: PM primario ∪ miembro activo
  │
  ├─ pasa a <ProjectList>:
  │    - projects[]              (sin openTicketCount)
  │    - currentUserId           (NUEVO prop: para calcular "soy el PM primario")
  │    - isAdmin                 (NUEVO prop: para mostrar toggle siempre)
  │
  └─ <ProjectList> (CLIENT, antes era server)
       │
       ├─ parseProjectsUrl(searchParams) → { q, active, sort, dir }
       │     (defaults: q="", active="on", sort="name", dir="asc")
       │
       ├─ toolbar:
       │   [Buscar proyecto o cliente…]  [Solo activos ●]
       │
       ├─ tabla:
       │   headers clickeables (Clave / Proyecto / Cliente / PM / Estado)
       │   con ícono de orden activo
       │
       │   filas: filtradas en cliente por (q, active) y ordenadas por (sort, dir)
       │
       │   columna Acciones:
       │     [Ver]                                     ← todos
       │     [Activar | Desactivar]                    ← admin O pm_id === currentUserId
       │
       └─ sin match → <EmptyState>


Toggle de activo:
┌───────────────────────────────────────────────────────────────┐
│  Click "Desactivar" en fila X                                 │
│       │                                                        │
│       ▼                                                        │
│  POST /api/projects/[id]/active  { active: false }            │
│       │                                                        │
│       │ guard: requireProjectMembership(id, 'pm')             │
│       │   → ok si admin O pm_id === auth.uid() (profile active)│
│       ▼                                                        │
│  rpc.set_project_active(p_project_id, p_active)               │
│       │                                                        │
│       │ security definer:                                      │
│       │   1. revalida (admin O pm_id = auth.uid())            │
│       │   2. if current.active = new.active → return early    │
│       │   3. update projects set active = new                  │
│       │   4. insert audit_log (project.active_toggled)        │
│       ▼                                                        │
│  response 200 { active: false }                                │
│       │                                                        │
│       ▼                                                        │
│  router.refresh() + estado optimista en la fila                │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. Modelo de datos

Nada de tablas, columnas, enums ni índices nuevos. Lo único que agrega la migration es la **RPC**:

```sql
-- Migration 25: set_project_active
--
-- Patrón ADR 0010: la RLS no puede expresar "el PM primario puede actualizar
-- solo la columna active". Las dos alternativas (nueva policy + trigger de
-- scope de columnas, o cliente admin via service_role) son más superficie que
-- esta RPC acotada a una sola operación.

create or replace function public.set_project_active(
  p_project_id uuid,
  p_active boolean
)
returns boolean  -- devuelve el nuevo estado (idempotente si ya coincidía)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_active boolean;
  v_pm_id uuid;
begin
  -- 1) Autorización. Admin o PM primario del proyecto.
  --    has_role('pm') hereda `and active` (D-01), así que un PM desactivado
  --    como profile no pasa este chequeo.
  select pm_id, active into v_pm_id, v_current_active
  from public.projects
  where id = p_project_id;

  if v_pm_id is null then
    raise exception 'Proyecto no encontrado'
      using errcode = 'DC010';  -- código de dominio nuevo; libre
  end if;

  if not (
    public.has_role(auth.uid(), 'admin')
    or (v_pm_id = auth.uid() and public.has_role(auth.uid(), 'pm'))
  ) then
    raise exception 'Solo admin o el PM primario puede cambiar el estado del proyecto'
      using errcode = '42501';
  end if;

  -- 2) No-op: toggle a mismo estado no mueve nada ni audita.
  if v_current_active = p_active then
    return v_current_active;
  end if;

  -- 3) Update.
  update public.projects
     set active = p_active
   where id = p_project_id;

  -- 4) Audit explícito. Hoy no hay trigger de audit para `projects.active`;
  --    el único trigger de audit sobre projects es `projects_log_priority_change`
  --    (migration 3). Si en el futuro aparece un trigger genérico, revisar
  --    duplicación.
  insert into public.audit_log (entity, entity_id, action, actor_id, diff)
  values (
    'project',
    p_project_id,
    'active_toggled',
    auth.uid(),
    jsonb_build_object('old', v_current_active, 'new', p_active)
  );

  return p_active;
end;
$$;

revoke all on function public.set_project_active(uuid, boolean) from public;
grant execute on function public.set_project_active(uuid, boolean) to authenticated;
```

Notas:

- **`returns boolean`** en vez de `void`: el endpoint devuelve el estado nuevo sin un segundo `select`. También documenta la semántica idempotente.
- **No usa `security barrier` explícito**: `security definer` + `search_path` acotado es el patrón del proyecto. Ver `reallocate_booking` para la referencia.
- **No usa `can_manage_booking`-equivalente**: `can_manage_booking` chequea PM del proyecto para reservas, no para toggles de `active`. Una helper `can_toggle_project_active` sería más indirección que el `select pm_id` directo. Si en el futuro aparece otra operación con el mismo criterio, se extrae el helper.
- **`v_pm_id is null`** detecta proyecto inexistente antes del chequeo de permisos — un atacante no distingue "no existe" de "no tenés permiso" solo por el código de error (mismo mensaje de error legible, pero el handler lo mapea distinto por `errcode`).
- **Códigos de error**: `DC010` para "proyecto no encontrado" (libre; la familia `DC00x` se usa en `reallocation.sql`), `42501` para "insufficient privilege" (SQL estándar).

---

## 4. API surface

**Nuevo endpoint:**

| Método | Ruta | Body | Response | Guard |
| :---- | :---- | :---- | :---- | :---- |
| POST | `/api/projects/[id]/active` | `{ active: boolean }` | 200 `{ active: boolean }` \| 400/403/404/500 | `requireProjectMembership(id, 'pm')` |

**Sin cambios** en:
- `PATCH /api/projects/[id]` — sigue siendo admin-only; su `active` optional en el schema queda, pero no es el camino del PM.
- `POST /api/projects` — admin-only, sin cambios.
- Resto de endpoints de proyectos (`/members`, etc.).

**Shape del handler:**

```typescript
// src/app/api/projects/[id]/active/route.ts
import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api/read-json";
import { requireProjectMembership } from "@/lib/api/require-project-membership";
import { setProjectActiveSchema } from "@/lib/validation/projects";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await requireProjectMembership(id, "pm");
  if (!guard.ok) return guard.response;

  const parsed = setProjectActiveSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { data, error } = await guard.supabase.rpc("set_project_active", {
    p_project_id: id,
    p_active: parsed.data.active,
  });

  if (error) {
    // DC010 → 404, 42501 → 403, resto → 500
    if (error.code === "DC010") {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "Solo admin o PM primario puede cambiar el estado" },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ active: data });
}
```

**Validación Zod** nueva (append a `src/lib/validation/projects.ts`):

```typescript
export const setProjectActiveSchema = z.object({
  active: z.boolean(),
});
export type SetProjectActiveInput = z.infer<typeof setProjectActiveSchema>;
```

---

## 5. Componentes

### Nuevos

- **`src/lib/projects/url.ts`** — helpers para parsear/serializar el estado del listado:

  ```typescript
  export type ProjectsListUrl = {
    q: string;                                    // default: ""
    active: "on" | "all";                         // default: "on"
    sort: "key" | "name" | "client" | "pm" | "status";  // default: "name"
    dir: "asc" | "desc";                          // default: "asc"
  };

  export function parseProjectsUrl(sp: URLSearchParams): ProjectsListUrl;
  export function projectsHref(current: ProjectsListUrl, patch: Partial<ProjectsListUrl>): string;
  ```

  Mismo patrón que `src/lib/calendar/url.ts`: valores iguales al default no se escriben; parser nunca tira (cae a defaults).

- **`src/lib/projects/filter-sort.ts`** — funciones puras exportables para test unitario sin JSX:

  ```typescript
  export function filterProjects(
    projects: ProjectListRow[],
    opts: { q: string; onlyActive: boolean },
  ): ProjectListRow[];

  export function sortProjects(
    projects: ProjectListRow[],
    sort: ProjectsListUrl["sort"],
    dir: ProjectsListUrl["dir"],
  ): ProjectListRow[];
  ```

  Buscador: `.normalize("NFD").replace(/\p{Diacritic}/gu, "")` antes del `toLowerCase().includes()` para que "Córdoba" matchee "cordoba". Sort: `Intl.Collator("es-AR", { sensitivity: "base" })` para locale-aware.

### Modificados

- **`src/lib/projects/workspace.ts`** (`getVisibleProjects`):
  - Sacar `openTicketCount` del tipo `ProjectListRow`.
  - Sacar la segunda query sobre `tickets` (líneas 77-89 aprox).
  - La query principal queda igual (orden por `name` ASC se mantiene como base — el client re-ordena si el usuario cambia el sort).

- **`src/app/(app)/projects/page.tsx`** (server component):
  - Pasa `currentUserId={profile.id}` y `isAdmin={isAdmin(profile.roles)}` al `<ProjectList>`.

- **`src/components/projects/project-list.tsx`** (pasa a `"use client"`):
  - Nuevas props: `currentUserId: string`, `isAdmin: boolean`.
  - Estado: `useSearchParams()` + `useRouter().replace()` para persistir cambios.
  - Toolbar nueva arriba de la tabla: `<Input>` del buscador (debounce 200 ms) + `<Switch>` "Solo activos".
  - Headers clickeables con íconos `ArrowUp`/`ArrowDown`/`ArrowUpDown` (lucide-react).
  - Columna de acciones nueva: botón "Ver" (navega con `router.push`), botón "Activar/Desactivar" condicionado por `isAdmin || project.pm?.id === currentUserId`.
  - Fila **ya no es `cursor-pointer`** ni envuelve link.
  - Error inline en la toolbar cuando el toggle falla (`<p role="alert" />` arriba de la tabla).

- **`src/lib/validation/projects.ts`** — append del `setProjectActiveSchema`.

### Sin cambios

- `<RecordStatus>` — mismo badge Activo/Inactivo.
- `<EmptyState>` — se reusa con mensajes y acciones distintas según `q` y `active`.
- `getProjectByKey()` — no se toca.
- `requireProjectMembership()` — ya acepta `minRole: "pm"`, perfecto para el guard del nuevo endpoint.

---

## 6. Plan por phases

### Phase 1 — RPC + endpoint (silencioso)

1. Migration 25 `set_project_active_rpc.sql` con la RPC + `revoke/grant`.
2. Append de `setProjectActiveSchema` en `src/lib/validation/projects.ts`.
3. Nuevo handler `src/app/api/projects/[id]/active/route.ts`.
4. Tests de integración de la RPC: (a) admin togglea cualquier proyecto, (b) PM primario togglea el suyo, (c) PM primario ajeno falla con `42501`, (d) miembro contributor+ falla con `42501`, (e) toggle a mismo estado es no-op (sin fila nueva en `audit_log`).
5. Tests unit del endpoint: 400 con body mal, 404 con proyecto inexistente, 403 con PM ajeno, 200 con admin + PM primario.
6. `pnpm db:push` + deploy.

**Al final de Phase 1**: nadie llama el endpoint. El sitio sigue igual visualmente. La RPC está lista.

### Phase 2 — UI del listado

1. `src/lib/projects/url.ts` — parser + serializer + tests unit.
2. `src/lib/projects/filter-sort.ts` — funciones puras + tests unit (case-insensitive, acentos, locale-aware).
3. Refactor de `getVisibleProjects` — sacar `openTicketCount` + la segunda query.
4. Refactor de `<ProjectList>` a client — toolbar + sort + columna de acciones.
5. Ajuste de `page.tsx` para pasar `currentUserId` + `isAdmin`.
6. Verificación manual (ver §7).

**Al final de Phase 2**: la feature está completa en producción.

Phase 1 y Phase 2 son **mergeables independiente** si se prefiere arrastrar menos cambios por PR. También se pueden mergear juntos — no hay dependencia de datos entre ambas (la RPC no espera UI, la UI no espera migration de datos).

---

## 7. Testing

### Unit (`tests/unit/`)

- **`projects-url.test.ts`** — parser tolerante (query malformada → defaults), serializador no escribe defaults, round-trip estable.
- **`projects-filter-sort.test.ts`** — filtro: match por nombre, por cliente, case-insensitive, acentos normalizados; sort: locale `es-AR` ordena "Ñ" después de "N", `dir="desc"` invierte.
- **`project-list-permissions.test.ts`** — función pura `canToggleActive(isAdmin, project.pm?.id, currentUserId)` → true si admin o si pm_id matchea.
- **`set-project-active-payload.test.ts`** — shape del body que manda el `<ProjectList>` al endpoint.

### Integración (`tests/integration/`, CI)

- `set_project_active_rpc.test.ts`:
  - Admin togglea proyecto A → fila en `audit_log` con `action='active_toggled'`, diff correcto.
  - PM primario de proyecto A togglea A → OK.
  - PM primario de proyecto B intenta togglear A → `42501`.
  - Contributor de proyecto A intenta togglear A → `42501`.
  - Toggle de true→true: `audit_log` no suma fila.
  - Proyecto inexistente → `DC010`.
  - PM primario con `profile.active=false` → `42501` (porque `has_role('pm')` incluye `and active`).

### Smoke (`tests/smoke/`, CI)

- `POST /api/projects/[id]/active` con 403, 404, 400, 200 — misma matriz que la RPC pero via HTTP.

### Manual (pre-merge)

- `/projects` como admin: ver todos, togglear cualquiera, buscador funciona, orden funciona, columna de tickets desapareció.
- `/projects` como PM primario de X: ver mis proyectos, togglear X (OK), **no ver** toggle en proyectos ajenos.
- `/projects` como miembro contributor: no ver toggle en ningún proyecto.
- Buscar "arg" → filtra proyectos y clientes que empiezan con "arg".
- Switch apagado → aparecen inactivos tenues.
- Click header "Cliente" dos veces → asc, desc.
- Reload la página con `?q=foo&sort=client&dir=desc` → estado restaurado.

---

## 8. Riesgos y mitigaciones

- **R-1 (del spec) — PM se desactiva a sí mismo**: no aplica (toggle es de proyectos).
- **R-2 — RPC con escalada de privilegios**: cubierto por los 4 tests de integración de autorización (admin, PM propio, PM ajeno, contributor).
- **R-3 — Buscador en cliente con 200+ proyectos**: hoy no se da. Documentado para evaluar virtualización después.
- **R-4 — `router.replace` genera historial excesivo**: `.replace` (no `.push`) + debounce 200 ms.
- **R-5 — PM primario desactivado**: `has_role('pm')` incluye `and active`, verificado en test de integración (f).
- **R-6 — Proyecto sin forma de reactivarse**: admin siempre lo ve (admin no tiene filtro de participación), siempre tiene el toggle.
- **R-7 — Pérdida del patrón "fila clickeable"**: intencional. El botón "Ver" aparece a la derecha; patrón consistente con `/admin/projects`.
- **R-8 (nuevo) — El refactor de `<ProjectList>` a client rompe el SSR del listado**: el SSR sigue trayendo los datos; el client los recibe por props. Es el mismo patrón de `<ProjectsTable>` admin. **Mitigación**: el `page.tsx` sigue siendo server component y pasa `projects` ya materializado como prop. El loading state usa `loading.tsx` existente.
- **R-9 (nuevo) — `getVisibleProjects` consumido por otros lugares**: `grep -r "getVisibleProjects"` del repo. Si solo lo usa `/projects/page.tsx`, el cambio es local. **Mitigación**: verificar antes de Phase 2 paso 3.
- **R-10 (nuevo) — El `router.refresh()` después del toggle no refresca el `<ProjectList>` client porque los datos vienen por props**: el server component se re-renderiza con los datos nuevos, los pasa de nuevo como props, el client recibe el nuevo array. Patrón estándar de Next 15 — se usa en `/admin/projects` hoy. **Mitigación**: cero. Es el flujo canonical.
- **R-11 (nuevo) — El toggle optimista desincroniza si el server rechaza**: el patrón es `router.refresh()` después de 200. Si falla, no se refresca y se muestra error inline (AC-5.6). No hay optimistic update — se espera la respuesta antes de cambiar la fila.

---

## 9. Decisiones de diseño (ADRs referenciados, no nuevos)

- **D-1 — RPC `security definer` en vez de policy nueva + trigger de columnas** (ADR 0010). Una policy "PM primario toggles active" + trigger que impida escribir otras columnas sería más superficie para el beneficio chico de togglear una columna. La RPC acotada expresa el permiso una sola vez, en un solo lugar, y es simétrica al patrón `reallocate_booking`.
- **D-2 — `requireProjectMembership(id, 'pm')` como guard del endpoint**: ya existe (desde `015`), ya acepta "admin O PM primario", ya devuelve el `supabase` cliente para encadenar la RPC. Reusarlo es cero código nuevo de guard.
- **D-3 — Audit explícito en la RPC, no trigger**: hoy no hay trigger de audit sobre `projects.active`. Un trigger genérico "cualquier update de projects" dispararía también para cambios de nombre, PM, etc., y mezclaría acciones. Mantener el audit atado al evento específico (`active_toggled`) es más legible y no exige diferenciar `TG_OP` en el trigger.
- **D-4 — Estado del listado en search params**: convención del proyecto para vistas filtrables (`/calendar`, `/planning`). Hace la vista compartible, el botón "atrás" funciona, y no hay estado React a sincronizar.
- **D-5 — Buscador en cliente**: la lista base ya viene materializada del server (menos de 50 filas en todos los equipos actuales); un buscador en server exigiría re-fetchear por cada tecla + skeleton + spinner. Overhead no justificado.
- **D-6 — Fila ya no es clickeable (US-4)**: decisión del usuario. Consistente con `/admin/projects`. Riesgo R-7 anotado.
- **D-7 — Switch "Solo activos" encendido por default**: decisión del usuario (US-3). El default refleja el caso común (trabajás con lo vivo); los históricos se ven apagando el switch.
- **D-8 — No pedir confirmación para el toggle**: consistente con `/admin/projects` hoy. Un proyecto desactivado se puede reactivar con un click (no se pierde dato). Si el usuario pide confirmación más tarde, es un cambio de UI local, no de modelo.

---

## 10. Notas

- **Sin ADR nuevo.** Las decisiones son aplicaciones de ADRs existentes (0010, 0011).
- **Sin dos fases de migration.** La RPC es puramente aditiva: su existencia no rompe código viejo (nadie la invoca hasta que Phase 2 agregue el endpoint y la UI). El schema de la tabla no cambia.
- **Impacto en performance**: `getVisibleProjects` **mejora** (una query agregada menos). El resto es client-side.
- **Compatibilidad con 015 (phases 9-10 abiertas)**: ninguna. `015` toca `project_members` y `tickets`; esta feature toca `projects` (solo via RPC) y el UI del listado.
- **El `tasks.md` queda abierto** hasta que arranque la implementación.
