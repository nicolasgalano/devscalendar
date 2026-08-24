# Tasks — Bookings CRUD (con anti doble-booking)

- **ID:** 004-bookings
- **Plan reference:** `./plan.md`
- **Status:** done — 166 tests en verde (113 unitarios + 53 de integración), 5 E2E propios, typecheck y lint limpios. `calendar.spec.ts` de `003` sigue en verde (12/12).

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

---

## Phase 1 — Escritura en la base

- [x] **T1.1** — Verificar que los datos actuales no violan el constraint antes de escribirlo: query de reservas `approved` superpuestas por dev (tiene que dar 0 filas). Se corrió en `003` y daba 0, pero el seed cambió desde entonces. _DoD: el resultado queda anotado acá._ **0 pares superpuestos** sobre 9 reservas (4 aprobadas). El constraint aplicó sin conflictos.
- [x] **T1.2** — Migration `00000000000006_bookings_write_path.sql`:
  - `create extension if not exists btree_gist with schema extensions;` y **`set local search_path = public, extensions;` al principio** — sin eso el constraint falla con "uuid has no default operator class for access method gist" (R-3).
  - `exclude using gist (dev_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'approved')` (`plan.md` §3.1).
  - Helper `public.can_manage_booking(uuid)` `security definer`, y policy de escritura para PM del proyecto o admin.
  - ~~`grant insert, update, delete`~~ → **solo `insert, update`**. El plan se contradecía: §3.2 pedía el grant de `delete` y R-5 decía que cancelar es un `update`. Sin API de borrado, otorgar `delete` era abrir una puerta que nadie usa. Cancelar es `update status`.
  - _DoD: `supabase db reset` **desde cero** corre limpio; no alcanza con que aplique sobre una base ya migrada._ Verificado dos veces desde cero.
  - **Se resolvió el `search_path` calificando el opclass** (`dev_id extensions.gist_uuid_ops with =`) en vez de con `set local search_path`: `set local` solo tiene efecto dentro de una transacción, y no está garantizado que el runner de migrations envuelva cada archivo en una. Calificar el opclass no depende de eso.
  - **Agregado no previsto en el plan: trigger `bookings_enforce_status_transition`.** Ver abajo.
- [x] **T1.3** — `pnpm db:types`. _DoD: `pnpm typecheck` limpio._
- [x] **T1.4** — Ampliar el seed con un caso de conflicto ya resuelto (dos aprobadas consecutivas 09:00–13:00 y 13:00–17:00 del mismo dev), que es el borde `[)` del rango. _DoD: `pnpm db:reset` aplica el constraint con esos datos sin fallar — o sea, el borde queda probado por el propio seed._

- [x] **T1.5** — (no planificada) **Guard de transiciones de estado.** Abrir `update` al PM le habilitaba poner `status = 'approved'` en su propia reserva y auto-aprobarse, lo que vacía de sentido el flujo de aprobación — la promesa central del producto (spec funcional §6). No se puede resolver con una policy: `with check` solo ve la fila nueva, y una regla del tipo "el estado tiene que ser pending o cancelled" bloquearía editar la nota de una reserva ya aprobada, que Q-E dice que debe seguir aprobada. Comparar el estado anterior con el nuevo necesita un trigger.
  - Aprobar o rechazar queda reservado al desarrollador asignado. La policy que se lo permita es de `005`; el trigger ya está listo para cuando llegue.
  - `auth.uid() is null` (o sea `service_role`) queda exento, para que seeds y fixtures de test puedan sembrar estados directamente.
  - _Verificado contra la DB: el PM auto-aprobando falla; el mismo PM editando la nota de una aprobada funciona y la reserva **sigue aprobada**._

## Phase 2 — Reglas y API

