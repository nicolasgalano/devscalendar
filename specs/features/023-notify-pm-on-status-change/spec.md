# Spec — Notificar al PM primario cuando cambia el status de un ticket

- **ID:** 023-notify-pm-on-status-change
- **Estado:** draft
- **Referencias:** `010-notifications-and-audit` (patrón ADR 0012: trigger que escribe la notificación en la misma transacción del evento; `src/lib/notifications/events.ts` para el copy). `015-project-membership-and-tickets` (trigger `notify_ticket_events` en la migration 14 líneas ~679-766). `022-ticket-comments-and-mentions` (spec hermana con la misma lógica de "el PM primario es interesado del ticket").

---

## 1. Objetivo

Sumar al **PM primario del proyecto** (`projects.pm_id`) como destinatario del evento `ticket_status_changed`, sin sacar a los actuales (assignee + creador). El PM se entera cuando algo se mueve entre columnas del kanban de sus proyectos sin tener que revisar cada ticket a mano.

Cambio quirúrgico: una función SQL que hoy ya avisa a assignee y creador se extiende con un tercer destinatario. La deduplicación estándar del `notify_user()` evita el doble aviso cuando el PM primario también es el assignee o el creador. **No hay cambios de UI ni de API.**

**Fuera del alcance (a propósito):**

- **Cambiar el destinatario de `ticket_assigned`.** Ya avisa al dev asignado (que es lo que pide el usuario en la misma conversación). Nada que hacer.
- **Sumar avisos para otros eventos** (assignee change, priority change, sprint change). Solo status. Los demás campos se leen mirando el ticket; el status es el que se mira en un kanban de un vistazo y define qué está en curso vs. terminado.
- **Preferencias por-usuario** ("silenciar los cambios de status de tickets donde no soy assignee"). Fase 2 en `010`. Hoy el equipo es chico y el ruido esperado es tolerable.
- **Reemplazar los destinatarios actuales.** El pedido del usuario ("Cambio de Status va para el PM") **no** significa "solo al PM" — significa "también al PM". El assignee y el creador siguen recibiendo el aviso como hoy (confirmado en la clarificación previa al drafting).
- **Distinguir el aviso al PM del aviso al assignee/creador con copy diferente.** Un solo `ticket_status_changed` para todos, con el mismo copy. Si en algún momento el PM quiere un email distinto ("como PM, este cambio te afecta porque…"), es refactor de copy, no de datos.

---

## 2. Contexto

El trigger `notify_ticket_events` (migration `14_project_membership_and_tickets.sql:679-766`) hoy dispara `ticket_status_changed` en dos casos:

1. **Al assignee**, si no es el actor (`auth.uid()`).
2. **Al creador (`created_by`)**, si no es el actor y no es el mismo assignee (para evitar el doble aviso en el caso común "quien creó el ticket también lo asignó a sí mismo").

El PM primario **no** entra en esa lista. Fue una decisión implícita de `015`: en ese momento el concepto de "interesado del ticket" era "quien lo trabaja o lo pidió". Con dos features cerradas y el sistema en producción, apareció el pedido explícito: el PM primario necesita ver los movimientos de status en sus proyectos sin tener que abrir cada ticket. Es la misma información que ya se ve en el kanban del workspace, pero **push** en lugar de **pull** — para no depender de que el PM esté mirando esa pantalla en el momento que ocurre.

**Por qué solo status y no también assignee change.** El cambio de assignee ya notifica al asignado nuevo (`ticket_assigned`); el PM se entera al mirar el ticket. Y en la práctica, quién trabaja qué lo decide el PM — no le sirve un aviso de una acción que él mismo ejecuta. El status, en cambio, lo mueve el dev/contributor cuando pasa a "in progress" o "done"; el PM no lo dispara casi nunca, así que el aviso agrega información real.

