# Tasks — Approval flow (dev approve/reject)

- **ID:** 005-approval-flow
- **Plan reference:** `./plan.md`
- **Status:** fases 1-4 escritas. 1-3 verdes en CI; la 4 corre sus E2E en la próxima corrida. T1.3 bloqueada por credenciales.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **Alcance acordado con el usuario (2026-08-12):** sin notificaciones —AC-1.2 y AC-3.1 se difieren a `010`— y comentario **obligatorio al rechazar**. Ver `plan.md` §1.

---

## Phase 1 — Escritura del desarrollador

- [x] **T1.1** — Migration `00000000000007_booking_responses.sql`, en un solo archivo (`plan.md` §12: separar la policy del guard abre una ventana en la que cualquier dev puede reescribir sus reservas):
  - Columnas `response_note text` y `responded_at timestamptz`, ambas nullable.
  - Policy `bookings: developer responds` (`plan.md` §3.2).
  - **Guard de columnas dentro de `enforce_booking_status_transition()`**, extendiendo la función de `004` en vez de agregar un trigger nuevo: dos triggers `before update` sobre la misma tabla se ejecutan por orden alfabético de nombre, y hacer depender una regla de seguridad de eso es pedirla prestada al azar.
  - _DoD: **CI primero** — el job `database` reconstruye la base desde cero (`supabase db reset --local`) y T3.2 queda en verde. Recién con el PR verde se aplica al proyecto remoto con `pnpm db:push`. Ver `docs/testing.md` §8: una migration rota tiene que descubrirse contra una base descartable, no contra la de desarrollo._
  - El guard quedó como lista de lo escribible y no de lo prohibido, `responded_at` lo deriva el trigger, y la regla de `§3.3` también vive ahí. Los tres cambios respecto del sketch del plan están anotados en `plan.md` §3.1 / §3.2.
  - **Aplicada al proyecto de desarrollo el 2026-08-26, antes que CI, por decisión explícita del usuario.** El SQL corre limpio contra una base real —incluida la resta de `jsonb` del guard—, que era la duda grande. Lo que sigue faltando es el **comportamiento**: que la policy y el guard hagan lo que dicen no lo prueba `db push`, lo prueba T3.2. El DoD sigue abierto hasta entonces.
  - De paso salió que el remoto estaba **dos migrations atrás**: `00000000000006` (el camino de escritura de `004`) tampoco se había aplicado nunca. Ahora está.
- [x] **T1.2** — Trigger `bookings_log_status_change` → `audit_log` (`plan.md` §3.4). Mismo patrón que `projects_log_priority_change`: `security definer`, sin `grant insert` para nadie. _DoD: T3.5._
  - Registra **todo** cambio de estado, no solo la respuesta del dev (`plan.md` §3.4). Como `audit_log` apunta a la entidad sin FK, los tres caminos de limpieza —`scripts/cleanup-test-data.mjs`, `tests/integration/helpers.ts`, `tests/e2e/session.ts`— ahora leen los ids de las reservas antes de borrarlas.
- [!] **T1.3** — `pnpm db:types`. _DoD: `pnpm typecheck` limpio._
  - **El comando no se pudo correr (2026-08-26), y los tipos se parchearon a mano.** `src/types/database.ts` tiene `responded_at` y `response_note` en `Row` / `Insert` / `Update` de `bookings`, escritas a mano en el orden alfabético que usa el generador y con la nulabilidad que informa PostgREST. Es un archivo generado: **hay que regenerarlo y confirmar que el diff da vacío** apenas se pueda.
  - Por qué no se pudo: `db:types` es `gen types --linked`, que va por la Management API, y el token guardado del CLI es de **otra cuenta** (`projects list` devuelve cero proyectos y la API contesta "your account does not have the necessary privileges"). Las otras dos formas —`--db-url` y `--local`— levantan un contenedor para introspeccionar, y no hay Docker. **La secret key no sirve para esto**: es credencial de PostgREST, no de la Management API.
  - Para destrabarlo hace falta **un personal access token de la cuenta dueña del proyecto** (Dashboard → Account → Access Tokens): `supabase login`, o `SUPABASE_ACCESS_TOKEN=sbp_…`.
