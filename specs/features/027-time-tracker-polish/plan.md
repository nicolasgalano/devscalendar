# Plan — Time tracker: polish + start del cronómetro

- **ID:** 027-time-tracker-polish
- **Estado:** draft
- **Spec de referencia:** `./spec.md`

---

## 1. Resumen técnico

Tres fixes locales al `<TimeEntryDialog>` (una X menos; `__none__` que no se filtra; buscador en los selectores de proyecto y ticket) + un `<TimerStartDialog>` nuevo que reusa esos selectores y conecta el botón "Iniciar cronómetro" de `/my-time` a los endpoints `/api/time-entries/timer/{start,stop}` que `016` dejó listos pero sin UI. Cero migrations, cero endpoints nuevos, cero deps nuevas (si el combobox se arma con 50 líneas; evaluar `cmdk` solo si se complica).

---

## 2. Arquitectura

```
/my-time (page)
  │
  ├─ <WeeklyGridView>
  │    toolbar:
  │    [ Cargar tiempo ]  ← abre <TimeEntryDialog mode="create">
  │    [ Iniciar cronómetro ]  ← abre <TimerStartDialog> (nuevo)
  │                              - BOTÓN YA EXISTE pero `disabled`
  │
  └─ <TimerPill> (shell / AppShell)
       - hidrata active_timers al cargar
       - stop → POST /api/time-entries/timer/stop → router.refresh()
       - sin cambios en esta feature

┌────────────────────────────────────────────────────────────┐
│ <TimeEntryDialog>  (existente, 3 fixes)                    │
│                                                             │
│  Header:                                                    │
│   [fecha] [user] [X]  ← ANTES: dos X; AHORA: una           │
│                                                             │
│  Horas trabajadas:                                          │
│   [desde] - [hasta] [duración]                             │
│                                                             │
│  Proyecto y tarea:                                          │
│   [+ Proyecto]           ← AHORA: popover con buscador     │
│   [+ Tarea]              ← igual que antes (lista corta)    │
│   [+ Ticket (opcional)]  ← AHORA: popover con buscador     │
│                              + placeholder correcto         │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ <TimerStartDialog>  (nuevo)                                 │
│                                                             │
│  Header:                                                    │
│   "Iniciar cronómetro" [X]                                 │
│                                                             │
│  Proyecto y tarea:                                          │
│   [+ Proyecto]  ← REUSAR <SearchableSelector>              │
│   [+ Tarea]                                                 │
│   [+ Ticket (opcional)]                                     │
│                                                             │
│  [Cancelar]  [Iniciar]                                      │
└──────────────────────────┬─────────────────────────────────┘
                           │ POST
                           ▼
                 /api/time-entries/timer/start
                 (ya existe desde 016, sin cambios)
                           │
                           ▼
                     INSERT active_timers
                           │
                           ▼
                 router.refresh() → <TimerPill> aparece
```

---

## 3. Modelo de datos

**Nada.** Cero migrations, cero cambios de schema, cero RLS. La feature es puramente de UI + wiring a endpoints existentes.

---

## 4. API surface

**Nada nuevo.** Se reusan:

| Método | Ruta | Uso en esta feature |
| :---- | :---- | :---- |
| POST | `/api/time-entries` | Submit del `<TimeEntryDialog>` — ya existente, sin cambios |
| POST | `/api/time-entries/timer/start` | **Nuevo call site** desde `<TimerStartDialog>` |
| POST | `/api/time-entries/timer/stop` | Ya invocado por `<TimerPill>`, sin cambios |

El contrato de `timer/start` (desde `016`) acepta `project_id`, `activity_id`, `ticket_id` opcional. Lo que mande el `<TimerStartDialog>` coincide con lo que `/api/time-entries/timer/start/route.ts` ya espera.

---

## 5. Componentes

### Nuevos

- **`<TimerStartDialog>`** (`src/components/time-entries/timer-start-dialog.tsx`): dialog chico con los 3 selectores (proyecto / tarea / ticket). Botones "Cancelar" / "Iniciar". POST al endpoint; en caso de 409 muestra inline "Ya hay un cronómetro corriendo. Paralo desde la pill superior antes de iniciar otro". En caso de 201, cierra + `router.refresh()`.

- **`<SearchableSelector>`** (`src/components/time-entries/searchable-selector.tsx`): combobox genérico que reemplaza al `<SelectorRow>` del `<TimeEntryDialog>` cuando la lista pasa de ~5 items. Props: `items: { id, label, meta? }[]`, `value`, `onChange`, `placeholder`, `searchPlaceholder`, `emptyMessage`. Mantiene la misma API visual que `<SelectorRow>` (ícono `+` a la izquierda del valor) para que el fix sea un drop-in.

  - **Implementación inicial sin `cmdk`:** Base UI `<Popover>` + `<Input>` + lista filtrada con un `useMemo` que corre un `.toLowerCase().includes(query.toLowerCase())` sobre `label + meta`. Si crece el requerimiento (keyboard nav con flechas, highlight de match), reemplazar por `cmdk` en Phase 2.

### Modificados

