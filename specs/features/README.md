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
| 006 | Priority & reallocation | draft | 004, 005 | §7 |
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
6. **010-notifications-and-audit** — aunque llega tarde en la numeración, es la que le falta a 005 para estar completa: se decidió (2026-08-12) que 005 saliera **sin avisos**, con el dev enterándose al entrar a la app, así que 010 arrastra AC-1.2 y AC-3.1. Cuanto antes se haga, menos tiempo vive el flujo a medias.
7. **006-priority-reallocation** — se apoya en bookings + approval + notifications.
8. **007-google-calendar** — se activa cuando ya hay approvals reales que empujar.
9. **008-jira-integration** — asociación de tickets, se puede hacer en paralelo desde que existan bookings.
10. **009-slack-integration** — última porque combina lo de notifications con la asociación de canales.

Este orden se revisa cuando haya feedback del cliente o cambien las prioridades.

---

## Preguntas abiertas con el cliente

Ninguna bloquea la implementación: todas tienen un default ya aplicado en el código. Se listan acá para que no se pierdan, con la feature que necesita la respuesta antes de avanzar.

| # | Pregunta | Default aplicado | Dónde está en el código | Necesaria antes de |
| :---- | :---- | :---- | :---- | :---- |
| Q-A | ¿Un proyecto puede tener varios PMs? | Un PM primario obligatorio. Colaboradores quedan para Fase 2. | `projects.pm_id` (not null) | `006-priority-reallocation` |
| Q-B | ¿Un dev puede trabajar para varios clientes a la vez? | Sí, el dev es transversal; la reserva lo asigna a un proyecto. | Sin restricción en el modelo; el select de `BookingDialog` lista a todos los devs activos | Ya salió así en `004`. Confirmar antes de cargar datos reales: restringirlo después invalidaría reservas existentes |
| Q-2 | ¿Dos niveles de prioridad o esquema numérico P0–P3? | Dos niveles (`común` / `prioritario`), como pidió el cliente. | `projects.priority` + tokens en `DESIGN.md` §3 | `006-priority-reallocation` |
| Q-6 | ¿La realocación por prioridad saltea también la aprobación del dev? | Recomendación de la spec funcional §6: saltea al PM anterior, **no** al dev. | Todavía sin implementar. `005` salió con el default: el dev siempre aprueba, y el trigger lo impone sin mirar el rol (ADR 0009) | `006-priority-reallocation` — **y ahora es cara de cambiar**: si la realocación saltea al dev, `006` tiene que abrirle una excepción al guard de columnas, no solo escribir `status` |
| ~~Q-5~~ | ~~¿El desarrollador ve el calendario global o solo su propia agenda?~~ | **Cerrada el 2026-08-31 con `005`: global en modo lectura, y la bandeja es una vista sobre eso.** El filtro por `dev_id` de `/inbox` vive en el query, no en una policy — acota lo que se muestra, nunca lo que se puede leer. | `getPendingBookingsForDev()` y la RLS de `bookings`, que da `select` a quien tenga rol asignado | — cerrada |
| Q-10 | Multi-timezone: ¿el calendario se muestra en la TZ del viewer o en una fija? | TZ del navegador. En DB siempre `timestamptz` (UTC), que es correcto en cualquier caso. | `src/lib/calendar/range.ts` (único punto de conversión) | `007-google-calendar` |
| Q-C | ¿Hace falta vista Semana además de día/mes/año? | No en el MVP; la spec funcional no la pide. | Sin implementar | Fase 2 |
| ~~Q-F~~ | ~~¿Cuál es la jornada laboral y qué días no se trabaja?~~ | **Respondida el 2026-08-05: jornada fija 09:00–17:00; no se trabaja fines de semana ni feriados argentinos.** | `src/lib/calendar/workdays.ts` y `load.ts` | — cerrada |
| ~~Q-G~~ | ~~Si un PM quiere reservar fuera de 09:00–17:00 o en un día no laborable, ¿se bloquea o se permite?~~ | **Respondida el 2026-08-05: solo advertencia, nunca bloqueo**, en ambos casos. | `004/spec.md` AC-1.4 | — cerrada |
| ~~Q-E~~ | ~~¿Editar una reserva ya aprobada invalida la aprobación?~~ | **Respondida el 2026-08-06:** cambiar horario o desarrollador la devuelve a `pending`; nota y ticket no. | `004/plan.md` §4 | — cerrada |
| Q-8 | ¿La unidad de reserva es franja libre o bloques fijos de X horas? | Franja libre (inicio–fin), como Google Calendar. | `bookings.starts_at` / `ends_at`, más los campos `Desde` / `Hasta` de `BookingDialog` | Ya salió así en `004`. Sigue sin confirmar, pero cambiarla afecta el formulario, no el modelo: es barata de revertir |

**Q-2 es la más urgente de las cuatro:** con solo dos niveles, dos proyectos prioritarios en conflicto no se resuelven solos (spec funcional §7.2), que es justamente el caso que `006` tiene que decidir. Cambiar la escala después es una migration simple (`priority` es un `check`, no un enum — ver `002/plan.md` §9), pero arrastra el sistema de color de `DESIGN.md`.