- [~] **T1.4** — Ampliar `seed.sql` con reservas pendientes del dev del seed, para que la bandeja tenga contenido apenas se levanta el entorno. Mantener la idempotencia (`on conflict`), que ahora es requisito y no comodidad: el seed se corre sobre bases que ya tienen datos. _DoD: el stack efímero de CI queda con al menos tres pendientes de fechas distintas, y `pnpm db:seed` sobre el proyecto remoto corrido dos veces seguidas no falla ni duplica._
  - Cuatro pendientes de Cristian Soto (…0054 el lunes, …005c/…005d/…005e miércoles a viernes), una con nota y ticket, una sin nada y una fuera de horario. Ninguna se superpone con otra suya, así que se pueden aprobar a mano sin chocar contra el constraint. De paso, el motivo del rechazo de …0055 se mudó de `note` a `response_note`, que es donde vive desde ahora. La segunda mitad del DoD —dos `db:seed` seguidos— queda con T1.3, por la misma credencial. **La primera mitad quedó verificada en CI** (run 33406711842): el paso `Aplicar migrations y seed desde cero` reconstruye la base con `seed.sql` y pasó, así que el stack efímero arranca con las cuatro pendientes.

## Phase 2 — Reglas y API

- [x] **T2.1** — Extender `src/lib/bookings/transitions.ts`: `canRespond(status)` y `nextStatusAfterResponse(...)`. Funciones puras, al lado de las de `004`. _DoD: T3.1._
  - `nextStatusAfterResponse(current, response)` devuelve `BookingStatus | null`, no el estado a secas: `null` significa "esa respuesta no aplica", así que el handler tiene **un solo** lugar donde ramificar en vez de preguntar dos veces (`canRespond` y después el estado).
  - `explainBlockedAction()` ahora acepta `"respond"` además de `"edit"` y `"cancel"`. De paso el ternario se volvió un mapa de verbos: con tres acciones ya mentía sobre cuál era el caso por default.
  - `TRANSITION_VIOLATION = "23514"` vive acá y no en `conflicts.ts`: es el errcode que levanta `enforce_booking_status_transition()`, y las reglas de transición son de este archivo. `conflicts.ts` sigue siendo el dueño de `23P01`.
- [x] **T2.2** — Schema Zod de la respuesta en `src/lib/validation/bookings.ts`: `status` acotado a `approved | rejected`, `note` **obligatorio si `rejected`** y opcional si `approved`, `expectedUpdatedAt` requerido. _DoD: T3.1._
  - El `optionalText` que ya existía hace el trabajo pesado: recorta y convierte `""` en `null`, así que el "motivo obligatorio" no se satisface con espacios. El `refine` solo pregunta por `Boolean(body.note)`.
- [x] **T2.3** — Guard `requireBookingResponder(bookingId)` en `src/lib/api/`, hermano de `requireBookingAccess()`: 401 sin sesión, 403 si quien llama no es el dev asignado. _DoD: T3.2._
  - **El admin no es un atajo acá, y es la única parte de la app donde no lo es.** Aprobar no es una operación administrativa sino un compromiso sobre el tiempo de una persona; el trigger ya compara `auth.uid()` contra `dev_id` sin mirar el rol, así que un admin que se saltara el guard chocaría igual contra un `check_violation`. Un admin que **es** el dev asignado sí responde: el chequeo es de identidad, no de rol.
  - Devuelve la reserva ya leída (`status`, `updated_at`, franja, `project_id`). El handler necesita las cuatro cosas y volver a pedirlas era un round trip regalado.
