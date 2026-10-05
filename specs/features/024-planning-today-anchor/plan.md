# Plan — Planning: la semana de hoy queda como la última de las 4 visibles

- **ID:** 024-planning-today-anchor
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `011-planning-view` (dueño del `case "planning"` de `viewBounds`, de la grilla `<PlanningView>`). `003-calendar-ui` (dueño del toolbar, del botón "Hoy", del schema de URL).

---

## 1. Resumen técnico

Feature de una tarde. Un cambio de cómputo puro en TypeScript. Tres archivos tocados:

1. **`src/lib/calendar/range.ts`** — sumar parámetro opcional `today` a `viewBounds` y a `resolveRange`. En `case "planning"`, si `isoDate === today`, el ancla pasa a `mondayOf(today) - 21` en vez de `mondayOf(today)`.
2. **`src/app/(app)/calendar/page.tsx`** — pasar `today` (ya computado en la línea 99) a los tres call sites: `resolveRange` (línea 103), `viewBounds("planning", ...)` (línea 211), `viewBounds(view, ...)` (línea 239, aunque solo Planning lo consume).
3. **`tests/unit/range.test.ts`** — sumar casos para la nueva regla: `date === today` desplaza 3 semanas atrás; `date !== today` no cambia nada; caso borde lunes y domingo.

Cero migration, cero cambios de UI, cero cambios en API, cero cambios en el botón "Hoy" (sigue linkeando a `date=today` — lo que cambia es cómo esa fecha se interpreta en el cómputo del rango).

### Qs de la spec cerradas en el plan

