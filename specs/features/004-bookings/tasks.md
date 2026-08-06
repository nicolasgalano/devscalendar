# Tasks — Bookings CRUD (con anti doble-booking)

- **ID:** 004-bookings
- **Plan reference:** `./plan.md`
- **Status:** not started

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

---

## Phase 1 — Escritura en la base

- [ ] **T1.1** — Verificar que los datos actuales no violan el constraint antes de escribirlo: query de reservas `approved` superpuestas por dev (tiene que dar 0 filas). Se corrió en `003` y daba 0, pero el seed cambió desde entonces. _DoD: el resultado queda anotado acá._
- [ ] **T1.2** — Migration `00000000000006_bookings_write_path.sql`:
  - `create extension if not exists btree_gist with schema extensions;` y **`set local search_path = public, extensions;` al principio** — sin eso el constraint falla con "uuid has no default operator class for access method gist" (R-3).
  - `exclude using gist (dev_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'approved')` (`plan.md` §3.1).
  - Helper `public.can_manage_booking(uuid)` `security definer`, y policy de escritura para PM del proyecto o admin.
  - `grant insert, update, delete on public.bookings to authenticated` — la policy sin grant deniega en silencio.
  - _DoD: `supabase db reset` **desde cero** corre limpio; no alcanza con que aplique sobre una base ya migrada._
- [ ] **T1.3** — `pnpm db:types`. _DoD: `pnpm typecheck` limpio._
- [ ] **T1.4** — Ampliar el seed con un caso de conflicto ya resuelto (dos aprobadas consecutivas 09:00–13:00 y 13:00–17:00 del mismo dev), que es el borde `[)` del rango. _DoD: `pnpm db:reset` aplica el constraint con esos datos sin fallar — o sea, el borde queda probado por el propio seed._

## Phase 2 — Reglas y API

- [ ] **T2.1** — `src/lib/bookings/transitions.ts`: función pura que dada la reserva actual y el cambio propuesto devuelve el estado resultante. **Q-E:** cambiar horario o desarrollador de una `approved` la devuelve a `pending`; nota y ticket no. _DoD: T4.1._
- [ ] **T2.2** — `src/lib/validation/bookings.ts`: schemas Zod de alta y edición. `endsAt > startsAt` es validación dura (AC-1.3); jornada y día laborable **no** validan, solo alimentan advertencias (AC-1.4). _DoD: T4.1._
- [ ] **T2.3** — `src/lib/api/require-booking-access.ts`: guard hermano de `requireAdmin()`, 401 sin sesión y 403 si no es admin ni PM del proyecto. _DoD: T4.2._
- [ ] **T2.4** — `POST /api/bookings` (AC-1.1). Traduce `23P01` a **409 con la reserva en conflicto en el cuerpo** (AC-1.2): buscarla explícitamente, porque el error de Postgres no la trae. _DoD: T4.2, T4.3._
- [ ] **T2.5** — `PATCH /api/bookings/[id]`: edición (AC-2.1, AC-2.2 vía T2.1) y cancelación por `status: "cancelled"` (AC-3.1). **Sin `DELETE`:** cancelar no borra, la reserva queda con su estado para el calendario y para `010`. _DoD: T4.2._

## Phase 3 — UI

- [ ] **T3.1** — `BookingDialog`: alta y edición en un solo componente, sobre el `Dialog` ya instalado y ajustado a la escala. _DoD: se abre, valida y guarda; los cuatro estados de `DESIGN.md` §9 donde apliquen._
- [ ] **T3.2** — Botón `Crear reserva` como **única acción primaria** de la vista calendario (`DESIGN.md` §7), y en el empty state cuando no hay reservas — salda la deuda F2 de `003`.
- [ ] **T3.3** — Click en un espacio libre de la grilla del día abre el diálogo con desarrollador y horario precargados. La grilla ya sabe qué carril y qué franja se clickeó (`day-view.tsx`). _DoD: el horario precargado cae en la franja de 30 min clickeada._
- [ ] **T3.4** — Advertencias inline de jornada y día no laborable (AC-1.4), en `--attention`, **sin deshabilitar guardar**. Reusa `isWorkday()` y las constantes de `src/lib/calendar/workdays.ts`. _DoD: advertir nunca impide guardar._
- [ ] **T3.5** — Estado de conflicto en el diálogo: icono `alert-triangle`, texto en `--danger`, **el motivo en palabras** y link a la reserva que bloquea (`DESIGN.md` §8, primer uso del componente de conflicto). _DoD: el color no es el único portador del mensaje._
- [ ] **T3.6** — Editar y cancelar desde el popover del bloque, que hoy es solo lectura (`booking-block.tsx`). _DoD: el popover mantiene su rol de detalle para quien no puede editar._

