# Features — MVP DevsCalendar

Índice de las features que componen el MVP (Fase 1 de la spec funcional, Sección 13). Se derivan del alcance dentro de MVP (Sección 2.2) y del modelo de datos conceptual (Sección 10).

## Estado

Cada feature tiene un `spec.md` como stub. `plan.md` y `tasks.md` se crean cuando la feature entra en desarrollo.

Una feature pasa a `done` cuando sus tasks están cerradas y sus tests pasan. Si quedan preguntas por confirmar con el cliente que no bloquean la implementación (porque hay un default razonable ya aplicado), se listan abajo y se arrastran hasta la feature que sí las necesita resuelta. **Las de `001` a `006` se cerraron el 2026-09-07** confirmando el default aplicado en cada caso; las de las features en `draft` se responden cuando cada una arranque.

| #   | Feature                                           | Estado | Depende de         | Ref. spec funcional |
| :-- | :------------------------------------------------ | :----- | :----------------- | :------------------ |
| 001 | Auth & permissions                                | done   | —                  | §3, §12 (seguridad) |
| 002 | Entities admin (users, clients, projects)         | done   | 001                | §3, §10             |
| 003 | Calendar UI (day/month/year + grouping + filters) | done   | 001, 002           | §4                  |
| 004 | Bookings CRUD                                     | done   | 001, 002, 003      | §5, §9              |
| 005 | Approval flow (dev approve/reject)                | done   | 004                | §6, §9              |
| 006 | Priority & reallocation                           | done   | 004, 005           | §7                  |
| 007 | Google Calendar push integration                  | draft  | 005                | §8.1                |
| 008 | Jira integration                                  | draft  | 004                | §8.2                |
| 009 | Slack integration                                 | draft  | 004, 005           | §8.3                |
| 010 | Notifications & audit log                         | draft  | 004, 005, 006      | §7, §12             |
| 011 | Planning view (grilla semanal de carga)           | draft  | 003, 004, 005, 006 | §4, §12             |
| 012 | Roles múltiples y `active` con dientes            | done   | 001, 002           | §3, §12 (seguridad) |
| 013 | Saldar la deuda registrada que queda              | done   | 012                | §3, §12 (seguridad) |

## Orden sugerido de implementación

Basado en dependencias y valor incremental:

1. **001-auth-and-permissions** — sin auth no hay nada. Google SSO + roles + RLS base.
2. **002-entities-admin** — sin clientes/proyectos/devs no hay contra qué reservar.
3. **003-calendar-ui** — shell del calendario, aunque sea con datos vacíos.
4. **004-bookings** — CRUD de reservas incluyendo constraint anti doble-booking.
5. **005-approval-flow** — el flujo que convierte pending en approved.
6. **006-priority-reallocation** — el diferenciador de negocio, y lo que le da a `010` su último evento (`displaced`). **Decidido el 2026-09-03 que va antes que `010`**, alineando esta lista con la tabla de dependencias de arriba, que ya decía que `010` depende de `006`. El orden inverso obligaba a escribir el adapter de notificación de un evento que todavía no existe, y a retocarlo después.
7. **010-notifications-and-audit** — cierra de una sola vez lo que `005` dejó abierto (AC-1.2 y AC-3.1, por la decisión del 2026-08-12 de salir sin avisos) y lo que `006` deja abierto (AC-2.1, avisarle al PM desplazado). **Es gate duro antes del primer deploy con usuarios reales:** sin esto, a alguien le sacan una reserva confirmada y se entera mirando el calendario. Hoy el riesgo es cero porque no hay nada deployado; el día que lo haya, deja de serlo.
8. **007-google-calendar** — se activa cuando ya hay approvals reales que empujar.
9. **008-jira-integration** — asociación de tickets, se puede hacer en paralelo desde que existan bookings.
10. **009-slack-integration** — última porque combina lo de notifications con la asociación de canales.
11. **011-planning-view** — vista de planificación semanal (grilla cliente > proyecto > dev × días). **Paralelizable con las integraciones** porque solo lee bookings y no depende de `010`. Va después de `006` porque consume el estado `displaced` en el popover, pero no lo bloquea.

