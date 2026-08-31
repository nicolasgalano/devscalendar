# Tasks — Priority & reallocation

- **ID:** 006-priority-reallocation
- **Plan reference:** `./plan.md`
- **Status:** no empezada. `plan.md` escrito el 2026-08-31, junto con este archivo.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **Antes de escribir una línea, leer `plan.md` §3.2.** El modo de falla por defecto de esta feature es silencioso: un `update` que la RLS filtra no tira error, no hace nada, y el resultado son dos reservas aprobadas superpuestas sin un solo mensaje. Es el R-1 de la spec.

> **Y leer ADR 0009.** Esta feature escribe `status`, así que pasa por el trigger de `005`. Hoy no choca —`plan.md` §8 explica por qué— pero conviene saberlo antes y no descubrirlo con un `23514`.

---

## Phase 0 — Antes de empezar

- [ ] **T0.1** — **Confirmar Q-2 con el cliente** (¿dos niveles o P0–P3?). No bloquea la implementación —AC-1.3 define qué hacer en el empate— pero sí define si el empate es un caso de borde o el caso común. Si pasa a numérico, cambia la regla de `priority.ts`, la migration de `projects.priority` y el sistema de color de `DESIGN.md` §3.
- [ ] **T0.2** — **Llevarle R-2 al cliente** (`plan.md` §9): la prioridad no juega al aprobar, solo al crear. Es la pregunta más importante que este plan destapó y **no tiene default razonable aplicado**, a diferencia del resto. Sin respuesta, un proyecto prioritario puede perder la franja sin que nadie haya desplazado nada.
- [ ] **T0.3** — Confirmar Q-A (¿varios PMs por proyecto?). Impacta poco acá, pero `can_manage_booking` es la puerta de la función nueva y conviene no reescribirla dos veces.

## Phase 1 — La base

- [ ] **T1.1** — Migration `00000000000008_reallocation.sql` con `reallocate_booking()` (`plan.md` §3.3), `security definer`, `search_path` fijo, y los cinco chequeos internos **en orden**. Sin cambios de esquema: no hay columnas ni estados nuevos que agregar.
  - `revoke all … from public` y `grant execute … to authenticated`, igual que `can_manage_booking`. Una función definer sin revoke es una puerta abierta.
  - _DoD: **CI primero** — el job `database` reconstruye desde cero y T3.2 queda en verde. Recién con el PR verde, `pnpm db:push`._
- [ ] **T1.2** — Decidir y aplicar el bloqueo de R-4: `select … for update` sobre las reservas del dev en el rango, adentro de la función. _DoD: T3.5, que corre en paralelo._
- [ ] **T1.3** — Ampliar la auditoría con la fila `reallocated` (`plan.md` §3.4). **Dos filas por evento a propósito**, no una: el trigger de `005` cuenta el cambio de estado, esta cuenta la decisión. _DoD: T3.4._
- [ ] **T1.4** — `pnpm db:types` y confirmar que el diff da vacío. **Ojo:** quedó pendiente desde `005` (B1 de `005/tasks.md`) por falta de un personal access token; si sigue sin resolverse, esta task hereda el bloqueo.

## Phase 2 — Reglas y API

- [ ] **T2.1** — `src/lib/bookings/priority.ts`: la matriz de `plan.md` §5 como función pura — `canDisplace(newPriority, existingPriority)` y `explainDisplaceRefusal(...)`. **El empate y la prioridad insuficiente devuelven motivos distintos**: uno dice "no podés", el otro "hablalo con el otro PM". _DoD: T3.1._
- [ ] **T2.2** — Ampliar `findConflictingBooking()` para que el conflicto diga **si es desplazable**. Hoy devuelve la reserva que bloquea; ahora tiene que traer también la prioridad de su proyecto, o la UI no puede decidir qué ofrecer.
- [ ] **T2.3** — Schema Zod del alta con realocación: el del alta más `confirmedDisplacing: string[]`, requerido y no vacío. _DoD: T3.1._
- [ ] **T2.4** — `POST /api/bookings/reallocate` (`plan.md` §4). Body con `readJsonBody()`. Guard `requireBookingAccess(projectId)` **del proyecto nuevo**. Las tres traducciones de error de §4, con **el empate y la prioridad insuficiente como mensajes distintos**. _DoD: T3.2, T3.3._

## Phase 3 — Tests

- [ ] **T3.1** — Unit: la matriz de los cuatro casos completa, y el schema. _DoD: corren sin Supabase._
- [ ] **T3.2** — **Integración, el que no puede faltar (R-1):** el PM prioritario desplaza una común aprobada; el común **no** desplaza una prioritaria; dos prioritarias no se desplazan entre sí.
  - **Verificar leyendo las filas de vuelta**, siempre: que la vieja quedó `displaced` **y** que la nueva quedó `pending`. Un test que solo mire el error pasaría con la RLS filtrando en silencio, que es exactamente el modo de falla de `plan.md` §3.2.
  - Y el caso que parece obvio y no lo es: **una reserva común `pending` no se desplaza**, porque no ocupa nada.