- [x] **T2.1** — `src/lib/bookings/transitions.ts`: función pura que dada la reserva actual y el cambio propuesto devuelve el estado resultante. **Q-E:** cambiar horario o desarrollador de una `approved` la devuelve a `pending`; nota y ticket no. _DoD: T4.1._
- [x] **T2.2** — `src/lib/validation/bookings.ts`: schemas Zod de alta y edición. `endsAt > startsAt` es validación dura (AC-1.3); jornada y día laborable **no** validan, solo alimentan advertencias (AC-1.4). _DoD: T4.1._
- [x] **T2.3** — `src/lib/api/require-booking-access.ts`: guard hermano de `requireAdmin()`, 401 sin sesión y 403 si no es admin ni PM del proyecto. _DoD: T4.2._
- [x] **T2.4** — `POST /api/bookings` (AC-1.1). Traduce `23P01` a **409 con la reserva en conflicto en el cuerpo** (AC-1.2): buscarla explícitamente, porque el error de Postgres no la trae. _DoD: T4.2, T4.3._
  - **Hueco del plan, encontrado probando la API:** el plan asumía que AC-1.2 lo resolvía el `exclusion constraint`, y **no puede**. Toda reserva nace `pending` y el constraint solo excluye entre `approved`, así que en un alta nunca se dispara: crear encima de una reserva aprobada devolvía 201.
  - Se agregó un **chequeo explícito** antes del insert (y el equivalente en el PATCH cuando el horario o el dev cambian). Es aplicativo y tiene su ventana de carrera, pero la consecuencia de perderla es una `pending` superpuesta a una `approved` — exactamente lo que AC-4.2 permite, y lo que el constraint bloquea cuando el dev intente aprobarla. **La garantía dura sigue estando en la base;** esto es para no hacerle perder el viaje al PM.
  - Validación de rol del `dev_id` en la capa de aplicación, mismo criterio que `projects.pm_id` en `002` (R-3 de esa feature): Postgres no puede exigir que una FK apunte a un profile con cierto rol.
- [x] **T2.5** — `PATCH /api/bookings/[id]`: edición (AC-2.1, AC-2.2 vía T2.1) y cancelación por `status: "cancelled"` (AC-3.1). **Sin `DELETE`:** cancelar no borra, la reserva queda con su estado para el calendario y para `010`. _DoD: T4.2._

## Phase 3 — UI

- [x] **T3.1** — `BookingDialog`: alta y edición en un solo componente, sobre el `Dialog` ya instalado y ajustado a la escala. _DoD: se abre, valida y guarda; los cuatro estados de `DESIGN.md` §9 donde apliquen._
  - **Se valida al usar el botón, no deshabilitándolo** (`DESIGN.md` §7). Las tablas de `002` deshabilitan; el documento manda sobre el precedente.
  - El proyecto queda bloqueado al editar: el `PATCH` no lo acepta, y un campo editable que la API ignora es peor que uno deshabilitado con su motivo escrito.
  - **Bug encontrado probando: el trigger mostraba el uuid crudo.** `SelectValue` sin hijos imprime el valor, y acá el valor es un id. Se resuelve el texto a mano, igual que la barra de filtros de `003` con su centinela `__all__`.
- [x] **T3.2** — Botón `Crear reserva` como **única acción primaria** de la vista calendario (`DESIGN.md` §7), y en el empty state cuando no hay reservas — salda la deuda F2 de `003`.
  - La page distingue tres estados (`data` / `empty` / `no-results`) para decidir dónde vive el botón. En "sin resultados" se queda en el encabezado: ahí la acción que corresponde ofrecer es limpiar el filtro, pero los datos existen y crear sigue teniendo sentido.
- [x] **T3.3** — Click en un espacio libre de la grilla del día abre el diálogo con desarrollador y horario precargados. _DoD: el horario precargado cae en la franja de 30 min clickeada._
  - **Un solo elemento enfocable por carril, no uno por franja.** 16 franjas × 8 carriles daría 128 paradas de tabulación antes del primer bloque. El puntero elige la franja por posición (`event.detail === 0` distingue el click de teclado), y el teclado entra por el inicio de la jornada.
  - La capa se dibuja **antes** que los bloques, así que estos quedan encima y clickear una reserva abre su detalle, no el alta.
  - No se muestra si el usuario no tiene proyectos o devs con los que reservar: cubrir la grilla de zonas clickeables que solo llevan a un cartel de "no tenés proyectos" es peor que no ofrecerlas.
- [x] **T3.4** — Advertencias inline de jornada y día no laborable (AC-1.4), en `--attention`, **sin deshabilitar guardar**. _DoD: advertir nunca impide guardar._
  - `describeBookingWarnings()` es pura y **solo devuelve texto**: no hay forma de que rechace nada, que es AC-1.4 hecho estructura en vez de disciplina.
  - Un año sin feriados cargados (R-7 de `003`) no rompe el diálogo ni finge que verificó: lo dice.
  - Icono `circle-alert` sobre `--attention`, distinto del `alert-triangle` del conflicto. Si advertir y bloquear se vieran igual, se aprenderían a ignorar los dos.