**Fuera de esta lista, porque no salieron de la spec funcional sino del registro de deuda:** `012-multiple-roles-and-active-enforcement` y `013-registered-debt-cleanup`, las dos del 2026-09-08. `012` es prerequisito de `010` —sin ella las notificaciones salen hacia un `pm_id` que puede no ser quien lleva el proyecto— y `013` cerró todo lo demás salvo D-06.

Este orden se revisa cuando haya feedback del cliente o cambien las prioridades.

---

## Deuda técnica registrada

Aparte de las preguntas de abajo —que son decisiones del cliente— hay deuda
**técnica** conocida: nueve puntos levantados el 2026-09-07 —ocho auditando los
seis `tasks.md` cerrados contra el código, y D-09 de una conversación del mismo
día—, **de los que queda uno solo abierto**: las otras ocho se saldaron el
2026-09-08, tres con `012` y cinco con `013`. Viven en
[`docs/deuda-tecnica.md`](../../docs/deuda-tecnica.md), con archivo y línea, y
repetidos en la sección "Deuda registrada" del `tasks.md` de cada feature.

**No se saldan sin OK explícito del usuario.** La que queda es **D-06**, que es
gate antes del primer usuario real: confirmar en el navegador los permisos de
`/admin/*` con una cuenta de Google real. Todo lo automatizable de esa deuda ya
está cubierto por tests; lo que falta no lo puede hacer una suite, porque las
fixtures plantan la cookie de sesión en vez de pasar por OAuth.

---

## Preguntas abiertas con el cliente

**Las de las features `001` a `006` están cerradas desde el 2026-09-07:** el
usuario confirmó que **la respuesta es, en todos los casos, el default que ya
está aplicado en el código**. Ninguna requiere trabajo: lo que salió es lo que
se quería. Quedan abajo, tachadas, porque el registro de _por qué_ algo es como
es vale más que la lista corta.

**Las de las features en `draft` se responden cuando la feature arranque**, no
antes. Cada una tiene una recomendación escrita y ningún código que revertir.

**Sobre la numeración:** las preguntas **numeradas** (`Q-1` … `Q-10`) vienen de
`devscalendar-specs.md` §11 y conservan ese número; las **con letra** (`Q-A` …
`Q-O`) aparecieron durante el SDD; las `Q-P*` son de `011` y las `Q-Q*` de `012`,
cada una con su prefijo para no repetir el choque de rótulos de más abajo. Cada una vive con su enunciado completo en el `spec.md` de su
feature; esta tabla es el índice, no la fuente.

> **Dos rótulos se corrigieron el 2026-09-07, porque el mismo identificador
> nombraba dos preguntas distintas:** el `Q-F` de `005` (timeout para aprobar)
> pasó a **`Q-N`**, y el `Q-G` de `006` (si la reserva desplazada se restaura)
> pasó a **`Q-O`**. Los `Q-F` y `Q-G` originales son los de `003` y `004`
> —jornada laboral y qué hacer fuera de ella—, respondidos por el cliente el
> 2026-08-05. En la misma pasada se corrigió la fila que esta tabla listaba como
> `Q-6` y era `Q-1`.

### Cerradas — features 001–006 y 012

Las de `001` a `006`, todas con la misma respuesta: **el default aplicado,
confirmado el 2026-09-07**. Las dos de `012` (`Q-Q1` y `Q-Q2`) salieron
directamente con su default el 2026-09-08.
La columna de la derecha dice qué habría que tocar si algún día se revierte, que
es la única razón por la que esta tabla sigue existiendo.