- [x] **T2.4** — `PATCH /api/bookings/[id]/response`. Body con `readJsonBody()`, **nunca `request.json()`** (convención de `CLAUDE.md`). Las tres traducciones de error de `plan.md` §4:
  - `23P01` → 409 con `findConflictingBooking()`, reusado de `004`;
  - `check_violation` del trigger → 403;
  - `expectedUpdatedAt` desajustado → 409 con la reserva actual.
  - _DoD: T3.2, T3.3, T3.4._
  - **Sin chequeo previo de conflicto, a diferencia del alta y de la edición.** `CLAUDE.md` pide que todo camino de escritura nuevo llame a `findConflictingBooking()` antes de escribir, pero esa regla existe porque en esos caminos **el constraint no se dispara** (solo excluye entre `approved`). Acá sí se dispara, y con dos aprobaciones en paralelo (T3.6) el árbitro tiene que ser el constraint de todas formas. Traducir el `23P01` da el mismo mensaje —se llama a `findConflictingBooking()` igual, para nombrar la fila que bloquea— sin pagar un round trip en el camino feliz. Si T3.3 o T3.6 muestran otra cosa, el chequeo previo vuelve.
  - **La carrera se ataja en dos lugares** y ninguno sobra: la comparación temprana en JS responde el caso común sin intentar la escritura, y el `.eq("updated_at", …)` del `update` cierra la ventana entre esa lectura y el write. Además `Date.parse` trunca a milisegundos, así que la comparación exacta es la de la base. Cero filas sin error se traduce a la misma 409 que el desajuste.
  - `responded_at` no se manda nunca: lo deriva el trigger y ni siquiera está en la whitelist del dev.

## Phase 3 — Tests

- [x] **T3.1** — Unit: transiciones de respuesta y schema Zod. Caso central: **rechazar sin comentario falla, aprobar sin comentario no**. _DoD: corren sin Supabase._
  - Once tests nuevos en `tests/unit/booking-transitions.test.ts` (140 en total, verde local). Cubren `canRespond`, `nextStatusAfterResponse` —las dos vueltas atrás de `plan.md` §3.3 incluidas—, `explainBlockedAction("respond", …)` y `respondBookingSchema`.
  - Uno de ellos fija que `expectedUpdatedAt` acepta **el formato exacto que devuelve PostgREST** (`2026-08-26T12:34:56.789123+00:00`, con microsegundos y offset). Si el `z.string().datetime({ offset: true })` no lo tragara, la bandeja fallaría con un 400 en cada respuesta y el motivo sería invisible.
- [x] **T3.2** — **Integración, el test que no puede faltar (R-1):** el dev **no** puede cambiar `starts_at`, `ends_at`, `dev_id`, `note` ni `ticket_ref` de su propia reserva, y **sí** puede cambiar `status` y `response_note`.
  - Verificar **leyendo la fila de vuelta**, no solo por el error: si algún día la policy denegara en vez de tirar, la RLS convierte el `update` en un no-op silencioso y un test que solo mire el error pasaría por la razón equivocada (la lección de `004` T4.2).
  - Más: el dev responde la suya; **no** responde la de otro; el PM sigue sin poder aprobar (regresión del guard de `004`); un admin que además es el dev asignado **sí** puede editar.
  - Escrito en `tests/integration/bookings-response-rls.test.ts`. Las cuatro columnas prohibidas van por `it.each` y se afirman de las dos formas: `23514` **y** la fila leída de vuelta.
  - **`dev_id` se afirma por resultado y no por código de error**, a diferencia de las otras cuatro: ahí pueden hablar dos mecanismos —el guard del trigger y el `with check` de la policy, que deja de matchear cuando la fila cambia de dueño— y cuál gane depende del orden en que Postgres los evalúa. Fijar ese orden sería atarse a un detalle de implementación; lo que importa es que la reserva no cambia de manos.
  - **Test de más, no pedido por el plan:** que volver a `pending` limpie `responded_at` y `response_note` (Q-E). El trigger deriva las dos columnas y no había nada que lo cubriera; sin esto, la bandeja podría mostrar una reserva pendiente que dice haber sido contestada.
- [x] **T3.3** — Integración del conflicto: aprobar sobre una franja ya aprobada del mismo dev → `23P01`, y la API lo devuelve como 409 **con la reserva que bloquea**. Es la primera vez que el constraint de `004` se dispara de verdad.
  - En `tests/integration/bookings-response-conflict.test.ts`. La mitad del `23P01` se prueba directo contra la base.
  - **La mitad de "con la reserva que bloquea" se prueba llamando a `findConflictingBooking()` contra el stack real**, con el cliente del **dev** y no con `service_role`: así se verifica de paso que su RLS le alcanza para ver la fila que lo bloquea, que es lo que el 409 promete devolverle. El 409 HTTP entero es de T4.6 / T4.7 — a este nivel se prueban sus dos ingredientes.
  - Incluye el borde `[)`: dos franjas que solo se tocan no son conflicto, y aprobar encadenado funciona.