- [ ] **T3.3** — Integración de atomicidad: forzar el fallo del segundo paso y verificar que **el primero tampoco quedó**. Es lo único que prueba que la función es atómica y no dos escrituras seguidas con suerte.
- [ ] **T3.4** — Integración de auditoría: una realocación deja las dos filas de `plan.md` §3.4, y la de `reallocated` nombra la reserva que desplazó.
- [ ] **T3.5** — **Concurrencia (R-4):** dos realocaciones prioritarias en paralelo sobre la misma franja del mismo dev. _DoD: en paralelo, no en serie._
- [ ] **T3.6** — Integración del guard: alguien que no es PM del proyecto nuevo llama a la función y no pasa. Es el chequeo 1 de `plan.md` §3.3, y sin él `security definer` es una puerta abierta.

> **Fixture con su propia franja por test**, y todo `update` del que dependa una aserción posterior chequea su propio error primero. Las dos reglas salieron de `005` T3.2, donde un test pasaba sin probar nada.

## Phase 4 — UI

- [ ] **T4.1** — El conflicto desplazable en `BookingDialog`: `circle-alert` sobre `--attention` y el botón habilitado, **nunca** `alert-triangle` sobre `--danger` — eso queda para el que impide seguir (`DESIGN.md` §8, `plan.md` §6).
- [ ] **T4.2** — Diálogo de confirmación: qué reserva se pisa, de qué proyecto, de qué PM, y **que no se restaura sola** si esta después se cae (AC-3.2). _DoD: el motivo siempre en palabras._
- [ ] **T4.3** — Los dos 409 distinguibles en la UI: prioridad insuficiente vs. empate. Si se leen igual, el PM no sabe si buscar otra franja o levantar el teléfono.
- [ ] **T4.4** — E2E: el PM prioritario desplaza, y el PM desplazado ve su reserva en `displaced` **sin tocar ningún filtro** (ya está en `DEFAULT_STATUSES`). Más el caso bloqueado.
  - Calentamiento de la ruta nueva en `beforeAll` y **una fecha por test**, como en `004` T4.5 y `005` T4.7.

## Phase 5 — Docs & handoff

- [ ] **T5.1** — `CLAUDE.md`: sumar a "Reservas" que desplazar pasa por una función `security definer` y por qué la policy no alcanza.
- [ ] **T5.2** — `DESIGN.md` §14: lo que `006` aplique, incluida la distinción entre el conflicto que bloquea y el que se puede desplazar.
- [ ] **T5.3** — `specs/features/README.md`: `006` a `done`; cerrar Q-2 y Q-6 si el cliente las respondió.
- [ ] **T5.4** — **ADR probable:** que una operación entre proyectos de distinto dueño se resuelva con una función `security definer` en vez de con policies. Es hermano de ADR 0009 y lo hereda `007` (borrar el evento de Google Calendar de una reserva ajena).
- [ ] **T5.5** — Revisión visual en ambos temas, a 1280 / 1440 / <1024px. Necesita ojos humanos.

---

## Blocked / follow-ups

- [ ] **F1** — **Notificar al PM desplazado y al dev (AC-2.1).** Es de `010`, y acá **pesa más que en `005`**: ahí el que esperaba era el dev, que entra a la app igual; acá a alguien le sacan una reserva ya confirmada sin pedirle permiso. Mitigación parcial hasta entonces: `displaced` es visible por default y el rastro queda en `audit_log`. **No simularlo con un toast.**
- [ ] **F2** — **Restaurar la desplazada** si la prioritaria se cancela o el dev la rechaza. Fuera del MVP por AC-3.2 y Q-G. Si el cliente lo pide, la vuelta es de `displaced` a `approved`, y hay que decidir qué pasa si la franja se ocupó mientras tanto.
- [ ] **F3** — **Borrar el evento de Google Calendar de la reserva desplazada.** Es de `007`. Sin eso, el dev tiene en su calendario personal un bloque que ya no existe en el producto.
- [ ] **F4** — **R-2, la prioridad no juega al aprobar.** Ver T0.2. Es la única pregunta de este plan **sin default razonable aplicado**, así que si el cliente no la contesta, algo se decide igual y conviene que sea a propósito.
- [ ] **F5** — Empate entre prioritarios (Q-2 / R-5). Con dos niveles no se resuelve solo; AC-1.3 lo manda a los PMs.
