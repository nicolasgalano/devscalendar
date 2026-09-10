# Plan — PMs fuera del calendario por default

- **ID:** 014-hide-pms-in-calendar
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `003-calendar-ui`, `011-planning-view`, `012-multiple-roles-and-active-enforcement`

---

## 1. Resumen técnico

**Cero migrations, cero policies, cero API routes.** La feature son cinco cosas:

- Un helper `isPmOnly(roles)` en `@/lib/auth/roles` que resuelve la definición del spec (**PM puro:** `roles = {'pm'}` sin `developer`) en un solo lugar.
- Un séptimo campo booleano `includePms` en `CalendarFilters`, con parseo en `parseCalendarParams` y escritura condicional en `calendarHref`.
- Una lectura de **IDs de PM puros** (una query a `profiles`) cacheada por request, que se inyecta en las dos queries que ven `dev_id`: `bookingsQuery` (todas las vistas) y `getDevDayLoad` (sobrecarga de planning).
- Un `.not("dev_id", "in", "(uuid,uuid,...)")` aplicado cuando `!includePms && !devId` — cuando hay `devId` explícito, la equality filter ya alcanza (AC-3.1).
- Un toggle en el panel de filtros y un badge en la etiqueta del filtro "dev" cuando el dev seleccionado es un PM puro y `includePms=0`.

El resto —facetas, dropdown, URL state— cae por gravedad porque el pipeline de facetas se deriva de los bookings ya filtrados (`facets.ts`).

### Decisiones heredadas que no se re-discuten

- **PM puro = `roles = {'pm'}` sin `developer`** (spec AC-1.1, Q-1 respondida). Un profile `{pm, developer}` es dev y aparece siempre.
- **Selección explícita gana** sobre el default (spec AC-3.1, Q respondida): si la URL trae `devId=<PM>`, se muestra.
- **El toggle nace off por request**, sin memoria entre sesiones (spec Q-3): coherente con el resto del URL-state del calendario.
- **`countConsideredDevs` ya usa `roles contains 'developer'`** (`query.ts:390`), no cambia — ya excluye a los PM puros del denominador de capacidad.

---

## 2. Arquitectura

```
src/lib/auth/roles.ts
  isPmOnly(roles)                helper único, base de todo el resto

src/lib/validation/calendar.ts
  CalendarFilters                 + includePms: boolean
  parseCalendarParams()           lee ?includePms=1 → true, ausente → false
  hasActiveFilters()              includePms=true cuenta como filtro activo

src/lib/calendar/url.ts
  calendarHref()                  escribe includePms=1 solo cuando true
  clearFiltersHref()              vuelve a includePms=false

src/lib/calendar/query.ts
  getPmOnlyDevIds()               nueva: profiles con roles={pm} y active
  bookingsQuery()                 aplica .not(dev_id,in,…) según reglas
  getDevDayLoad()                 idem para planning overload

src/components/calendar/
  calendar-filters.tsx            toggle "Incluir PMs" + badge en filtro dev
```

Nada nuevo en el schema, nada nuevo en la API, nada nuevo en RLS. La regla de "PM puro" es de UI y de query.

---

## 3. Modelo y datos

**Sin cambios de tabla.** La única fuente de verdad de "quién es PM puro" es `profiles.roles`, y la lectura vive en un helper:

```ts
// src/lib/calendar/query.ts
export const getPmOnlyDevIds = cache(async (supabase: Client): Promise<string[]> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, roles")
    .contains("roles", ["pm"])
    .eq("active", true);
  if (error) throw error;
  return (data ?? []).filter((p) => isPmOnly(p.roles)).map((p) => p.id);
});
```

- `.contains("roles", ["pm"])` filtra en la base — barato, hasta acá vienen PMs y PM+devs.
- `isPmOnly()` en JS descarta a los `{pm, developer}` porque PostgREST no tiene "contiene X y no contiene Y" en un filtro.
- `cache()` de React deduplica la llamada dentro del mismo request (mismo patrón que `getCurrentUser()` en `@/lib/supabase/session`, ver CLAUDE.md §Rutas y permisos).
- Solo `active=true`: un PM desactivado ya no está en el equipo, no queda ni con ni sin toggle.

**Por qué no un embed** (`dev:profiles!bookings_dev_id_fkey (id, full_name, email, roles)`): traería `roles` por cada booking, y después habría que filtrar en JS después de traer todo. Con la lista de IDs upfront la exclusión pasa a ser un filtro más de PostgREST y no crece con el número de bookings.

---

## 4. Cambio de contratos

### `CalendarFilters` (nuevo campo)