| #        | Pregunta                                                                                              | Respuesta                                                                                                                                                                                                   | Qué costaría revertirla                                                                                                                                                                                                                                                                                 |
| :------- | :---------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~Q-A~~  | ~~¿Un proyecto puede tener varios PMs?~~                                                              | **No: un PM primario obligatorio.** Los colaboradores quedan para Fase 2.                                                                                                                                   | `projects.pm_id` es `not null` y es la puerta de `can_manage_booking()` y de `reallocate_booking()`. Cambiarlo redefine quién puede desplazar, no solo quién puede editar. **Destraba D-09** (`docs/deuda-tecnica.md`), que esperaba esta respuesta para no pagar dos veces la migración de pertenencia |
| ~~Q-B~~  | ~~¿Un dev puede trabajar para varios clientes a la vez?~~                                             | **Sí, el dev es transversal**; la reserva lo asigna a un proyecto.                                                                                                                                          | Nada hoy: no hay restricción en el modelo. Agregarla después invalidaría reservas ya cargadas                                                                                                                                                                                                           |
| ~~Q-2~~  | ~~¿Dos niveles de prioridad o esquema numérico P0–P3?~~                                               | **Dos niveles** (`común` / `prioritario`).                                                                                                                                                                  | El empate entre dos prioritarios **no se resuelve solo**: la app lo manda a los PMs con el error `DC002` (AC-1.3 de `006`). Si eso pasa seguido, la respuesta cambia: es una migration simple sobre el `check` de `priority`, pero arrastra `canDisplace()` y el color de `DESIGN.md` §3                |
| ~~Q-6~~  | ~~¿El rol Cliente (stakeholder externo) accede a la plataforma?~~                                     | **No accede.** El enum `user_role` queda en `admin`, `pm` y `developer`; el rol Cliente es Fase 2.                                                                                                          | Un valor más en el enum y su UI. **Se responde junto con D-09**, que ya reescribe ese enum: sumarlo después es tocarlo dos veces                                                                                                                                                                        |
| ~~Q-1~~  | ~~¿La realocación por prioridad saltea también la aprobación del dev?~~                               | **No saltea.** La reserva realocada nace `pending` como cualquier otra. Cerrada por implementación el 2026-09-03 y confirmada ahora.                                                                        | Abrirle una excepción al guard de columnas de ADR 0009, no solo escribir `status`                                                                                                                                                                                                                       |
| ~~Q-5~~  | ~~¿El desarrollador ve el calendario global o solo su propia agenda?~~                                | **Global en modo lectura**, y la bandeja es una vista sobre eso. Cerrada el 2026-08-31 con `005`.                                                                                                           | El filtro por `dev_id` de `/inbox` vive en el query, no en una policy. Restringirlo de verdad es reescribir la RLS de `bookings`                                                                                                                                                                        |
| ~~Q-10~~ | ~~Multi-timezone: ¿el calendario se muestra en la TZ del viewer o en una fija?~~                      | **TZ del navegador.** En DB siempre `timestamptz` (UTC), que es correcto en cualquier caso.                                                                                                                 | `src/lib/calendar/range.ts` es el único punto de conversión. **`007` hereda esta decisión**: el evento que se empuje a Google Calendar sale con la misma referencia                                                                                                                                     |
| ~~Q-C~~  | ~~¿Hace falta vista Semana además de día/mes/año?~~                                                   | **No una vista Semana tipo Google Calendar.** El paneo semanal lo cubre `011-planning-view` por otro camino: una grilla de 4 semanas con cliente > proyecto > dev en filas.                                 | Nada: no hay código de vista Semana que sacar. Si el cliente la pide igual, es una vista más sobre el mismo pipeline de `003`                                                                                                                                                                           |
| ~~Q-7~~  | ~~¿Se gestionan vacaciones, licencias y feriados?~~                                                   | **Fuera del MVP.** Las ausencias no se modelan; los feriados argentinos están hardcodeados.                                                                                                                 | **Deja viva F5 de `003`:** la lista de feriados necesita mantenimiento anual a mano, porque los trasladables se fijan por decreto. Cuando entre Fase 2, esa lista pasa a tabla con ABM                                                                                                                  |
| ~~Q-8~~  | ~~¿La unidad de reserva es franja libre o bloques fijos de X horas?~~                                 | **Franja libre** (inicio–fin), como Google Calendar.                                                                                                                                                        | Solo el formulario, no el modelo: `bookings.starts_at` / `ends_at` sirven para las dos formas                                                                                                                                                                                                           |
| ~~Q-Q1~~ | ~~¿Un usuario puede quedarse sin ningún rol desde la UI?~~                                            | **No: el schema exige al menos uno** (400). Quedarse sin roles se parece a dar de baja, y para eso está `active`, que deja el motivo. El conjunto vacío existe solo para quien todavía no fue dado de alta. | `userRolesSchema` en `src/lib/validation/users.ts`. Salió así en `012`                                                                                                                                                                                                                                  |
| ~~Q-Q2~~ | ~~¿Un admin puede desactivarse a sí mismo o quitarse el rol admin?~~                                  | **Sí, sin protección especial.** Con más de un admin no es un problema, y con uno solo el arreglo es por base.                                                                                              | Un guard en `PATCH /api/users/[id]`, si el equipo lo pide. Salió así en `012`                                                                                                                                                                                                                           |
| ~~Q-N~~  | ~~¿Hay timeout para que el dev apruebe? Si no responde en X horas, ¿qué pasa?~~                       | **Sin timeout.** La reserva queda `pending` hasta que el dev responda.                                                                                                                                      | El recordatorio que la pregunta imaginaba es material de `010`; hoy no hay ningún job que mire la antigüedad de una `pending`. Era el `Q-F` de `005`                                                                                                                                                    |
| ~~Q-O~~  | ~~Si la reserva prioritaria que desplazó a otra se cancela, ¿la desplazada se restaura?~~             | **No se restaura.** El PM anterior decide si reasigna.                                                                                                                                                      | `reallocate_booking()` no guarda de quién tomó la franja más allá del `audit_log`. Restaurar automáticamente exige saber si la franja sigue libre, que es una segunda realocación. Era el `Q-G` de `006`                                                                                                |
| ~~Q-F~~  | ~~¿Cuál es la jornada laboral y qué días no se trabaja?~~                                             | **09:00–17:00; no se trabaja fines de semana ni feriados argentinos.** Respondida el 2026-08-05.                                                                                                            | `src/lib/calendar/workdays.ts` y `load.ts`                                                                                                                                                                                                                                                              |
| ~~Q-G~~  | ~~Si un PM quiere reservar fuera de 09:00–17:00 o en un día no laborable, ¿se bloquea o se permite?~~ | **Solo advertencia, nunca bloqueo**, en ambos casos. Respondida el 2026-08-05.                                                                                                                              | `004/spec.md` AC-1.4. Los schemas de Zod no conocen la jornada **a propósito**, para que nadie convierta la advertencia en error                                                                                                                                                                        |
| ~~Q-E~~  | ~~¿Editar una reserva ya aprobada invalida la aprobación?~~                                           | **Cambiar horario o desarrollador la devuelve a `pending`**; nota y ticket no. Respondida el 2026-08-06.                                                                                                    | `004/plan.md` §4                                                                                                                                                                                                                                                                                        |

