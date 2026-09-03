# Tasks — Priority & reallocation

- **ID:** 006-priority-reallocation
- **Plan reference:** `./plan.md`
- **Status:** done el 2026-09-03, salvo T5.5 (revisión visual, necesita ojos humanos). **Todo verde en CI** ([run 33791620592](https://github.com/nicolasgalano/devscalendar/actions/runs/33791620592)): 159 unitarios, 9 de integración sobre `reallocate_booking()`, y los 2 E2E del flujo de desplazamiento. De Phase 0 siguen abiertas T0.1 (Q-2) y T0.3 (Q-A), que no bloquearon y salieron con su default.

Legend: `[ ]` open · `[x]` done · `[~]` in progress · `[!]` blocked.

> **Antes de escribir una línea, leer `plan.md` §3.2.** El modo de falla por defecto de esta feature es silencioso: un `update` que la RLS filtra no tira error, no hace nada, y el resultado son dos reservas aprobadas superpuestas sin un solo mensaje. Es el R-1 de la spec.

> **Y leer ADR 0009.** Esta feature escribe `status`, así que pasa por el trigger de `005`. Hoy no choca —`plan.md` §8 explica por qué— pero conviene saberlo antes y no descubrirlo con un `23514`.

---

## Phase 0 — Antes de empezar

- [ ] **T0.1** — **Confirmar Q-2 con el cliente** (¿dos niveles o P0–P3?). No bloquea la implementación —AC-1.3 define qué hacer en el empate— pero sí define si el empate es un caso de borde o el caso común. Si pasa a numérico, cambia la regla de `priority.ts`, la migration de `projects.priority` y el sistema de color de `DESIGN.md` §3.
- [x] **T0.2** — **R-2 resuelto el 2026-09-03: va la opción (a)** de las tres de `plan.md` §9 — la bandeja del dev se ordena por prioridad y lo advierte; **no** se desplaza al aprobar. Era la única pregunta del plan sin default aplicado. La decisión no cierra el agujero, lo hace visible: el dev sigue pudiendo aprobar primero la común, pero deja de ser un accidente. Lo implementa T2.5 y la deuda queda anotada en F4.
- [ ] **T0.3** — Confirmar Q-A (¿varios PMs por proyecto?). Impacta poco acá, pero `can_manage_booking` es la puerta de la función nueva y conviene no reescribirla dos veces.

## Phase 1 — La base

- [x] **T1.1** — Migration `00000000000008_reallocation.sql` con `reallocate_booking()` (`plan.md` §3.3), `security definer`, `search_path` fijo, y los cinco chequeos internos **en orden**. Sin cambios de esquema: no hay columnas ni estados nuevos que agregar. **Escrita, aplicada y verificada el 2026-09-03.** `pnpm db:push` la subió al proyecto de desarrollo, y el [run 33789140700](https://github.com/nicolasgalano/devscalendar/actions/runs/33789140700) la reconstruyó desde cero en el stack efímero con los nueve tests de T3.2–T3.6 en verde.
  - `revoke all … from public` y `grant execute … to authenticated`: hecho.
  - **Desvío del plan, a propósito: `confirmed_displacing uuid[]` entra en la firma**, que `plan.md` §3.3 no listaba. §4 pide que una reserva no confirmada se rechace *en el momento de escribir*, y chequeándolo en el handler queda la misma ventana que `expectedUpdatedAt` cerró en `005`. Adentro de la función no hay ventana.
  - **Y un chequeo que el plan no pedía:** si no hay ninguna `approved` en la franja, la función tira `DC003` en vez de crear la reserva igual. Sin eso el endpoint sería un segundo camino de alta que se saltea el chequeo de conflictos del primero, sin ganar nada.
  - Cada rechazo lleva su propio SQLSTATE (`42501`, `DC001`–`DC004`), para que T2.4 traduzca por código y no por el texto del mensaje. Tabla completa en el encabezado de la migration.
  - _DoD cumplido, aunque en el orden inverso al escrito._ El plan pedía CI antes del `db:push`, y se hizo al revés a propósito (decidido con el usuario el 2026-09-03): sin la migration aplicada en el remoto, `db:types` no podía verificar la firma de la función, y la UI se iba a escribir encima de tipos sin confirmar. El push a la base de desarrollo era reversible con un `drop function` y adelantó ese chequeo — que encontró un error real (ver T1.4). El motivo del DoD —reconstruir desde cero con los tests en verde— se cumplió igual, después.
- [x] **T1.2** — Decidir y aplicar el bloqueo de R-4: `select … for update` sobre las reservas del dev en el rango, adentro de la función. **Aplicado como un `perform … for update` antes de leer los ids**, así el segundo caller espera, re-lee y encuentra la fila ya `displaced`. Documentado también lo que **no** cubre: una reserva aprobada *dentro* del rango después del lock, que no se ataja sin `serializable`. La consecuencia está acotada — lo que insertamos es `pending`, así que no puede doble-bookear, y el exclusion constraint sigue siendo la garantía dura. _DoD: T3.5, que corre en paralelo._
- [x] **T1.3** — Ampliar la auditoría con la fila `reallocated` (`plan.md` §3.4). **Dos filas por evento a propósito**, no una: el trigger de `005` cuenta el cambio de estado, esta cuenta la decisión. Escrita dentro de la función, una fila por reserva desplazada, con `displaced_by` apuntando a la nueva. _DoD: T3.4._
- [x] **T1.4** — `pnpm db:types` corrido el 2026-09-03 contra el remoto ya con `…0008` aplicada. **El archivo generado reemplazó al escrito a mano, y encontró un error real.**
  - **La firma que yo había escrito a mano estaba mal**, y de la forma exacta que se había advertido: puse `booking_note?: string | null` y `ticket?: string | null`, y el generador los da como `booking_note?: string` — opcionales, no nullables, porque en el SQL tienen `default null`. Con los tipos a mano el `rpc` compilaba pasando `null`; con los generados son dos errores de TS. **Nombres de argumentos y orden estaban bien; la nulabilidad no**, que es justo lo que ningún test unitario habría visto.
  - Arreglo en el handler: los dos opcionales viajan como `undefined`, que desaparece al serializar, así el argumento no va y Postgres aplica su default.
  - Absorbió también la deriva de versión del CLI del archivo viejo (`PostgrestVersion` `14.15` → `14.5` y cinco paréntesis en los helpers genéricos).
  - **Comparar siempre con `diff --strip-trailing-cr`**: el working tree tiene CRLF por `core.autocrlf=true` y el generador escribe LF, así que un `diff` normal marca el archivo entero y no se puede leer. Para git la diferencia no existe.

## Phase 2 — Reglas y API

- [x] **T2.1** — `src/lib/bookings/priority.ts`: la matriz de `plan.md` §5 como función pura — `canDisplace(newPriority, existingPriority)` y `explainDisplaceRefusal(...)`. **El empate y la prioridad insuficiente devuelven motivos distintos**: uno dice "no podés", el otro "hablalo con el otro PM". Los motivos son valores (`"tie"` / `"insufficient"`), no strings formateados, para que no se vuelvan a colapsar en el camino a la UI; el copy sale de `describeDisplaceRefusal()`. También exporta `REALLOCATION_ERRORS`, el mapa de SQLSTATEs que T2.4 traduce. _DoD: T3.1 — la matriz completa en verde._
- [x] **T2.2** — Ampliar `findConflictingBooking()` para que el conflicto diga **si es desplazable**. Hoy devuelve la reserva que bloquea; ahora tiene que traer también la prioridad de su proyecto, o la UI no puede decidir qué ofrecer. Suma `projectPriority` y `pmName` — **los hechos, no el veredicto**: si es desplazable lo decide `canDisplace()`, para que la regla viva en un solo lado. `pmName` viaja porque el empate manda a hablar con alguien y sin nombre eso no es un consejo.
  - El embed del PM es left join a propósito: un PM dado de baja no puede hacer desaparecer el conflicto de la respuesta.
  - **El select cambió, así que los smoke tests son los que lo verifican.** Un embed inválido de PostgREST typechequea igual y falla en runtime.
- [x] **T2.3** — Schema Zod del alta con realocación: el del alta más `confirmedDisplacing: string[]`, requerido y no vacío. Los campos comunes salen de un objeto compartido con `createBookingSchema`, no de un `.extend()` — el alta normal es un `ZodEffects` por su `refine` y no se puede extender. _DoD: T3.1._
- [x] **T2.4** — `POST /api/bookings/reallocate` (`plan.md` §4). Body con `readJsonBody()`. Guard `requireBookingAccess(projectId)` **del proyecto nuevo**. Las tres traducciones de error de §4, con **el empate y la prioridad insuficiente como mensajes distintos**. Escrita; sin ejecutar hasta que corra CI, porque su única llamada real es el `rpc` a la función de T1.1.
  - Además del mensaje, cada 409 devuelve `reason` (`"insufficient"` / `"tie"` / `"stale"`) y el conflicto releído. **La UI se apoya en `reason`, no en el texto:** T4.3 pide que los dos 409 se lean distinto, y un mensaje reescrito no puede ser lo que sostenga esa diferencia.
  - **`src/types/database.ts` quedó parcheado a mano otra vez** —la entrada `reallocate_booking` en `Functions`— por el mismo bloqueo de B1. Es más frágil que parchear una columna: si el nombre de un argumento no coincide con el SQL, TypeScript no lo nota y falla en runtime. T1.4 lo verifica cuando aparezca el token.
  - _DoD: T3.2, T3.3._
- [x] **T2.5** — **Mitigación (a) de R-2** (T0.2): `/inbox` ordena por prioridad del proyecto antes que por fecha, y la reserva prioritaria queda marcada en la bandeja. `getPendingBookingsForDev()` (`src/lib/calendar/query.ts:172`) hoy ordena solo por `starts_at`, y `BOOKING_COLUMNS` **ya trae `project.priority`** en el embed: no hace falta tocar el select.
  - El criterio es **prioritario primero, después `starts_at`**. Si el `.order()` de PostgREST sobre la columna embebida no ordena como se espera, se ordena en JS después del `map` — son cuatro pendientes por dev, no un dataset.
  - La marca visual usa **el mismo token de prioridad que el calendario** (`DESIGN.md` §3), no uno nuevo. Y dice por qué está primera; un badge sin explicación no advierte nada.
  - _DoD cumplido:_ `comparePendingBookings` y `outrankedByPending` en `priority.ts`, con cinco unit tests. `pnpm test:unit` da **159 en verde**.
  - **La advertencia terminó siendo más precisa de lo que pedía la task.** En vez de un badge genérico en toda reserva prioritaria, `outrankedByPending()` cruza las pendientes entre sí y marca **solo las comunes que efectivamente se superponen con una prioritaria pendiente** — que son las únicas donde aprobar primero tiene consecuencia. Avisar en todas habría sido ruido, y el ruido se aprende a ignorar.
  - Tratamiento de §8: `circle-alert` sobre `--attention`, botones de responder intactos. Aprobar la común no es un error, es una decisión; lo que faltaba era que el dev supiera que la estaba tomando.

## Phase 3 — Tests

- [x] **T3.1** — Unit: la matriz de los cuatro casos completa, y el schema. Los dos en `tests/unit/booking-priority.test.ts`, más el conflicto con prioridad en `query-layer.test.ts`. `pnpm test:unit` da **154 en verde**. _DoD: corren sin Supabase — cumplido._
- [x] **T3.2** — **Integración, el que no puede faltar (R-1):** el PM prioritario desplaza una común aprobada; el común **no** desplaza una prioritaria; dos prioritarias no se desplazan entre sí.
  - **Verificar leyendo las filas de vuelta**, siempre: que la vieja quedó `displaced` **y** que la nueva quedó `pending`. Un test que solo mire el error pasaría con la RLS filtrando en silencio, que es exactamente el modo de falla de `plan.md` §3.2.
  - Y el caso que parece obvio y no lo es: **una reserva común `pending` no se desplaza**, porque no ocupa nada.
  - Escritos los ocho casos en `tests/integration/reallocation.test.ts` el 2026-09-03, más uno que el plan no pedía: `confirmedDisplacing` que no coincide con lo que hay. **Ninguno corrió todavía** — necesitan el stack efímero.
- [x] **T3.3** — Integración de atomicidad: forzar el fallo del segundo paso y verificar que **el primero tampoco quedó**. Es lo único que prueba que la función es atómica y no dos escrituras seguidas con suerte.
  - **Cómo se fuerza, porque no era evidente:** una franja de **duración cero adentro** de la reserva existente. Se superpone igual —`starts_at < ends` y `ends_at > starts` se cumplen las dos con un instante interior—, así que la función llega hasta el `update` y desplaza; el `insert` posterior es el que revienta contra `bookings_ends_after_starts`. Sin DDL, que desde supabase-js no hay forma de correr.
  - Se verifica también que **no quedó la fila de `audit_log`**: el trigger de `005` escribe en la misma transacción, así que una fila sobreviviente probaría que no hubo rollback.
- [x] **T3.4** — Integración de auditoría: una realocación deja las dos filas de `plan.md` §3.4, y la de `reallocated` nombra la reserva que desplazó.
- [x] **T3.5** — **Concurrencia (R-4):** dos realocaciones prioritarias en paralelo sobre la misma franja del mismo dev. _DoD: en paralelo, no en serie._
  - Dos PMs de dos proyectos prioritarios distintos, con `Promise.all`. Se espera **una sola ganadora**, y que la perdedora reciba `DC003` y no un segundo desplazamiento: cuando la primera commitea, la común ya está `displaced` y la segunda no encuentra nada aprobado en la franja. La aserción final es la que importa — una `pending` nueva y una `displaced`, nunca dos.
- [x] **T3.6** — Integración del guard: alguien que no es PM del proyecto nuevo llama a la función y no pasa. Es el chequeo 1 de `plan.md` §3.3, y sin él `security definer` es una puerta abierta.
  - Se llama a la función **directo**, sin pasar por la ruta: el guard de `requireBookingAccess` taparía el agujero y el test no probaría lo que dice probar.

> **Fixture con su propia franja por test**, y todo `update` del que dependa una aserción posterior chequea su propio error primero. Las dos reglas salieron de `005` T3.2, donde un test pasaba sin probar nada.

## Phase 4 — UI

- [x] **T4.1** — El conflicto desplazable en `BookingDialog`: `circle-alert` sobre `--attention` y el botón habilitado, **nunca** `alert-triangle` sobre `--danger` — eso queda para el que impide seguir (`DESIGN.md` §8, `plan.md` §6).
  - Resuelto con un `tone` en `ConflictNotice` en vez de un componente nuevo: el link al día, el layout y el texto del conflicto son los mismos, y lo único que cambia es si hay salida. Un segundo componente habría que mantenerlo en paralelo.
  - La UI se adelanta con `canDisplace()`, pero **no es la autoridad**: si el servidor contesta que no, `refusal` apaga la oferta. La base vuelve a aplicar la regla adentro de la función.
- [x] **T4.2** — Diálogo de confirmación: qué reserva se pisa, de qué proyecto, de qué PM, y **que no se restaura sola** si esta después se cae (AC-3.2). _DoD: el motivo siempre en palabras._
  - Escrito, con una cuarta cosa que ninguna task pedía: **que todavía no hay avisos automáticos**, así que conviene que el PM se lo cuente al otro. Es la mitigación honesta de F1 mientras `010` no exista — dejar que lo suponga sería peor.
- [x] **T4.3** — Los dos 409 distinguibles en la UI: prioridad insuficiente vs. empate. Si se leen igual, el PM no sabe si buscar otra franja o levantar el teléfono.
  - La UI se apoya en `reason`, no en el texto del mensaje, y `describeDisplaceRefusal()` arma el copy. `stale` no deja motivo pegado: la franja cambió, así que la regla local vuelve a evaluar y puede volver a ofrecer desplazar.
- [x] **T4.4** — E2E: el PM prioritario desplaza, y el PM desplazado ve su reserva en `displaced` **sin tocar ningún filtro** (ya está en `DEFAULT_STATUSES`). Más el caso bloqueado.
  - **Encontró un bug real en la primera corrida** ([run 33790777539](https://github.com/nicolasgalano/devscalendar/actions/runs/33790777539)): al desplazar con éxito, el diálogo de confirmación no se cerraba nunca. El padre solo baja el `open` del diálogo de reserva, y la confirmación tiene estado propio; el PM quedaba mirando un modal trabado sobre un calendario ya actualizado. El síntoma en el test fue que no encontraba el bloque nuevo — **porque un modal abierto deja inerte al resto de la página**, así que el bloque estaba en el DOM y era invisible para el locator por rol. Arreglado con un `setConfirmingDisplace(false)` en el camino feliz.
  - Es exactamente lo que el E2E existe para agarrar: typecheck, lint y 159 unitarios pasaban con el diálogo trabado.
  - Calentamiento de la ruta nueva en `beforeAll` y **una fecha por test**, como en `004` T4.5 y `005` T4.7.

## Phase 5 — Docs & handoff

- [x] **T5.1** — `CLAUDE.md`: sumar a "Reservas" que desplazar pasa por una función `security definer` y por qué la policy no alcanza.
- [x] **T5.2** — `DESIGN.md` §14: lo que `006` aplique, incluida la distinción entre el conflicto que bloquea y el que se puede desplazar.
- [x] **T5.3** — `specs/features/README.md`: `006` a `done`. **Q-6 cerrada por implementación** —la realocada nace `pending`, y revertirlo ahora exige abrirle una excepción al guard de columnas— con la aclaración de que nadie la confirmó: salió con el default. **Q-2 y Q-A siguen abiertas** y ya no bloquean nada, pero cambiaron de carácter: el empate entre prioritarios dejó de ser teórico y tiene su propio error (`DC002`), así que la pregunta ahora es si pasa seguido. Sumado R-2 a la lista, que es la única sin default aplicado.
- [x] **T5.4** — **ADR 0010 escrito**: una escritura que cruza proyectos de distinto dueño se resuelve con una función `security definer`, no con policies. Hermano de ADR 0009 y lo hereda `007`. La pregunta que deja para el futuro no es "¿cómo le doy permiso a este usuario?" sino **"¿esta operación cruza proyectos de distinto dueño?"** — si la respuesta es sí, la policy no alcanza.
- [ ] **T5.5** — Revisión visual en ambos temas, a 1280 / 1440 / <1024px. Necesita ojos humanos.

---

## Blocked / follow-ups

- [ ] **F1** — **Notificar al PM desplazado y al dev (AC-2.1).** Es de `010`, y acá **pesa más que en `005`**: ahí el que esperaba era el dev, que entra a la app igual; acá a alguien le sacan una reserva ya confirmada sin pedirle permiso. Mitigación parcial hasta entonces: `displaced` es visible por default y el rastro queda en `audit_log`. **No simularlo con un toast.**
- [ ] **F2** — **Restaurar la desplazada** si la prioritaria se cancela o el dev la rechaza. Fuera del MVP por AC-3.2 y Q-G. Si el cliente lo pide, la vuelta es de `displaced` a `approved`, y hay que decidir qué pasa si la franja se ocupó mientras tanto.
- [ ] **F3** — **Borrar el evento de Google Calendar de la reserva desplazada.** Es de `007`. Sin eso, el dev tiene en su calendario personal un bloque que ya no existe en el producto.
- [ ] **F4** — **R-2, opción (b): desplazar también al aprobar.** Descartada del MVP el 2026-09-03 a favor de (a) — ver T0.2 y T2.5. **La deuda que queda, en concreto:** si el dev aprueba primero la común, la prioritaria ya no puede aprobarse —choca contra el exclusion constraint— y el proyecto prioritario pierde la franja sin que nadie haya desplazado nada. (a) lo hace visible; no lo impide. Si aparece en el uso real, (b) mete la realocación adentro del camino de respuesta del dev, que es justo el que ADR 0009 tiene acotado por el guard de columnas, y abre una pregunta de producto que hoy no está contestada: si el dev, al aprobar, puede pisarle la reserva a un tercero.
- [ ] **F5** — Empate entre prioritarios (Q-2 / R-5). Con dos niveles no se resuelve solo; AC-1.3 lo manda a los PMs.