```ts
type CalendarFilters = {
  clientId: string | null;
  projectId: string | null;
  devId: string | null;
  pmId: string | null;
  statuses: BookingStatus[];
  priority: ProjectPriority | null;
  includePms: boolean;   // ← nuevo
};
```

### URL param

- **`includePms=1`** → `true`. Cualquier otro valor (incluida la ausencia) → `false`.
- El default (`false`) no se escribe en la URL, siguiendo la convención existente.
- El parser no tira: `?includePms=asdf` → `false`.

### `bookingsQuery` — filtro nuevo

```ts
async function bookingsQuery(supabase, columns, range, filters) {
  let query = supabase.from("bookings").select(columns)…;

  if (filters.devId) query = query.eq("dev_id", filters.devId);
  // ... otros filtros existentes ...

  // AC-1.1 + AC-3.1: excluir PM puros salvo que haya devId explícito
  // (en cuyo caso la equality de arriba manda: si es un PM, se ve; si no,
  // no aparece por ser el otro dev, no por el toggle).
  if (!filters.includePms && !filters.devId) {
    const pmOnlyIds = await getPmOnlyDevIds(supabase);
    if (pmOnlyIds.length > 0) {
      query = query.not("dev_id", "in", `(${pmOnlyIds.join(",")})`);
    }
  }

  return query.order("starts_at");
}
```

**Por qué acá y no en el `select` con `!inner` sobre roles:** PostgREST no permite "array no contiene X" en un embed inner de forma directa, y sí soporta `not.in` sobre columnas planas. Además la lista de PMs es corta (típicamente < 10) y el `in` list es barato.

### `getDevDayLoad` (planning overload)

Mismo tratamiento que `bookingsQuery` — la sobrecarga se calcula sobre devs, no sobre PMs. Un PM haciendo 8h de reuniones no es carga del equipo (spec AC-1.3).

---

## 5. Superficie de UI

### Panel de filtros

Un toggle nuevo al lado del `<Select>` de dev, del mismo estilo que los otros controles (ver `DESIGN.md` §7). Cuando `includePms=true`, la etiqueta del select de dev suma "(incluye PMs)" o similar — detalle final en la implementación siguiendo `DESIGN.md`.

### Filtro dev con PM seleccionado

Cuando `filters.devId` apunta a un PM puro y `filters.includePms=false`, el select tiene que:
- Mostrar el nombre del PM (viene del facet, que si el PM tiene bookings visibles lo va a incluir porque el filtro se salta cuando hay `devId` — ver §4).
- Marcarlo con un badge "PM" para que sea obvio por qué "solo aparece esta persona" (spec AC-3.2).

### Desplegable dev

Naturalmente excluye a los PMs cuando `includePms=false`, porque las facetas se derivan de los bookings ya filtrados (`facets.ts:deriveFacets`). No hay lógica extra: la faceta pregunta "de los bookings que veo, qué devs distintos hay". Si los bookings de PMs no están, los PMs no están en la faceta.

**Excepción:** si `filters.devId` es un PM puro, ese PM va a aparecer en el dropdown porque la equality filter lo dejó pasar. Es lo esperado — necesita estar en las opciones para que "quitar el filtro" sea posible.

---

## 6. Riesgos y mitigaciones

- **R-1: la definición de "PM puro" queda duplicada.** Si `bookingsQuery` y el helper del dropdown deciden distinto quién es PM, aparece un dev en el dropdown sin bookings o al revés. **Mitigación:** ambos van por `getPmOnlyDevIds()` → `isPmOnly()`. Una sola definición, un test que la ejercite.
- **R-2: la lista de PMs se stale-ea entre requests.** Si un admin cambia los roles de alguien mientras el usuario tiene la pestaña abierta, el próximo render puede mezclar. **Mitigación:** `cache()` es por request (React), no persistente — se refresca en cada navigation. Aceptable: es el mismo comportamiento que el resto del calendario.
- **R-3: `.not("dev_id", "in", "()")` con lista vacía es sintaxis inválida en PostgREST.** **Mitigación:** el `if (pmOnlyIds.length > 0)` de §4 lo evita.
- **R-4: `hasActiveFilters()` decide entre "empty state" y "no results" (`003` AC-9).** Si `includePms=false` no cuenta como filtro activo, un equipo con solo PMs vería "no hay reservas" en vez de "estás filtrando". **Mitigación:** `includePms` cuenta como filtro activo cuando `true` — pero cuando es `false` (el default) no cuenta, coherente con el resto de los defaults. Un equipo donde el único que carga horas es un PM puro no es un caso realista y no cambia el UX de nadie.