- [x] **T3.4** — Integración de la carrera (R-2): el PM edita, el dev responde con el `expectedUpdatedAt` viejo, la respuesta es 409 y **la reserva sigue `pending`**.
  - Reproduce el `.eq("updated_at", …)` del handler tal cual: cero filas, **sin error**, y la reserva intacta. Eso es exactamente lo que el handler traduce al 409.
  - **Con su contraparte positiva**, que no es decorativa: sin ella, el test pasaría igual si el `.eq()` estuviera fallando siempre y nadie se enteraría de que la respuesta nunca entra.
- [x] **T3.5** — Integración de auditoría: aprobar y rechazar escriben su fila en `audit_log` con `from`, `to` y el motivo.
  - Vive dentro de `bookings-response-rls.test.ts` y no en `audit-log.test.ts`: necesita exactamente las mismas fixtures (proyecto, dev asignado, reserva pendiente, sesión del dev) y duplicarlas era pagar un `beforeAll` entero por cuatro asserts. `audit-log.test.ts` sigue siendo el de `002`, sobre el trigger de prioridad.
  - Cubre además **la cancelación del PM**, porque el trigger registra *todo* cambio de estado (`plan.md` §3.4) y no solo la respuesta del dev — y el caso negativo: tocar la nota no escribe nada.
- [x] **T3.6** — **Concurrencia (R-4):** dos aprobaciones en paralelo sobre franjas superpuestas del mismo dev; exactamente una persiste. _DoD: en paralelo, no en serie — en serie pasa hasta un check aplicativo._
  - Tres aprobaciones simultáneas con `Promise.all`, una sola sobrevive, y se verifica contra la base que quedó una sola aprobada — no que la API haya filtrado.
  - Es también la justificación del "sin chequeo previo" de T2.4: acá el árbitro tiene que ser el constraint.

> **Estado de la fase: verde en CI** (run `33406711842`, rama `005-approval-flow`). 140 unitarios, 74 de integración, 7 de smoke y 21 E2E. De esos, 21 son de `005`: 15 en `bookings-response-rls` y 6 en `bookings-response-conflict`. Con esto el guard de columnas de T1.1 deja de ser una promesa.
>
> Los dos archivos nuevos usan **fechas ancla distintas** (`2026-10-12` y `2026-12-07`) porque los archivos corren en paralelo y los dos aprueban reservas.
>
> **Lo que encontró la primera corrida, que vale más que el verde:** todas las reservas de `bookings-response-rls` nacían en la misma franja del mismo dev, y varias terminan `approved` y viven hasta el `afterAll`. La segunda aprobación de esa franja moría contra el constraint. El test que falló fue el de auditoría —acusando al trigger por un update que nunca había entrado— pero el daño real estaba al lado: **el test de Q-E pasaba sin probar nada**, porque su aprobación moría igual y dejaba la reserva pendiente con las dos columnas ya en `null`, que es exactamente lo que después afirmaba.
>
> De ahí salieron tres reglas para esta suite, en `b64158e`: cada reserva se lleva su propia franja; los horarios fijos a los que otros tests mueven reservas viven fuera del rango del contador; y **todo update del que dependa una aserción posterior chequea su propio error primero**. Un update que muere en silencio no puede volver a parecerse a un test que pasa.

## Phase 4 — UI

- [x] **T4.1** — Ruta `/(app)/inbox/` con guard de rol `developer` en su `layout.tsx`, siguiendo el patrón de `(app)/admin/layout.tsx`. Item de navegación visible solo para devs. _DoD: un PM que entra a mano a `/inbox` no la ve._
  - **El admin tampoco la ve**, y es una decisión, no un olvido: no tiene reservas propias que responder, así que su bandeja estaría vacía para siempre. Responder por otro es delegación, explícitamente fuera del MVP (`spec.md` §5).
  - `AppShell` pasó de `isAdmin: boolean` a `role: UserRole`. Con `005` ya son dos los roles que abren navegación propia, y un booleano por rol se multiplica con cada feature.