**Por qué al PM primario y no a los `lead` de `project_members`.** El PM primario es una persona por proyecto (`projects.pm_id` es not null y unique por proyecto). Los `lead` de `project_members` son colaboradores con permisos elevados dentro del proyecto, pero no son "dueños operativos". Escalar a leads suma ruido; si algún proyecto puntual quiere multiple owners, se resuelve con preferencias en fase 2.

**Por qué la deduplicación es crítica y no una nice-to-have.** El caso "PM primario = creador del ticket" es el 60-70% de los tickets según cómo se opera hoy (los PMs crean el backlog, los devs solo cambian status). Sin dedupe, cada cambio de status genera dos notificaciones para la misma persona — bandeja saturada, emails idénticos, y el sistema pierde credibilidad rápido. El `notify_user()` (ADR 0012) ya deduplica por `(user_id, related_id, event_type)` en la misma transacción — sumar al PM primario y confiar en esa dedupe es suficiente.

---

## 3. User stories

- **US-1 · Enterarme como PM primario** — Como PM primario de un proyecto, quiero recibir una notificación (in-app + email, patrón `010`) cada vez que cambia el status de un ticket del proyecto, para no tener que revisar el kanban a mano.
- **US-2 · No recibir el aviso de mi propia acción** — Como PM primario que además muevo un ticket, no quiero recibir un aviso de mi propia acción. Es lo que hoy pasa con assignee y creador — se mantiene.
- **US-3 · No recibir el aviso dos veces** — Como PM primario que además es assignee (o creador) del ticket, quiero recibir **una única** notificación de ese status change, no dos.
- **US-4 · No afectar al resto** — Como assignee o creador de un ticket, quiero seguir recibiendo el aviso de status change tal como lo recibo hoy — la incorporación del PM no altera mi experiencia.

---

## 4. Acceptance criteria

- **AC-1** — Given cambia el status de un ticket con `project.pm_id = P`, `assignee_id = A`, `created_by = B`, `actor = X`, when el trigger `notify_ticket_events` corre, then se genera **una notificación `ticket_status_changed` para cada uno de {P, A, B}** menos:
  - el actor (`X`),
  - los `null` (assignee sin asignar).
- **AC-2** — Given `P = A` (el PM primario también es el asignado), when el trigger corre, then se emite **una única** notificación al PM/asignado — no dos.
- **AC-3** — Given `P = B` (el PM primario creó el ticket), when el trigger corre, then se emite **una única** notificación — no dos. Es el caso más común.
- **AC-4** — Given `P = A = B = X` (el PM primario creó el ticket, se lo autoasignó y él mismo lo movió), when el trigger corre, then **no se emite ninguna notificación** (nadie se avisa a sí mismo).
- **AC-5** — Given `P ≠ A ≠ B ≠ X`, when el trigger corre, then se emiten **tres** notificaciones — a P, a A y a B.
- **AC-6** — Given un ticket **sin PM primario** (`projects.pm_id is null` — hoy no debería pasar, `pm_id` es not null en la migration; pero por defensa) o con `pm_id` que apunta a un usuario `active = false`, when el trigger corre, then el PM **no** recibe el aviso; assignee y creador siguen recibiendo como hoy.
- **AC-7** — Given el copy in-app y el subject del email de `ticket_status_changed`, when el PM recibe el aviso, then usa **el mismo texto** que ya se emite para assignee/creador (nada distintivo por rol). El payload de la notificación es idéntico.
- **AC-8** — Given `RESEND_API_KEY` no está seteada, when el trigger corre, then la fila de `notifications` para el PM queda con `email_status = 'pending'` (patrón `010`) — la bandeja in-app la muestra igual.
- **AC-9** — Given hago `PATCH /api/tickets/[id]` con `status` distinto **y** con otros campos (ej.: title + status en el mismo update), when el trigger corre, then el aviso al PM sale igual — no depende de que status sea el único campo modificado. El trigger ya escucha `on update of assignee_id, status` (líneas 764-766 de la migration 14) — la condición `if new.status is distinct from old.status` decide.
- **AC-10** — Given corren los tests de integración de `015` sobre el trigger `notify_ticket_events`, when se agregan los casos de PM primario, then **todos los casos anteriores siguen pasando** (assignee/creador se comportan como hoy).