- **`<TimeEntryDialog>`** (`src/components/time-entries/time-entry-dialog.tsx`):
  1. Eliminar el `<button>` custom con `<XIcon>` (líneas 227-234). Confiar en la X default del `<DialogContent>` de shadcn.
  2. Cambiar el `<SelectorRow>` del selector de proyecto y de ticket por `<SearchableSelector>`. El selector de tarea queda como `<SelectorRow>` (listas chicas, no justifica el combobox).
  3. Investigar + fixear el `__none__` que aparece en el ticket. Primera hipótesis de fix: en vez de setear `value={form.ticketId ?? NO_TICKET}` siempre, setear `value={form.ticketId ?? ""}` cuando no hay elección — un `""` deja que `<SelectValue>` caiga a su `placeholder` sin ambigüedad. El `onChange` convierte `""` a `null`. **Si eso no alcanza**, override del `display` prop para que SIEMPRE devuelva algo definido cuando no hay ticket (ej. `undefined` explícito y chequear que el componente respete `placeholder`).

- **`<WeeklyGridView>`** (`src/components/time-entries/weekly-grid-view.tsx:238`):
  1. Sacar el `disabled title="Próximamente"` del botón "Iniciar cronómetro".
  2. Agregar `onClick` que abre el nuevo `<TimerStartDialog>`.
  3. Preservar la lógica de `isViewingOther` para seguir deshabilitando cuando se mira a otro usuario.

### Sin cambios

- `<TimerPill>` — ya hidrata `active_timers` y hace el stop correctamente.
- `<TimerPill>` dispatch al cargar la página — ya es parte del shell.
- Endpoints `timer/start` y `timer/stop` — contratos ya existentes de `016`.

---

## 6. Plan por phases

**Phase 1 — Fixes cosméticos del dialog (3 bugs):**

1. Eliminar el X duplicado del `<TimeEntryDialog>`.
2. Fixear el `__none__` visible — probar hipótesis `value={... ?? ""}` primero; si no cierra, debug en browser y aplicar workaround.
3. Crear `<SearchableSelector>` genérico (sin cmdk, basado en Popover + Input + filtro `useMemo`).
4. Reemplazar los dos selectores (proyecto + ticket) por `<SearchableSelector>` en el dialog existente.
5. Tests unit: filtro case-insensitive, substring match, lista vacía.

Deploy independiente. Al final de Phase 1 el equipo ya tiene los 3 bugs resueltos.

**Phase 2 — Botón "Iniciar cronómetro" funcional:**

1. Crear `<TimerStartDialog>` reutilizando `<SearchableSelector>`.
2. Conectar el botón de `<WeeklyGridView>` al nuevo dialog.
3. Manejar los códigos 201 / 409 / otros errores con mensajes claros.
4. Tests unit del dialog (shape del payload que se manda al endpoint).
5. Verificación manual: start desde `/my-time` → `<TimerPill>` aparece → stop → `time_entry` cerrada en la planilla.

Deploy independiente. Fin de la feature.

---

## 7. Testing

- **Unit (`tests/unit/`):**
  - `searchable-selector.test.ts`: filtro case-insensitive, sin match → mensaje, cambia value, placeholder cuando `value === null`.
  - `timer-start-payload.test.ts`: shape del body que se manda a `/api/time-entries/timer/start` dado un estado del dialog.
- **Manual** (pre-merge en producción):
  - Buscador: tipear nombre parcial de proyecto filtra correctamente; sin match muestra "No se encontraron proyectos".
  - X: hay una sola X en el dialog; cierra bien con click + con Esc.
  - Ticket: elegí un proyecto con tickets → el selector cerrado muestra "Elegí un ticket (opcional)", no `__none__`.
  - Timer: elegir proyecto + tarea + (opcional) ticket → "Iniciar" → `<TimerPill>` aparece con el nombre correcto → "Parar" → la `time_entry` queda cargada en la grilla.

---

## 8. Riesgos y mitigaciones

- **R-1 (del spec) — Combobox rompe algo del Base UI:** la implementación es Popover + Input, patrones que el proyecto ya usa (ver `<MentionList>` de 022). Si aparece un bug de foco o aria, el componente queda contenido y el fix es local.
- **R-2 (del spec) — `__none__` es bug del preset Nova:** cubierto en el plan Phase 1 paso 2 (fallback a `""` o workaround con `display` forzado). En peor caso, documentar el workaround y moverlo a deuda.
- **R-5 (nuevo) — Payload del dialog difiere del que espera `/api/time-entries/timer/start`:** mitigado con el test `timer-start-payload.test.ts` que valida el shape antes de llegar a producción.

---

## 9. Notas

- Esta feature es un buen candidato para arrancar sin tests exhaustivos (son dos fixes cosméticos + un dialog que llama a un endpoint ya testeado por `016`). El cuidado va en la verificación manual del usuario post-deploy.
- Si el usuario quiere mergearlo todo junto, Phase 1 + Phase 2 caben en un commit único. Si prefiere iterativo (patrón habitual del proyecto), Phase 1 va primero porque es independiente y los bugs duelen cada día que están.