- [x] **T4.2** — La lista (AC-1.1): pendientes del dev ordenadas por `starts_at`, con proyecto, cliente, franja y la nota del PM. Filas de 36px. _DoD: los cuatro estados de datos de `DESIGN.md` §9._
  - **`getPendingBookingsForDev()` no recorta por rango**, a diferencia de todo lo demás del calendario: una pendiente de dentro de tres meses sigue necesitando respuesta, y esconderla porque no cae en la ventana visible es exactamente cómo se pierde una.
  - **"Sin resultados de filtro" no se implementa porque no puede ocurrir**: la bandeja no es filtrable. Fingir ese estado sería inventar un control que no existe. Los otros tres están: `loading.tsx`, el vacío, y el error boundary de la ruta.
  - El vacío rompe el "botón con verbo" de §9 a propósito y como dice `plan.md` §6: acá el vacío es buena noticia, y el dev no tiene ningún verbo que ejercer sobre una lista vacía. Queda un link al calendario, que sí es un destino honesto.
  - La fila avisa cuando la reserva cae fuera de la jornada o en día no laborable, reusando `describeBookingWarnings()` — la misma advertencia que ve el PM al crearla, palabra por palabra. Importa más acá que en el diálogo: sin recorte por rango, una pendiente puede caer fuera de la tabla de feriados cargada, y esa función ya sabe qué contestar en ese caso.
- [x] **T4.3** — Aprobar: un clic, sin diálogo. `Aprobar` es la acción primaria de la vista; `Rechazar` secundaria con texto en `--danger` (`DESIGN.md` §7).
- [x] **T4.4** — Diálogo de rechazo con comentario **obligatorio**. Validar al usar el botón, no deshabilitándolo — misma decisión que `004` T3.1.
- [x] **T4.5** — `Aprobar` / `Rechazar` en el popover del bloque del calendario cuando el que mira es el dev asignado y la reserva está `pending`. Reusa `BookingActionsProvider`. _DoD: el PM sigue viendo `Editar` / `Cancelar` y nada más._
  - **Provider propio (`BookingResponseProvider`) en vez de sumarlo a `BookingActionsProvider`.** Son dos permisos distintos —el PM administra, el dev se compromete— y, sobre todo, la bandeja necesita solo este: fusionarlos la habría obligado a arrastrar el formulario de alta y sus opciones de proyecto y desarrollador, que no usa.
  - Las dos acciones van en **su propia fila** del popover, separadas de `Editar` / `Cancelar`: un admin que además es el dev asignado ve las dos cosas, y no son lo mismo.
- [x] **T4.6** — Estado de conflicto y de carrera en la UI: el 409 del constraint muestra la reserva que bloquea (componente de `004`); el 409 de `expectedUpdatedAt` dice que la reserva cambió y refresca la bandeja. _DoD: el motivo siempre en palabras, nunca solo color._
  - `ConflictNotice` salió de `booking-dialog.tsx` a `booking-conflict.tsx` para poder reusarlo. **El título es parametrizable porque el conflicto se le cuenta distinto a cada uno:** al PM, "Malena ya tiene una reserva aprobada en esa franja"; al dev que está aprobando la suya, "Ya tenés aprobada otra reserva en esa franja". Es la misma fila de la base y la tercera persona sonaría a que el problema es de otro.
  - Los dos errores son **diálogos y no un cartel al pie** porque la respuesta se puede disparar desde el popover del calendario, que se cierra al hacer clic: un error renderizado ahí adentro desaparecería con él.
  - El caso "la reserva cambió" refresca además de avisar. No es cortesía: el próximo intento tiene que salir con el `updated_at` nuevo o vuelve a rebotar por lo mismo.
