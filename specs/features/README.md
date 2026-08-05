# Features — MVP DevsCalendar

Índice de las features que componen el MVP (Fase 1 de la spec funcional, Sección 13). Se derivan del alcance dentro de MVP (Sección 2.2) y del modelo de datos conceptual (Sección 10).

## Estado

Cada feature tiene un `spec.md` como stub. `plan.md` y `tasks.md` se crean cuando la feature entra en desarrollo.

Una feature pasa a `done` cuando sus tasks están cerradas y sus tests pasan. Si quedan preguntas por confirmar con el cliente que no bloquean la implementación (porque hay un default razonable ya aplicado), se listan abajo y se arrastran hasta la feature que sí las necesita resuelta.

| # | Feature | Estado | Depende de | Ref. spec funcional |
| :---- | :---- | :---- | :---- | :---- |
| 001 | Auth & permissions | done | — | §3, §12 (seguridad) |
| 002 | Entities admin (users, clients, projects) | done | 001 | §3, §10 |
| 003 | Calendar UI (day/month/year + grouping + filters) | draft | 001, 002 | §4 |
| 004 | Bookings CRUD | draft | 001, 002, 003 | §5, §9 |
| 005 | Approval flow (dev approve/reject) | draft | 004 | §6, §9 |
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
6. **010-notifications-and-audit** — aunque llega tarde en la numeración, la infra de notificaciones se necesita para 005; se puede arrancar en paralelo.
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
| Q-B | ¿Un dev puede trabajar para varios clientes a la vez? | Sí, el dev es transversal; la reserva lo asigna a un proyecto. | Sin restricción en el modelo | `004-bookings` |
| Q-2 | ¿Dos niveles de prioridad o esquema numérico P0–P3? | Dos niveles (`común` / `prioritario`), como pidió el cliente. | `projects.priority` + tokens en `DESIGN.md` §3 | `006-priority-reallocation` |
| Q-6 | ¿La realocación por prioridad saltea también la aprobación del dev? | Recomendación de la spec funcional §6: saltea al PM anterior, **no** al dev. | Todavía sin implementar | `005-approval-flow` |

**Q-2 es la más urgente de las cuatro:** con solo dos niveles, dos proyectos prioritarios en conflicto no se resuelven solos (spec funcional §7.2), que es justamente el caso que `006` tiene que decidir. Cambiar la escala después es una migration simple (`priority` es un `check`, no un enum — ver `002/plan.md` §9), pero arrastra el sistema de color de `DESIGN.md`.