> **Q-D** (elección de librería de calendario) no está en esta tabla a propósito:
> nunca fue una pregunta para el cliente. Se cerró dentro de `003` —grilla propia
> sobre CSS grid— y quedó documentada en el ADR 0007.

### Abiertas — features todavía en `draft` (007–011)

Se responden cuando la feature entre en desarrollo. **No hay código que las
implemente, así que no hay nada que revertir** — solo una recomendación escrita
esperando confirmación.

| #        | Pregunta                                                                | Recomendación por defecto                                                                                                 | Feature                                                     |
| :------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------- |
| **Q-9**  | ¿Notificaciones por in-app, Slack, email o todas?                       | In-app siempre, Slack como plugin, email diferido a Fase 2 salvo pedido explícito.                                        | `010` — y `005/spec.md` la marca "**Bloquea:** feature 010" |
| **Q-M**  | Retención del `audit_log`: ¿indefinida o con TTL?                       | Indefinida en MVP; evaluar archivado a los 12–24 meses.                                                                   | `010`                                                       |
| **Q-4**  | ¿Jira y Slack son alternativos o ambos por proyecto?                    | Ambos, configurable por proyecto.                                                                                         | `008` y `009` — "**Bloquea:** modelo de config de proyecto" |
| Q-3      | Google Calendar: ¿solo push o sync bidireccional?                       | Push en MVP, bidireccional en Fase 2. `007/spec.md` la da por confirmada, pero sin fecha ni quién la confirmó.            | `007`                                                       |
| Q-H      | ¿El evento va al calendario primario del dev o a uno dedicado?          | Uno dedicado ("DevsCalendar bookings"), creado la primera vez que el dev linkea su cuenta.                                | `007`                                                       |
| Q-I      | ¿Qué pasa si el dev revoca los permisos después de linkear?             | Marcar el link como roto: el sistema sigue funcionando y le avisa al dev en la UI.                                        | `007`                                                       |
| Q-J      | Auth con Jira: ¿OAuth por usuario o API token compartido?               | API token por proyecto en MVP; OAuth per-user en Fase 2 si hace falta atribución.                                         | `008`                                                       |
| Q-K      | ¿Aprobar desde Slack entra en el MVP?                                   | No, Fase 2: agrega Events API y verificación de firmas, y no es crítico para el caso de uso principal.                    | `009`                                                       |
| Q-L      | ¿Multi-workspace de Slack en el futuro?                                 | Modelar con `workspace_id` desde el inicio aunque en MVP haya uno solo, para no re-migrar.                                | `009`                                                       |
| **Q-P1** | Sobrecarga de un dev: ¿se dispara con `>8 h` estricto o con `≥8 h`?     | `>8 h`: la jornada completa 09:00–17:00 son 8 h netas y no es sobrecarga. "**Bloquea:** definición visual en `DESIGN.md`" | `011`                                                       |
| Q-P2     | Reservas que cruzan medianoche: ¿cómo se reparten las horas entre días? | Dividir por día calendario (22:00–02:00 son 2 h el día X y 2 h el X+1). Raro dentro de 09–17, pero permitido por Q-G.     | `011`                                                       |
| Q-P3     | Proyectos recurrentes: ¿se reflejan como los agrupa la planilla actual? | No en MVP; si el cliente lo pide, un `is_recurring` más su tratamiento visual.                                            | `011`                                                       |
| Q-P4     | ¿Un dev sin reservas en la ventana aparece como fila vacía?             | No: hoy la relación dev–proyecto existe solo a través de reservas. Verlos siempre exige una tabla `project_devs` antes.   | `011`                                                       |

---

**Lo que las respuestas del 2026-09-07 destrabaron:** con **Q-A** y **Q-6**
contestadas, **D-09** (roles múltiples) ya no espera a nadie — era su único
prerequisito de producto. Sigue sin poder tocarse sin OK explícito, pero la
razón para no empezarla dejó de ser "falta preguntar".

**Y una que no es del cliente sino de producto, y sigue sin default aplicado
(R-2 de `006/plan.md` §9):** la prioridad juega al _crear_, no al _aprobar_. Dos
pendientes sobre la misma franja conviven, así que si el dev aprueba primero la
común, el proyecto prioritario pierde la franja sin que nadie haya desplazado
nada. Se eligió la mitigación (a) —la bandeja ordena por prioridad y advierte el
choque— que **lo hace visible sin impedirlo**. Cerrarlo de verdad es desplazar
también al aprobar, y eso abre una pregunta sin contestar: si el dev, al
aprobar, puede pisarle la reserva a un tercero. Ver F4 en `006/tasks.md`.