- [x] **T4.7** — E2E: el dev entra a la bandeja, aprueba una, rechaza otra con comentario, y el PM ve los dos estados en el calendario. Más el caso de la carrera.
  - `tests/e2e/approvals.spec.ts`, cuatro tests. Fechas propias en mayo de 2027 —`bookings.spec.ts` usa abril— y calentamiento de la ruta de respuesta en cada test, como en `004` T4.5.
  - El de rechazo **intenta primero sin motivo**: es lo único que prueba que la validación es al usar el botón y no deshabilitándolo. Con un botón apagado no habría nada que clickear ni mensaje que leer.
  - El de la carrera mueve la reserva por debajo del navegador con `service_role` (`moveBooking()`): lo que hace falta es que `updated_at` avance, no volver a ejercitar el camino de escritura del PM.

> **Estado de la fase:** escrita, con `pnpm typecheck`, `pnpm lint` y `pnpm test:unit` (140) en verde local. **Los E2E solo corren en CI.** Falta la revisión visual en ambos temas y a los tres anchos, que es T5.5 y necesita ojos humanos.

## Phase 5 — Docs & handoff

- [ ] **T5.1** — `CLAUDE.md`: sumar a la sección "Reservas" que el dev ya escribe, acotado a `status` y `response_note` **por trigger, no por policy**, y por qué.
- [ ] **T5.2** — `DESIGN.md` §14: lo que `005` aplique del sistema.
- [ ] **T5.3** — `specs/features/README.md`: `005` a `done`. Cerrar Q-5 y dejar Q-6 apuntando a `006`.
- [ ] **T5.4** — ADR solo si aparece algo transversal. **Candidato probable:** que la autorización por columna se resuelva con trigger porque la RLS de Postgres no la expresa — lo heredan `006` (realocación escribe `status`) y `010`.
- [ ] **T5.5** — Revisión visual en ambos temas, a 1280 / 1440 / <1024px. Necesita ojos humanos.

---

## Blocked / follow-ups

- [!] **B1** — **`pnpm db:types` sigue sin poder correr: falta un personal access token de la cuenta dueña del proyecto.** No bloquea la fase 2 —los tipos están parcheados a mano (T1.3)—, pero sí deja una diferencia posible entre el archivo generado y el escrito. Cuando aparezca el token: `supabase login` → `pnpm exec supabase link --project-ref gnasmpblvarluuwtjprq` → `pnpm db:types` → **el diff tiene que dar vacío**. Si no da vacío, gana el generado.
- [ ] **B2** — **`seed.sql` nunca se corrió contra el remoto.** `db push` aplica migrations, no el seed; para eso es `pnpm db:seed`, y con él se cierra la segunda mitad del DoD de T1.4 (dos corridas seguidas sin fallar ni duplicar). Ojo: el seed reescribe las reservas `…0051–005e` a la semana actual, así que se lleva puesto cualquier cambio hecho a mano sobre esas filas.
- [ ] **F1** — **Notificaciones (AC-1.2, AC-2.1 parcial, AC-3.1).** Diferidas a `010` por decisión del 2026-08-12. Hasta entonces el dev se entera entrando a la app. **No simularlas con un toast:** dejaría la ilusión de que la otra persona se enteró. Hereda también el badge de pendientes en el nav.
- [ ] **F2** — **Push a Google Calendar al aprobar** (AC-2.1) — es `007`. `005` deja el evento en `audit_log`, que es de donde `007` puede colgarse.
- [ ] **F3** — **Deshacer una respuesta.** Hoy solo se responde una reserva `pending` (`plan.md` §3.3). Que el dev se desdiga es una conversación con el PM, no un botón; si el cliente lo pide después de usarlo, la regla se relaja en `nextStatusAfterResponse` y en el trigger, no en el modelo.
- [ ] **F4** — Q-6 (¿la realocación por prioridad saltea la aprobación del dev?) sigue abierta y ahora **es de `006`**: acá el default es que el dev siempre aprueba.
- [ ] **F5** — Q-F de `spec.md` §7: sin timeout de aprobación en el MVP. El recordatorio pasadas X horas necesita `010`.
- [ ] **F6** — `audit_log` solo lo lee el admin. Que el PM vea el historial de su reserva —quién la aprobó y cuándo— es de `010`.