## Phase 4 — Tests

- [ ] **T4.1** — Unit: transiciones de estado (T2.1), schemas Zod (T2.2) y cálculo de advertencias. _DoD: corren sin Supabase, como el resto de `tests/unit/`._
- [ ] **T4.2** — Integración de RLS: un PM escribe en su proyecto y **no** en el de otro; un desarrollador no escribe nada; el admin escribe en todos. **Actualizar `tests/integration/bookings-rls.test.ts`**, cuyas aserciones de "nadie escribe" dejan de valer a propósito en esta feature. _DoD: el test viejo queda reemplazado, no borrado sin más._
- [ ] **T4.3** — Integración del constraint:
  - dos `approved` superpuestas del mismo dev → falla (AC-4.1);
  - dos `pending` superpuestas → conviven (AC-4.2);
  - 09:00–13:00 y 13:00–17:00 → **no** es conflicto (el borde `[)`);
  - dos devs distintos en la misma franja → no es conflicto.
- [ ] **T4.4** — **Concurrencia (R-1):** dos inserts en paralelo sobre la misma franja; exactamente uno persiste. _DoD: probarlos en serie no cuenta — en serie pasa hasta un check aplicativo, que es justo lo que el constraint viene a reemplazar._
- [ ] **T4.5** — E2E: un PM crea una reserva desde la grilla, la ve aparecer, la edita, la cancela. Más el caso de conflicto mostrando la reserva que bloquea. _DoD: limpieza en `finally`, como el resto de `tests/e2e/`._

## Phase 5 — Docs & handoff

- [ ] **T5.1** — `DESIGN.md`: mover el estado de conflicto (§8) de "pendiente" a "aplicado", y sacar la deuda del empty state sin verbo (§14).
- [ ] **T5.2** — `CLAUDE.md`: `bookings` deja de ser de solo lectura; anotar la convención de que cancelar es `update`, nunca `delete`.
- [ ] **T5.3** — `specs/features/README.md`: `004` a `done`; marcar Q-E como respondida y Q-8 si el cliente la confirma.
- [ ] **T5.4** — ADR si la implementación se aparta del plan en algo transversal. El `exclusion constraint` en sí **no** necesita ADR: es la solución que la spec funcional ya pedía, no una elección entre alternativas parejas.

---

## Blocked / follow-ups

- [ ] **F1** — **Race entre edición y aprobación (R-2 de la spec).** Hoy no existe, porque el desarrollador no puede escribir hasta `005`. Quien implemente `005` tiene que resolverla: la aprobación debe referirse a la versión de la reserva que el dev vio, no a la que quedó después de que el PM la editara. Owner: quien tome `005`.
- [ ] **F2** — Notificaciones al dev (AC-2.1, AC-3.1) — son de `010`. En `004` la reserva cambia de estado y nada más. **No simular el aviso con un toast:** dejaría la ilusión de que el dev se enteró.
- [ ] **F3** — Drag & drop para mover bloques, explícitamente fuera de alcance (`spec.md` §5). La grilla de `003` está preparada: el bloque ya se posiciona por área de grilla, así que mover es recalcular `starts_at`/`ends_at` y hacer el mismo PATCH de T2.5.
- [ ] **F4** — Q-8 (unidad de reserva: franja libre vs. bloques fijos) sigue con el default de franja libre. Si el cliente pide bloques fijos, cambia el formulario, no el modelo.