- [x] **T3.5** — Estado de conflicto en el diálogo: icono `alert-triangle`, texto en `--danger`, **el motivo en palabras** y link al día de la reserva que bloquea. _DoD: el color no es el único portador del mensaje._
  - El diálogo queda abierto con los datos cargados: el PM corrige el horario, no vuelve a empezar.
- [x] **T3.6** — Editar y cancelar desde el popover del bloque. _DoD: el popover mantiene su rol de detalle para quien no puede editar._
  - Los diálogos viven en `BookingActionsProvider`, arriba de la grilla: uno dentro del popover se desmontaría al cerrarse este. El popover se controla para cerrarlo antes de abrir el modal, o el foco volvería a un bloque tapado.
  - Cancelar pasa por confirmación porque es terminal (`canCancel` excluye `cancelled` y `displaced`, y `canEdit` excluye `cancelled`: no hay vuelta atrás).

## Phase 4 — Tests

- [x] **T4.1** — Unit: transiciones de estado (T2.1), schemas Zod (T2.2) y cálculo de advertencias. _DoD: corren sin Supabase, como el resto de `tests/unit/`._
  - Completado en la Fase 3 con `booking-form.test.ts` y `booking-warnings.test.ts`: conversión wall-clock ↔ instante, las advertencias, y los permisos que deciden qué botones se dibujan. 89 → **113 unitarios**.
- [x] **T4.2** — Integración de RLS: un PM escribe en su proyecto y **no** en el de otro; un desarrollador no escribe nada; el admin escribe en todos. **Actualizar `tests/integration/bookings-rls.test.ts`**, cuyas aserciones de "nadie escribe" dejan de valer a propósito en esta feature. _DoD: el test viejo queda reemplazado, no borrado sin más._
  - **Adelantado en la Fase 1** lo que se rompía: las dos aserciones de "ni el admin escribe" se reemplazaron por el contrato nuevo (el admin crea, el dev no, el `delete` sigue negado para todos, el PM no se auto-aprueba, editar la nota no invalida la aprobación). Dejar la suite roja entre fases habría tapado cualquier regresión real.
  - Completado en la Fase 2 con `tests/integration/bookings-write-rls.test.ts`: el PM escribe en su proyecto y **no** en el ajeno, ni editando. El caso de edición ajena se verifica **leyendo la fila de vuelta**, porque la RLS convierte el `update` en un no-op silencioso y el error solo no prueba nada.
- [x] **T4.3** — Integración del constraint:
  - dos `approved` superpuestas del mismo dev → falla (AC-4.1);
  - dos `pending` superpuestas → conviven (AC-4.2);
  - 09:00–13:00 y 13:00–17:00 → **no** es conflicto (el borde `[)`);
  - dos devs distintos en la misma franja → no es conflicto.
- [x] **T4.4** — **Concurrencia (R-1):** dos inserts en paralelo sobre la misma franja; exactamente uno persiste. _DoD: probarlos en serie no cuenta — en serie pasa hasta un check aplicativo, que es justo lo que el constraint viene a reemplazar._
- [x] **T4.5** — E2E (`tests/e2e/bookings.spec.ts`, 5 tests): alta desde el empty state, edición, cancelación, el precargado por click en la grilla, el conflicto con la reserva que bloquea, las advertencias de sábado y horario **sin** deshabilitar guardar, y que un desarrollador no ve ninguna acción de escritura. _DoD: limpieza en `finally`._
  - Fixtures propias: el PM del seed no es el de estos proyectos, y la RLS —con razón— no lo deja reservar sobre ellos. Cada test usa **su propia fecha** de 2027, porque `fullyParallel` está activo.
  - **Los locators van acotados al diálogo.** La barra de filtros tiene sus propios selects de proyecto y desarrollador, y `Crear reserva` matchea además la capa de cada carril (`Crear reserva en <carril>`): sin `exact` y sin scope, tres tests fallaban por ambigüedad.
  - **Calentamiento de rutas autenticado.** `next dev` compila cada handler la primera vez (medido: 4.9s a 19.1s) y eso se comía la primera aserción. Un `fetch` anónimo no sirve: el middleware corre también sobre `/api`, así que se va por el redirect a `/login` y el handler nunca compila.

## Phase 5 — Docs & handoff

