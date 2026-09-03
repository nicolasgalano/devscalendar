# Features — MVP DevsCalendar

Índice de las features que componen el MVP (Fase 1 de la spec funcional, Sección 13). Se derivan del alcance dentro de MVP (Sección 2.2) y del modelo de datos conceptual (Sección 10).

## Estado

Cada feature tiene un `spec.md` como stub. `plan.md` y `tasks.md` se crean cuando la feature entra en desarrollo.

Una feature pasa a `done` cuando sus tasks están cerradas y sus tests pasan. Si quedan preguntas por confirmar con el cliente que no bloquean la implementación (porque hay un default razonable ya aplicado), se listan abajo y se arrastran hasta la feature que sí las necesita resuelta.

| # | Feature | Estado | Depende de | Ref. spec funcional |
| :---- | :---- | :---- | :---- | :---- |
| 001 | Auth & permissions | done | — | §3, §12 (seguridad) |
| 002 | Entities admin (users, clients, projects) | done | 001 | §3, §10 |
| 003 | Calendar UI (day/month/year + grouping + filters) | done | 001, 002 | §4 |
| 004 | Bookings CRUD | done | 001, 002, 003 | §5, §9 |
| 005 | Approval flow (dev approve/reject) | done | 004 | §6, §9 |
| 006 | Priority & reallocation | done | 004, 005 | §7 |
| 007 | Google Calendar push integration | draft | 005 | §8.1 |
| 008 | Jira integration | draft | 004 | §8.2 |
| 009 | Slack integration | draft | 004, 005 | §8.3 |
| 010 | Notifications & audit log | draft | 004, 005, 006 | §7, §12 |

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

Este orden se revisa cuando haya feedback del cliente o cambien las prioridades.

---

## Preguntas abiertas con el cliente

Ninguna bloquea la implementación: todas tienen un default ya aplicado en el código. Se listan acá para que no se pierdan, con la feature que necesita la respuesta antes de avanzar.

| # | Pregunta | Default aplicado | Dónde está en el código | Necesaria antes de |
| :---- | :---- | :---- | :---- | :---- |
| Q-A | ¿Un proyecto puede tener varios PMs? | Un PM primario obligatorio. Colaboradores quedan para Fase 2. | `projects.pm_id` (not null), y ahora también `can_manage_booking()`, que es la puerta de `reallocate_booking()` | Ya salió así en `006`. Sigue sin confirmar: si aparecen colaboradores, cambia quién puede desplazar, no solo quién puede editar |
| Q-B | ¿Un dev puede trabajar para varios clientes a la vez? | Sí, el dev es transversal; la reserva lo asigna a un proyecto. | Sin restricción en el modelo; el select de `BookingDialog` lista a todos los devs activos | Ya salió así en `004`. Confirmar antes de cargar datos reales: restringirlo después invalidaría reservas existentes |
| Q-2 | ¿Dos niveles de prioridad o esquema numérico P0–P3? | Dos niveles (`común` / `prioritario`), como pidió el cliente. | `projects.priority`, `canDisplace()` y los tokens de `DESIGN.md` §3 | Ya salió así en `006`. **El empate ya es un caso real, no teórico:** dos prioritarios en conflicto se mandan a los PMs (AC-1.3, error `DC002`). Si eso pasa seguido, la respuesta es P0–P3 |
| ~~Q-6~~ | ~~¿La realocación por prioridad saltea también la aprobación del dev?~~ | **Cerrada por implementación el 2026-09-03: no saltea.** La reserva realocada nace `pending` como cualquier otra (AC-3.1). Nadie la confirmó con el cliente; salió con el default de la spec funcional §6, que es saltear al PM anterior y no al dev. | `reallocate_booking()` inserta `status = 'pending'`, y el trigger de ADR 0009 lo impondría igual | — cerrada. Revertirla ahora significa abrirle una excepción al guard de columnas, no solo escribir `status` |
| ~~Q-5~~ | ~~¿El desarrollador ve el calendario global o solo su propia agenda?~~ | **Cerrada el 2026-08-31 con `005`: global en modo lectura, y la bandeja es una vista sobre eso.** El filtro por `dev_id` de `/inbox` vive en el query, no en una policy — acota lo que se muestra, nunca lo que se puede leer. | `getPendingBookingsForDev()` y la RLS de `bookings`, que da `select` a quien tenga rol asignado | — cerrada |
| Q-10 | Multi-timezone: ¿el calendario se muestra en la TZ del viewer o en una fija? | TZ del navegador. En DB siempre `timestamptz` (UTC), que es correcto en cualquier caso. | `src/lib/calendar/range.ts` (único punto de conversión) | `007-google-calendar` |
| Q-C | ¿Hace falta vista Semana además de día/mes/año? | No en el MVP; la spec funcional no la pide. | Sin implementar | Fase 2 |
| ~~Q-F~~ | ~~¿Cuál es la jornada laboral y qué días no se trabaja?~~ | **Respondida el 2026-08-05: jornada fija 09:00–17:00; no se trabaja fines de semana ni feriados argentinos.** | `src/lib/calendar/workdays.ts` y `load.ts` | — cerrada |
| ~~Q-G~~ | ~~Si un PM quiere reservar fuera de 09:00–17:00 o en un día no laborable, ¿se bloquea o se permite?~~ | **Respondida el 2026-08-05: solo advertencia, nunca bloqueo**, en ambos casos. | `004/spec.md` AC-1.4 | — cerrada |
| ~~Q-E~~ | ~~¿Editar una reserva ya aprobada invalida la aprobación?~~ | **Respondida el 2026-08-06:** cambiar horario o desarrollador la devuelve a `pending`; nota y ticket no. | `004/plan.md` §4 | — cerrada |
| Q-8 | ¿La unidad de reserva es franja libre o bloques fijos de X horas? | Franja libre (inicio–fin), como Google Calendar. | `bookings.starts_at` / `ends_at`, más los campos `Desde` / `Hasta` de `BookingDialog` | Ya salió así en `004`. Sigue sin confirmar, pero cambiarla afecta el formulario, no el modelo: es barata de revertir |

**Q-2 sigue siendo la más urgente, y desde `006` ya no es teórica:** con dos niveles, dos proyectos prioritarios en conflicto no se resuelven solos (spec funcional §7.2), así que la app los manda a hablar entre PMs con un error propio (`DC002`). Eso es aceptable si el empate es raro y es un problema si es el caso común — que es exactamente lo que la pregunta decide. Cambiar la escala es una migration simple (`priority` es un `check`, no un enum — ver `002/plan.md` §9), pero arrastra `canDisplace()` y el sistema de color de `DESIGN.md`.

**Y una que `006` destapó y no tiene default aplicado (R-2 de su `plan.md` §9):** la prioridad juega al *crear*, no al *aprobar*. Dos pendientes sobre la misma franja conviven, así que si el dev aprueba primero la común, el proyecto prioritario pierde la franja sin que nadie haya desplazado nada. Se eligió la mitigación (a) —la bandeja ordena por prioridad y advierte el choque— que **lo hace visible sin impedirlo**. Cerrarlo de verdad es desplazar también al aprobar, y eso abre una pregunta de producto sin contestar: si el dev, al aprobar, puede pisarle la reserva a un tercero. Ver F4 en `006/tasks.md`.
