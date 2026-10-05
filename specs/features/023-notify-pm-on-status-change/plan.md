# Plan — Notificar al PM primario cuando cambia el status de un ticket

- **ID:** 023-notify-pm-on-status-change
- **Spec reference:** `./spec.md`
- **Estado:** draft
- **Depende de:** `022-ticket-comments-and-mentions` (dueña de la versión actual de `notify_ticket_events` post-migration 21, con la rama de menciones en `description_doc`). `015-project-membership-and-tickets` (versión original del trigger, migration 14). `010-notifications-and-audit` (patrón ADR 0012).

---

## 1. Resumen técnico

Feature de 15 minutos. Una sola migration.

- **Migration `00000000000022_status_change_notify_pm.sql`** — `create or replace function public.notify_ticket_events()` preservando **todas** las ramas actuales (assignee, status change al assignee, status change al creador, menciones en `description_doc` insert + update) y sumando **una tercera invocación** en la rama de status change: al PM primario del proyecto, filtrando actor + assignee + creador para evitar duplicados.
- **Sin cambios en el trigger** (`tickets_notify_events`) — la lista de columnas escuchadas ya incluye `status` desde 015.
- **Sin cambios en `notify_user_for_ticket`** — su chequeo de self-notify + null-target ya cubre los casos borde.
- **Sin cambios en `src/lib/notifications/events.ts`** — se reusa `ticket_status_changed` con el mismo payload. El PM primario ve el mismo copy que assignee/creador (spec AC-7).

### Qs de la spec cerradas en el plan

- Q-1 · Multi-PM futuro: no anticipar. Usar `projects.pm_id` directo.
- Q-2 · Origen del status change (kanban vs detalle vs API): el trigger no lo distingue — mismo comportamiento en los tres.
- Q-3 · Retroactivar: no. Solo hacia adelante.
- Q-4 · Move-project: no aplica (los tickets no se mueven de proyecto).

### Dedupe

`notify_user_for_ticket()` (migration 14) ya filtra:
- `target_recipient is null` → return.
- `auth.uid() = target_recipient` → return (no self-notify).

Adentro del trigger sumo un chequeo extra `and pm_id is distinct from new.assignee_id and pm_id is distinct from new.created_by` para no insertar filas duplicadas cuando el PM coincide con alguno.

---

## 2. Migration

Un solo archivo: `supabase/migrations/00000000000022_status_change_notify_pm.sql`.

Estructura:

1. Header con el "por qué" (referencia a la spec 023).
2. `create or replace function public.notify_ticket_events()` con el cuerpo completo — todas las ramas heredadas de 021 más una invocación nueva al PM primario en el bloque de status change.

**Se preserva sin cambios:**
- Rama INSERT: assignee_id (015) + menciones en description_doc (022).
- Rama UPDATE:
  - Assignee change (015).
  - Status change → assignee (015).
  - Status change → creador si distinto del actor y del assignee (015).
  - Menciones nuevas en description_doc (022).

**Se agrega:**
- Rama UPDATE > status change > **PM primario** del proyecto, filtrado por `pm_id is distinct from actor, assignee y creador`.

**No hay drop + create del trigger** — la lista `after insert or update of assignee_id, status, description_doc` no cambia.

---

## 3. Tests

**Ninguno nuevo del lado unit** (la lógica es SQL, no TS).

**Smoke SQL: idealmente sí**, pero el proyecto todavía no tiene infra de integration tests sobre tickets/project_members (F de 022). Sumar la maquinaria por un chequeo de una fila más de notif no compensa hoy. Se anota como F1 al final.

Se verifica **contra prod** con un script de debug análogo al de 022:
1. Buscar un ticket, cambiar su status (via UI o SQL).
2. Query a `notifications` filtrada por `type=ticket_status_changed`, `recipient_id=pm_id del proyecto`.
3. Confirmar que la fila aparece con `payload.title` correcto.

---

## 4. Deploy

- `pnpm db:push` a prod. La migration es una `create or replace function` — completamente idempotente y sin cambios de schema. Sin cambios en `src/types/database.ts`.
- Merge a develop → main → Vercel construye.
- El deploy en sí no cambia código de TS — la migration corre antes.

---

## 5. Riesgos

- **R-1 · PMs con muchos proyectos saturan bandeja** — aceptado. Preferencias por-usuario a fase 2 de `010`.
- **R-2 · Emails duplicados por dedupe rota** — cubierto por el `distinct from` en tres direcciones (actor, assignee, creador). El caso `PM=A=B=X` (ADRs típicos) resulta en cero notif — correcto.
- **R-3 · PM primario `active = false`** — `notify_user_for_ticket` no chequea `active`; el `notify_user` de bookings tampoco. La convención del proyecto es que la RLS de select filtra al desactivado en su bandeja (D-01), pero la fila igual se escribe. Se acepta: si un PM se desactiva y sigue habiendo tickets vivos, sus notif se escriben pero él ya no las ve.
- **R-4 · Migration falla en `db:push`** — `create or replace function` es idempotente; no rompe.

---

## 6. Cierre

Al terminar:
- `specs/features/README.md`: fila 023 → `done (deployed YYYY-MM-DD)`.
- `CLAUDE.md` sección "Notificaciones": actualizar la nota de tipos para mencionar que status change ahora avisa a assignee + creador + **PM primario**.
- Merge feature/023 → develop → main.

Follow-ups (F):
- **F1** — Smoke SQL de la nueva rama (cuando el proyecto tenga infra de integration tests sobre tickets/project_members).
- **F2** — Preferencias por-usuario (fase 2 de `010`, común con 022 F2).