---

## 5. Alcance

**Dentro:**

- **Migration:** un solo archivo nuevo (siguiente número de secuencia, ver `supabase/migrations/`). Reescribe `notify_ticket_events()` con `create or replace function` (misma firma, mismo trigger `tickets_notify_events`, no hace falta drop). Suma un tercer `perform notify_user_for_ticket(pm_id, 'ticket_status_changed', …)` con las guardas de AC-2/3/4/6. Actualiza el `comment on function` para reflejar la nueva regla.
- **Regen de types:** `pnpm db:types` corre después del `pnpm db:push`. Sin cambios de schema (nada de columnas ni enums), el `.ts` no cambia; el paso es defensivo.
- **`src/lib/notifications/events.ts`:** sin cambios. El copy de `ticket_status_changed` (subject + body) ya existe y aplica a todos los destinatarios por igual (AC-7).
- **Tests:**
  - Integration: cinco casos de AC-1 a AC-5 (todas las combinaciones de identidad entre P/A/B/X), más AC-6 (PM inactivo). Un test por caso, sobre el stack efímero de CI.
  - Sin cambios en tests unit (nada nuevo del lado del lib TS).
- **Docs:**
  - Actualizar el comentario dentro de la migration (`comment on function public.notify_ticket_events`) con la nueva regla.
  - Anotar en `CLAUDE.md` sección "Notificaciones" que el PM primario es tercer destinatario de status change.

**Fuera:**

- **UI, API, componentes.** Cero.
- **Cambio de copy** (subject/body del email in-app). El texto actual es válido para el PM tal como está.
- **Nuevos tipos de notificación.** Se reusa `ticket_status_changed` que ya existe (enum `notification_type` en migration 14).
- **Refactor a un helper compartido `ticket_stakeholders(ticket_id)`.** El spec `022-ticket-comments-and-mentions` levanta la posibilidad como pregunta abierta (Q-8 del plan cuando exista). En esta feature se deja duplicada la lógica en el trigger; si se decide sacar a helper, se hace en la feature que gane el orden (probablemente 022 si sale primero).
- **Aviso al PM secundario / colaborador con rol `lead`.** Explicado en §2.
- **Preferencias por-usuario** (silenciar tickets/proyectos/tipos de evento). Fase 2 de `010`.

---

## 6. Preguntas abiertas

- **Q-1 · ¿La notificación al PM incluye a "todos los PMs del proyecto" si en el futuro hay más de uno?** Hoy `projects.pm_id` es single. Si se agrega una tabla `project_pms` o un flag en `project_members.role = 'pm'`, el trigger cambia. **Preferencia inicial: no anticipar.** Se resuelve cuando exista la funcionalidad, no antes. La implementación actual usa `projects.pm_id` directo y punto.
- **Q-2 · ¿El PM primario recibe el aviso si el status change fue disparado desde el kanban por drag & drop, vs. desde el detalle del ticket, vs. desde una API externa?** El trigger no distingue el origen — es SQL, no ve el UA. **Preferencia inicial: sí, mismo comportamiento en los tres casos** (es lo natural del diseño con trigger). No hay motivo para distinguir.
- **Q-3 · ¿Se retroactiva? Es decir, ¿el trigger empieza a aplicar solo a los status changes que ocurren después del deploy, o hay algún script que "avise" al PM de los status changes del último mes?** **Preferencia inicial: no retroactivar.** Los avisos son eventos; retroactivarlos genera confusión ("por qué me llega un aviso de un cambio del 5 de septiembre"). Solo hacia adelante.
- **Q-4 · ¿El aviso llega también al PM del proyecto viejo si un ticket se mueve de proyecto?** Hoy los tickets no se mueven de proyecto (la migration 14 hace la `key` inmutable con tickets numerados). **Preferencia inicial: no aplica.** Si en algún momento se permite mover, la spec de esa feature lo resuelve.