- **Q-1 · Comparación `isoDate === today` como string:** **sí**. Los dos son `YYYY-MM-DD` en la misma TZ (viewer's), garantizado por `todayInTimeZone(TIMEZONE)` en `page.tsx:99`. Comparación por string es determinista.
- **Q-2 · Firma de `viewBounds`:** **`viewBounds(view, isoDate, opts?: { today?: string })`.** Se mantiene pura — el call site pasa `today` explícitamente. Compatible hacia atrás: sin `opts.today` el comportamiento es idéntico al actual.
- **Q-3 · Documentación de la regla:** **JSDoc en el case "planning"** con el "por qué" (§2 de la spec). Un comentario breve al lado del `if (opts?.today === isoDate)` remite al JSDoc para el detalle.
- **Q-4 · Link compartido "hoy" abierto al día siguiente:** **aceptado** — comportamiento AC-11. El link a `?date=2026-09-21` respeta esa fecha; solo `date == hoy del viewer` dispara la regla. Nada que implementar.

---

## 2. Cambio en `src/lib/calendar/range.ts`

Ubicación exacta del cambio: función `viewBounds`, líneas 171-191 del archivo actual. Sumar el parámetro y el offset condicional.

### 2.1 Firma y JSDoc

```ts
/** Local calendar bounds of a view, as `[fromDate, toDateExclusive)`. */
export function viewBounds(
  view: CalendarView,
  isoDate: string,
  opts?: { today?: string },
): [string, string] {
  switch (view) {
    case "day":
      return [isoDate, addDays(isoDate, 1)];
    case "month": {
      const start = startOfMonth(isoDate);
      return [start, addMonths(start, 1)];
    }
    case "year": {
      const start = startOfYear(isoDate);
      return [start, addYears(start, 1)];
    }
    case "planning": {
      // 4 semanas ancladas al lunes de la semana de `isoDate`.
      //
      // Regla 024: cuando el ancla es "hoy" (botón "Hoy" del toolbar, o URL
      // sin `?date` que cae al default), la semana en curso se muestra como
      // la ÚLTIMA de las 4 filas — no la primera. El PM ve 3 semanas atrás +
      // esta semana, que es el contexto natural para decidir dónde meter
      // carga nueva. Se dispara sólo cuando `isoDate === opts.today` (la
      // fecha activa es literalmente hoy en la TZ del viewer). Cualquier
      // otra fecha (link compartido, navegación con ▶/◀) mantiene el
      // anclaje clásico "mondayOf(isoDate) es la primera fila".
      const monday = mondayOf(isoDate);
      const start = opts?.today === isoDate ? addDays(monday, -21) : monday;
      return [start, addDays(start, 28)];
    }
  }
}
```

**Decisiones:**

- **`opts?` opcional:** no rompe call sites que no lo pasan. `Day/Month/Year` no lo consumen — se lo pueden pasar y no cambia nada (lo ignora el `switch`).
- **`isoDate === today` como string:** determinista. Ambos strings vienen del mismo formato (`YYYY-MM-DD`) y de la misma TZ (`todayInTimeZone(TIMEZONE)`).
- **El comentario cita "Regla 024":** el próximo lector que llegue al archivo entiende de dónde salió el `if` y por qué no es un bug. Cf. R-2 de la spec.

### 2.2 `resolveRange` — misma extensión

`resolveRange` (líneas 198-208) invoca `viewBounds` internamente. Se extiende:

```ts
export function resolveRange(
  view: CalendarView,
  isoDate: string,
  tz: string,
  opts?: { today?: string },
): CalendarRange {
  const [fromDate, toDate] = viewBounds(view, isoDate, opts);
  return {
    from: zonedToInstant(fromDate, tz).toISOString(),
    to: zonedToInstant(toDate, tz).toISOString(),
  };
}
```

Sin cambios de lógica — solo forward del `opts`.

### 2.3 Fuera del cambio

- **`shiftDate` (líneas 210-222)** no se toca. AC-6/AC-7 de la spec: al clickear ▶ o ◀ desde "hoy en la última fila", el nuevo `date` sale de `shiftDate('planning', today, ±1)` = ±28 días, y **la regla no se retroaplica** (porque el nuevo `date` ya no es `today`). Sale barato: no hay que agregar nada.
- **`DEFAULT_DAY_WINDOW`, `visibleDayWindow`, `mondayOf`, `todayInTimeZone`**: no se tocan.

---

## 3. Call sites a actualizar

Tres invocaciones en `src/app/(app)/calendar/page.tsx`. `today` ya está calculado en la línea 99 (`const today = todayInTimeZone(TIMEZONE)`), así que solo se pasa como opts.

### 3.1 `page.tsx:103` — `resolveRange`

```ts
// Antes:
const range = resolveRange(params.view, params.date, TIMEZONE);
// Después:
const range = resolveRange(params.view, params.date, TIMEZONE, { today });
```

**Importante:** este `range` alimenta las queries a la base (`getBookingsInRange`, `getDayLoad`, etc.). Si la regla desplaza el rango, las queries también traen las reservas del rango correcto — no hay chance de un desalineo entre "lo que la grilla renderiza" y "lo que se fetcheó" (que sería un bug clásico).

### 3.2 `page.tsx:211` — `viewBounds("planning", ...)`

```ts
// Antes:
const [from, to] = viewBounds("planning", params.date);
// Después:
const [from, to] = viewBounds("planning", params.date, { today });
```

Este `[from, to]` alimenta el `eachDay(from, to)` que genera el arreglo de 28 días para la grilla. Con la regla aplicada, los 28 días son 3 semanas pasadas + la semana en curso.

### 3.3 `page.tsx:239` — `viewBounds(view, ...)` (month/year)

```ts
// Antes:
const [from, to] = viewBounds(view, params.date);
// Después:
const [from, to] = viewBounds(view, params.date, { today });
```

**Consistencia:** pasar `today` a los tres call sites, aunque el `switch` de month/year lo ignore. Evita que un lector futuro se pregunte "¿por qué acá sí y allá no?" y evita el bug latente si alguien reordena el switch. Costo: cero.

### 3.4 Fuera del cambio

- **`src/app/(app)/inbox/page.tsx:36`** invoca `parseCalendarParams({}, { today: ... })`, no `viewBounds` ni `resolveRange`. No se toca.
- **`src/lib/calendar/format.ts:64`** solo comenta sobre `viewBounds("planning", ...)` en un docstring — no lo invoca. No se toca.

---

## 4. Tests

`tests/unit/range.test.ts` ya tiene un `describe("viewBounds(planning)", ...)` en las líneas 132-139 con un solo caso. Se **agregan** casos sin borrar el existente (que sigue siendo válido — cubre `date !== today`).

### 4.1 Casos nuevos

```ts
describe("viewBounds(planning) with today anchor", () => {
  it("mantiene el ancla clásico cuando date !== today", () => {
    // Sin opts.today, o con opts.today distinto → mondayOf(isoDate) es la primera fila.
    const [from, to] = viewBounds("planning", "2026-05-13", { today: "2026-06-01" });
    expect(from).toBe("2026-05-11");
    expect(to).toBe("2026-06-08");
  });

  it("desplaza 3 semanas cuando date === today (miércoles)", () => {
    // Miércoles 2026-05-13 = today → lunes 2026-05-11 - 21 días = 2026-04-20.
    // 28 días después = 2026-05-18. La última fila (semanas 22-24) contiene hoy.
    const [from, to] = viewBounds("planning", "2026-05-13", { today: "2026-05-13" });
    expect(from).toBe("2026-04-20");
    expect(to).toBe("2026-05-18");
  });

  it("caso borde: today == lunes", () => {
    // Lunes 2026-05-11 = today → lunes de esa semana - 21 = 2026-04-20.
    const [from, to] = viewBounds("planning", "2026-05-11", { today: "2026-05-11" });
    expect(from).toBe("2026-04-20");
    expect(to).toBe("2026-05-18");
    // Lunes 2026-05-11 (= today) es el primer día de la 4ª fila.
  });

  it("caso borde: today == domingo", () => {
    // Domingo 2026-05-17 = today → mondayOf(2026-05-17) = 2026-05-11 → - 21 = 2026-04-20.
    const [from, to] = viewBounds("planning", "2026-05-17", { today: "2026-05-17" });
    expect(from).toBe("2026-04-20");
    expect(to).toBe("2026-05-18");
    // Domingo 2026-05-17 (= today) es el último día de la 4ª fila.
  });

  it("day/month/year ignoran opts.today (regla solo aplica a planning)", () => {
    // El mismo isoDate y opts.today, en day/month/year, deben dar los mismos bounds
    // que sin opts.today.
    expect(viewBounds("day",   "2026-05-13", { today: "2026-05-13" }))
      .toEqual(viewBounds("day",   "2026-05-13"));
    expect(viewBounds("month", "2026-05-13", { today: "2026-05-13" }))
      .toEqual(viewBounds("month", "2026-05-13"));
    expect(viewBounds("year",  "2026-05-13", { today: "2026-05-13" }))
      .toEqual(viewBounds("year",  "2026-05-13"));
  });
});
```

### 4.2 Fuera de tests

- **Sin tests de `resolveRange`** para el mismo caso: es un forward puro. Los tests existentes de `resolveRange` (líneas 21-50) siguen pasando sin cambios.
- **Sin tests E2E ni de integración.** El helper puro cubre la lógica; el resto es verificación visual (§6).

---

## 5. Migrations, deps, riesgos

- **Migrations:** cero.
- **Deps:** cero.
- **Riesgos:** R-1 a R-5 de la spec siguen vigentes. El plan no descubre riesgos nuevos.

---

## 6. Phases

Feature chica — una sola phase con 4 tareas ordenadas.

### Phase 1 — Cambio y verificación

- **T1.1** — Extender `viewBounds` y `resolveRange` en `range.ts` (§2).
- **T1.2** — Actualizar los 3 call sites en `page.tsx` (§3).
- **T1.3** — Sumar los casos de test en `range.test.ts` (§4).
- **T1.4** — `pnpm typecheck && pnpm lint && pnpm test:unit`. Verificación visual del usuario en el navegador (§7).
- **T1.5** — Cierre docs: `specs/features/README.md`, entrada en la sección "Convenciones de código" de `CLAUDE.md` (opcional, ver §7.2).
- **T1.6** — Merge `feature/024-planning-today-anchor` → `develop` → `main`.

---

## 7. Cierre

### 7.1 Verificación visual del usuario

- [ ] Voy a `/calendar?view=planning` sin `?date` → veo 3 semanas pasadas + esta semana (esta como 4ª fila).
- [ ] Clickeo "Hoy" desde otra vista (Day/Month/Year) → aterriza en Planning con la misma vista.
- [ ] Clickeo "Hoy" estando ya en Planning con una fecha lejana → vuelve al layout de 3 semanas pasadas + hoy.
- [ ] Clickeo ▶ una vez → salto a 4 semanas ancladas al lunes siguiente al del ancla actual (comportamiento normal, sin regla).
- [ ] Edito la URL a `/calendar?view=planning&date=2026-11-05` → 4 semanas ancladas al lunes de esa fecha (comportamiento clásico — la regla no aplica).
- [ ] Cambio a Day / Month / Year → "Hoy" me lleva a hoy tal como antes.
- [ ] Verifico que la fila con "hoy" tenga el highlight visual del día en curso (si `<PlanningView>` lo tiene hoy; si no, se anota como F1).

### 7.2 Docs

- **`specs/features/README.md`:** actualizar la fila 024 a `done (deployed YYYY-MM-DD)`.
- **`CLAUDE.md`:** decisión abierta — si se considera que la regla merece mención en "Convenciones de código > Vistas". Recomendación inicial: **no**. El JSDoc del case "planning" en `range.ts` cuenta el "por qué" en el lugar donde importa. Meter la explicación también en CLAUDE.md sería duplicar, y la responsabilidad de CLAUDE.md es lo que no se ve en el código — este cambio sí se ve.

Si más adelante aparecen preferencias por-usuario del anclaje (F1 abajo), ese sí es un caso donde CLAUDE.md merece un párrafo — porque el código va a tener una tabla nueva y un flag que hoy no existe.

### 7.3 Follow-ups (F)

Los mismos que la spec lista en §9 (Compatibilidad con features futuras). Repetidos acá en formato `Fn`:

- **F1** — Highlight visual explícito de "esta semana" en la grilla (fondo tenue o border en la 4ª fila cuando aplica la regla). Requiere que `<PlanningView>` reciba un flag `todayRowIndex: number | null` y colorear. Si el usuario prueba y le parece confuso "por qué la vista arranca 3 semanas atrás" (R-1), sumar. Fuera del MVP.
- **F2** — Preferencia por-usuario del anclaje (`profiles.planning_anchor text default 'today-last'`). Cuando aparezca el pedido.
- **F3** — Cambio del ancho de la ventana (a 6 semanas, a 8 semanas). Convertir el `28` de `range.ts:188` en constante y recalcular el `-21` como `windowDays - 7`. Feature aparte cuando aparezca.
- **F4** — Botón "Ir a esta semana" separado del "Hoy" en vistas Day/Month/Year. Sin pedido; se piensa cuando aparezca.