- [x] **T5.1** — `DESIGN.md`: conflicto y empty state con verbo pasan de "pendiente" a "aplicado en `004`" (§14), y §8 gana la regla de que **advertir y bloquear no comparten tratamiento** (`circle-alert`/`--attention` vs. `alert-triangle`/`--danger`).
- [x] **T5.2** — `CLAUDE.md`: nueva sección "Reservas" con las cuatro convenciones que hereda `005` — cancelar es `update`, el anti doble-booking en dos capas, el trigger de transiciones, y que la jornada no se valida nunca. Más `readJsonBody()` en la sección de rutas.
- [x] **T5.3** — `specs/features/README.md`: `004` a `done`. Q-E ya estaba cerrada. **Q-8 y Q-B siguen abiertas**: salieron con su default aplicado, y la tabla ahora dice qué costaría cambiarlas en vez de apuntar a una feature ya terminada.
- [x] **T5.4** — **ADR 0008 — El anti doble-booking vive en dos capas, no en una.** El `exclusion constraint` no necesitaba ADR, pero el hueco que encontró T2.4 sí: que el constraint **no pueda** cubrir AC-1.2 es una restricción que `005`, `006` y el drag & drop de F3 heredan. Incluye la obligación concreta de `005`: traducir el `23P01` que va a saltar al aprobar.

---

## Abierto — necesita ojos humanos

- [ ] **T5.5** — **Revisión visual del diálogo en modo claro y oscuro**, a 1280 / 1440 / <1024px (`DESIGN.md` §13, puntos 5 y 15; `plan.md` §10 "Manual"). Se verificó que los colores salen de tokens y que no hay hex hardcodeado, pero **que se vea bien no se puede afirmar sin mirarlo**. Mirar en particular: el aviso de conflicto sobre `--danger-bg`, la lista de advertencias en `--attention`, y la fila de fecha/desde/hasta, que abajo de 1024px pasa de tres columnas a dos.

## Blocked / follow-ups

- [ ] **F1** — **Race entre edición y aprobación (R-2 de la spec).** Hoy no existe, porque el desarrollador no puede escribir hasta `005`. Quien implemente `005` tiene que resolverla: la aprobación debe referirse a la versión de la reserva que el dev vio, no a la que quedó después de que el PM la editara. Owner: quien tome `005`.
- [ ] **F2** — Notificaciones al dev (AC-2.1, AC-3.1) — son de `010`. En `004` la reserva cambia de estado y nada más. **No simular el aviso con un toast:** dejaría la ilusión de que el dev se enteró.
- [ ] **F3** — Drag & drop para mover bloques, explícitamente fuera de alcance (`spec.md` §5). La grilla de `003` está preparada: el bloque ya se posiciona por área de grilla, así que mover es recalcular `starts_at`/`ends_at` y hacer el mismo PATCH de T2.5.
- [ ] **F4** — Q-8 (unidad de reserva: franja libre vs. bloques fijos) sigue con el default de franja libre. Si el cliente pide bloques fijos, cambia el formulario, no el modelo.
- [ ] **F5** — **`readJsonBody()` falta en las rutas de `002`** (`/api/clients`, `/api/projects`, `/api/users`). Tienen el mismo `await request.json()` directo, así que un body vacío o mal formado les sale como 500 con stack trace en vez de 400. Se arregló solo en las de reservas para no ampliar el alcance de `004`; es un cambio de una línea por handler. Owner: quien toque esas rutas.
- [ ] **F6** — **`tests/e2e/admin-entities.spec.ts` quedó sin verificar en verde.** Falla dentro de `createUser()` —una llamada directa al auth de Supabase, antes de que entre el navegador— sobre código que `004` no toca. Durante esta sesión el stack estaba degradado (`docker ps` colgado 120s, latencia de Supabase entre 0.29s y 3.5s para la misma request, Chromium cayéndose con `session closed`). **Re-correrlo con la máquina tranquila antes de dar por buena la suite**, y si sigue fallando, tratarlo como bug real de `002`.
- [ ] **F7** — El calendario paga **dos queries extra por render** (`getBookingFormOptions`: proyectos + devs) para poder abrir el diálogo sin esperar. Es lo que decidió `plan.md` §5 y en un stack sano cuesta milisegundos. Si algún día pesa, la salida es traerlas al abrir el diálogo, no antes — pero entonces el diálogo necesita su estado de carga.