---

## 7. Riesgos

- **R-1 · PMs con muchos proyectos saturan la bandeja** — Un PM con 10 proyectos activos, cada uno con 20 tickets moviéndose a lo largo del día, puede recibir 50+ avisos diarios. **Mitigación:** aceptar en el MVP; monitorear. Preferencias por-usuario en fase 2 (Q-1 de la sección anterior). El equipo es chico y el volumen esperado es bajo.
- **R-2 · Emails duplicados por bug en la dedupe** — Si algún caso de identidad no dedupe correctamente, el PM recibe dos emails idénticos. **Mitigación:** los AC-2/3/4 lo cubren con tests; el `notify_user()` ya está probado desde `010`. El caso más peligroso (P=A=B) tiene AC-4 dedicado.
- **R-3 · El PM primario está `active = false`** — Un usuario desactivado no debe recibir emails ni ver bandeja (está fuera de la app). **Mitigación:** AC-6 lo cubre. La regla ya vive en `notify_user()` (chequea `active` antes de insertar). Si `notify_user()` no lo chequea hoy, se agrega en la misma migration (una línea).
- **R-4 · Migration falla en `db:push` a la base de producción** — La única migration es reemplazar una función; `create or replace` es idempotente y no falla. **Mitigación:** correr en CI primero (el stack efímero aplica todas las migrations desde cero), y respetar la regla de dos fases de CLAUDE.md — aunque esta migration no requiere fase 2 porque no cambia schema.
- **R-5 · Regla de "solo status, no assignee change" olvidada más adelante** — Alguien mira el trigger dentro de 6 meses, ve que hay ramas para assignee_id e implementa "avisar también al PM en cambio de assignee". Genera ruido. **Mitigación:** el `comment on function` de la migration deja escrito **por qué** solo status y no assignee (§2 del contexto).

---

## 8. Dependencias

- **015-project-membership-and-tickets** — dueña del trigger `notify_ticket_events` y de la tabla `tickets`. Esta feature reemplaza la función con `create or replace` — sin drop, sin cambios en el `create trigger`. La migration original queda intacta (histórico); la nueva sobreescribe la función.
- **010-notifications-and-audit** — dueña de `notify_user()` (dedupe + chequeo de `active` + `RESEND_API_KEY`). Se hereda.
- **022-ticket-comments-and-mentions** — spec hermana que aplica la misma regla al evento `ticket_commented`. Cada una es autónoma; si `022` sale primero e introduce un helper `ticket_stakeholders(ticket_id)`, esta feature puede migrar a usarlo. Si sale al revés, no importa: cada trigger tiene su lógica local.
- **023 no depende de 022 ni al revés.** Se pueden desarrollar en cualquier orden.

---

## 9. Compatibilidad con features futuras

- **Multi-PM por proyecto.** Si `projects.pm_id` se reemplaza por `project_members.role = 'pm'` o por una tabla `project_pms`, el trigger cambia a iterar sobre todos los PMs con `for` loop. Sin cambios al enum de notificaciones ni al copy.
- **Preferencias por-usuario.** Un `notification_preferences (user_id, project_id, event_type, muted)` puede filtrar adentro de `notify_user()`. Sin cambios al trigger de status change.
- **Aviso a `lead` de `project_members`.** Si aparece el pedido, se agrega una consulta al `project_members` con `role = 'lead'` adentro del trigger. Aditivo, sin migration destructiva.
- **Distinción de copy PM vs. assignee.** Si en algún momento el PM necesita un subject distinto ("Se movió un ticket en tu proyecto {name}") vs. el del assignee ("Tu ticket cambió de status"), se agrega una segunda función de copy en `events.ts` y el trigger elige según el destinatario. No requiere migration.
- **Retroactivar avisos.** Un script one-off que lee `audit_log` de status changes del último mes y escribe filas en `notifications` para el PM. No entra en el MVP (Q-3), pero es simple si aparece.
